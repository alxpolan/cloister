import Docker from "dockerode";
import { PassThrough } from "node:stream";
import { config, hostHomePath } from "./config.js";
import { pool, type AccountRow, type ContainerRow } from "./db.js";
import { readSecret } from "./crypto.js";
import { renderConfigs, CONTAINER_WORKSPACE } from "./configgen.js";
import { getEffectiveMcpServers, resolveBindingEnv } from "./mcps.js";

export const docker = new Docker();

export function containerName(company: string): string {
  return `${config.containerPrefix}${company}`;
}

export async function resolveHostHomesDir(): Promise<void> {
  if (config.hostHomesDir) return;
  try {
    const { hostname } = await import("node:os");
    const info = await docker.getContainer(hostname()).inspect();
    const mount = info.Mounts?.find((m) => m.Destination === config.homesDir);
    if (mount?.Source) {
      config.hostHomesDir = mount.Source;
      console.log(`resolved host homes dir: ${config.hostHomesDir}`);
    }
  } catch {}
}

export async function dockerState(
  company: string,
): Promise<"running" | "stopped" | "missing"> {
  try {
    const info = await docker.getContainer(containerName(company)).inspect();
    return info.State.Running ? "running" : "stopped";
  } catch (err: any) {
    if (err.statusCode === 404) return "missing";
    throw err;
  }
}

export async function resolveEnv(containerId: string): Promise<string[]> {
  const { rows } = await pool.query<AccountRow>(
    "SELECT * FROM accounts WHERE container_id = $1",
    [containerId],
  );
  const env: string[] = [];
  for (const account of rows) {
    if (!account.secret_ref) continue;
    const value = await readSecret(account.secret_ref);
    if (value === null) continue;
    const name =
      account.env_var?.trim() ||
      `${account.type.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_TOKEN`;
    env.push(`${name}=${value}`);
  }
  return env;
}

export async function resolveAllEnv(containerId: string): Promise<string[]> {
  const accountEnv = await resolveEnv(containerId);
  const bindingEnv = await resolveBindingEnv(containerId);
  const merged = new Map(
    [...accountEnv, ...bindingEnv].map((e) => {
      const i = e.indexOf("=");
      return [e.slice(0, i), e] as const;
    }),
  );
  return [...merged.values()];
}

export interface StartOptions {
  codexAuthPort?: boolean;
}

const CODEX_PROXY_JS =
  'const net=require("net");' +
  'net.createServer(s=>{const c=net.connect(1455,"127.0.0.1");' +
  "s.pipe(c);c.pipe(s);" +
  's.on("error",()=>c.destroy());c.on("error",()=>s.destroy());})' +
  '.listen(1456,"0.0.0.0");';

export async function startCodexAuthProxy(company: string): Promise<void> {
  const container = docker.getContainer(containerName(company));
  const exec = await container.exec({
    Cmd: ["node", "-e", CODEX_PROXY_JS],
    User: "node",
    AttachStdout: false,
    AttachStderr: false,
  });
  await exec.start({ Detach: true });
}

export async function startContainer(
  row: ContainerRow,
  opts: StartOptions = {},
): Promise<void> {
  await renderConfigs(row, await getEffectiveMcpServers(row));

  const name = containerName(row.company);
  try {
    await docker.getContainer(name).remove({ force: true });
  } catch (err: any) {
    if (err.statusCode !== 404) throw err;
  }

  const env = await resolveAllEnv(row.id);
  const create = (withAuthPort: boolean) =>
    docker.createContainer({
      name,
      Image: config.agentImage,
      Cmd: ["sleep", "infinity"],
      User: "node",
      WorkingDir: CONTAINER_WORKSPACE,
      Env: [...env, "HOME=/home/node"],
      Labels: {
        "agent-containers.company": row.company,
        "agent-containers.id": row.id,
      },
      ...(withAuthPort ? { ExposedPorts: { "1456/tcp": {} } } : {}),
      HostConfig: {
        Binds: [`${hostHomePath(row.company)}:/home/node`],
        RestartPolicy: { Name: "unless-stopped" },
        ...(withAuthPort
          ? {
              PortBindings: {
                "1456/tcp": [{ HostIp: "127.0.0.1", HostPort: "1455" }],
              },
            }
          : {}),
      },
    });

  const created = await create(Boolean(opts.codexAuthPort));
  try {
    await created.start();
  } catch (err: any) {
    if (
      opts.codexAuthPort &&
      /port is already allocated/i.test(String(err.message))
    ) {
      await created.remove({ force: true }).catch(() => {});
      const fallback = await create(false);
      await fallback.start();
      await pool.query(
        "UPDATE containers SET status = 'running' WHERE id = $1",
        [row.id],
      );
      throw new Error(
        "auth port 1455 is taken by another process; the container was restarted without it — close the other login and try again",
      );
    }
    throw err;
  }
  await pool.query("UPDATE containers SET status = 'running' WHERE id = $1", [
    row.id,
  ]);
}

export async function releaseAuthPort(exceptCompany: string): Promise<void> {
  const list = await docker.listContainers();
  for (const info of list) {
    const company = info.Labels?.["agent-containers.company"];
    if (!company || company === exceptCompany) continue;
    const holdsPort = (info.Ports ?? []).some((p) => p.PublicPort === 1455);
    if (!holdsPort) continue;
    const { rows } = await pool.query<ContainerRow>(
      "SELECT * FROM containers WHERE company = $1",
      [company],
    );
    if (rows[0]) await startContainer(rows[0]);
  }
}

export async function stopContainer(row: ContainerRow): Promise<void> {
  try {
    const c = docker.getContainer(containerName(row.company));
    await c.stop({ t: 10 });
  } catch (err: any) {
    if (err.statusCode !== 404 && err.statusCode !== 304) throw err;
  }
  await pool.query("UPDATE containers SET status = 'stopped' WHERE id = $1", [
    row.id,
  ]);
}

export async function removeContainer(row: ContainerRow): Promise<void> {
  try {
    await docker
      .getContainer(containerName(row.company))
      .remove({ force: true });
  } catch (err: any) {
    if (err.statusCode !== 404) throw err;
  }
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export async function execInContainer(
  company: string,
  cmd: string[],
  timeoutMs = 15 * 60 * 1000,
  extraEnv: string[] = [],
): Promise<ExecResult> {
  const container = docker.getContainer(containerName(company));
  const exec = await container.exec({
    Cmd: cmd,
    AttachStdout: true,
    AttachStderr: true,
    User: "node",
    WorkingDir: CONTAINER_WORKSPACE,
    Env: ["HOME=/home/node", ...extraEnv],
  });

  const stream = await exec.start({ hijack: true, stdin: false });
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const outChunks: Buffer[] = [];
  const errChunks: Buffer[] = [];
  stdout.on("data", (c: Buffer) => outChunks.push(c));
  stderr.on("data", (c: Buffer) => errChunks.push(c));
  docker.modem.demuxStream(stream, stdout, stderr);

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      stream.destroy();
      reject(new Error(`exec timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    stream.on("end", () => {
      clearTimeout(timer);
      resolve();
    });
    stream.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });

  const inspect = await exec.inspect();
  return {
    stdout: Buffer.concat(outChunks).toString("utf8"),
    stderr: Buffer.concat(errChunks).toString("utf8"),
    exitCode: inspect.ExitCode ?? -1,
  };
}
