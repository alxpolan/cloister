import Docker from "dockerode";
import { PassThrough } from "node:stream";
import { config, hostHomePath } from "./config.js";
import { pool, type AccountRow, type ContainerRow } from "./db.js";
import { readSecret } from "./crypto.js";
import { renderConfigs, CONTAINER_WORKSPACE } from "./configgen.js";
import { getEffectiveMcpServers, resolveBindingEnv } from "./mcps.js";

export const docker = new Docker(); // uses /var/run/docker.sock

export function containerName(company: string): string {
  return `${config.containerPrefix}${company}`;
}

/**
 * When the backend itself runs in a container, bind sources for agent
 * containers must be HOST paths. Instead of trusting an env var derived
 * from the caller's $PWD (fragile), ask the daemon where our own homes
 * mount really lives on the host.
 */
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
  } catch {
    // not running inside a container — homesDir is already a host path
  }
}

/** Live state of the tenant container as reported by the Docker daemon. */
export async function dockerState(
  company: string
): Promise<"running" | "stopped" | "missing"> {
  try {
    const info = await docker.getContainer(containerName(company)).inspect();
    return info.State.Running ? "running" : "stopped";
  } catch (err: any) {
    if (err.statusCode === 404) return "missing";
    throw err;
  }
}

/**
 * Resolve the env vars injected into a tenant container: one entry per
 * account that has a secret assigned. Plaintext exists only in this call
 * chain and inside the target container — never on disk, never in the DB.
 */
async function resolveEnv(containerId: string): Promise<string[]> {
  const { rows } = await pool.query<AccountRow>(
    "SELECT * FROM accounts WHERE container_id = $1",
    [containerId]
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

export interface StartOptions {
  /**
   * Publish container port 1455 to host port 1455 for the duration of a
   * Codex ChatGPT login: codex's OAuth redirect goes to localhost:1455,
   * which must reach the callback server inside the container. Only one
   * container can hold the port at a time; a normal restart drops it.
   */
  codexAuthPort?: boolean;
}

/**
 * (Re)creates and starts the tenant container. Always recreates so that
 * refreshed secrets/env and regenerated configs are picked up. The mounted
 * home dir keeps all persistent state (auth, workspace) across recreates.
 */
export async function startContainer(row: ContainerRow, opts: StartOptions = {}): Promise<void> {
  await renderConfigs(row, await getEffectiveMcpServers(row));

  const name = containerName(row.company);
  try {
    await docker.getContainer(name).remove({ force: true });
  } catch (err: any) {
    if (err.statusCode !== 404) throw err;
  }

  // account-based env plus env required by assigned catalog MCPs; the
  // latter wins on name clash
  const accountEnv = await resolveEnv(row.id);
  const bindingEnv = await resolveBindingEnv(row.id);
  const merged = new Map(
    [...accountEnv, ...bindingEnv].map((e) => {
      const i = e.indexOf("=");
      return [e.slice(0, i), e] as const;
    })
  );
  const env = [...merged.values()];
  const created = await docker.createContainer({
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
    ...(opts.codexAuthPort ? { ExposedPorts: { "1455/tcp": {} } } : {}),
    HostConfig: {
      Binds: [`${hostHomePath(row.company)}:/home/node`],
      // Deliberately NO docker socket, no extra privileges.
      RestartPolicy: { Name: "unless-stopped" },
      ...(opts.codexAuthPort
        ? { PortBindings: { "1455/tcp": [{ HostIp: "127.0.0.1", HostPort: "1455" }] } }
        : {}),
    },
  });
  await created.start();
  await pool.query("UPDATE containers SET status = 'running' WHERE id = $1", [row.id]);
}

export async function stopContainer(row: ContainerRow): Promise<void> {
  try {
    const c = docker.getContainer(containerName(row.company));
    await c.stop({ t: 10 });
  } catch (err: any) {
    if (err.statusCode !== 404 && err.statusCode !== 304) throw err;
  }
  await pool.query("UPDATE containers SET status = 'stopped' WHERE id = $1", [row.id]);
}

export async function removeContainer(row: ContainerRow): Promise<void> {
  try {
    await docker.getContainer(containerName(row.company)).remove({ force: true });
  } catch (err: any) {
    if (err.statusCode !== 404) throw err;
  }
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Runs a command inside the tenant container and captures output — the
 * building block for the Paperclip /run endpoint.
 */
export async function execInContainer(
  company: string,
  cmd: string[],
  timeoutMs = 15 * 60 * 1000
): Promise<ExecResult> {
  const container = docker.getContainer(containerName(company));
  const exec = await container.exec({
    Cmd: cmd,
    AttachStdout: true,
    AttachStderr: true,
    User: "node",
    WorkingDir: CONTAINER_WORKSPACE,
    Env: ["HOME=/home/node"],
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
