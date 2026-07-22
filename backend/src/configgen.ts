import fs from "node:fs/promises";
import path from "node:path";
import * as TOML from "smol-toml";
import { config } from "./config.js";
import type { ContainerRow } from "./db.js";

/** Path of a company home dir as seen by THIS process (backend). */
export function localHomePath(company: string): string {
  return path.join(config.homesDir, company);
}

/** Working directory inside the agent container. Lives inside the mounted home. */
export const CONTAINER_WORKSPACE = "/home/node/workspace";

export async function ensureHomeDir(company: string): Promise<string> {
  const home = localHomePath(company);
  await fs.mkdir(path.join(home, "workspace"), { recursive: true });
  await fs.mkdir(path.join(home, ".codex"), { recursive: true });
  // The agent image runs as user `node` (uid 1000). On Linux hosts the bind
  // mount keeps host ownership, so hand the tree to uid/gid 1000. On macOS
  // (Docker Desktop) ownership is mapped automatically and chown may fail —
  // that is fine to ignore.
  try {
    await chownRecursive(home, 1000, 1000);
  } catch {
    /* macOS / permission-restricted: ignore */
  }
  return home;
}

async function chownRecursive(dir: string, uid: number, gid: number): Promise<void> {
  await fs.chown(dir, uid, gid);
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) await chownRecursive(p, uid, gid);
    else await fs.chown(p, uid, gid);
  }
}

/**
 * Regenerates .mcp.json (project scope, inside the workspace dir) from the
 * effective server set (catalog assignments + custom extras). This file is
 * fully owned by the backend and overwritten on every container start.
 */
async function writeMcpJson(
  container: ContainerRow,
  servers: Record<string, unknown>
): Promise<void> {
  const file = path.join(localHomePath(container.company), "workspace", ".mcp.json");
  await fs.writeFile(
    file,
    JSON.stringify({ mcpServers: servers }, null, 2) + "\n",
    "utf8"
  );
}

/**
 * Updates ~/.claude.json. We merge instead of overwriting: the file also
 * carries the per-container Claude auth state (oauthAccount etc.), which must
 * survive restarts. Everything MCP-related is reset from the DB on each start
 * so stale global servers can never leak in.
 */
async function writeClaudeJson(
  container: ContainerRow,
  servers: Record<string, unknown>
): Promise<void> {
  const file = path.join(localHomePath(container.company), ".claude.json");
  let existing: Record<string, unknown> = {};
  try {
    existing = JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    /* first start: no file yet */
  }

  const projects = (existing.projects as Record<string, unknown> | undefined) ?? {};
  const workspaceProject =
    (projects[CONTAINER_WORKSPACE] as Record<string, unknown> | undefined) ?? {};

  const merged = {
    ...existing,
    hasCompletedOnboarding: true,
    // No user-scope MCP servers: the only MCP source is the generated
    // workspace .mcp.json. This is the actual isolation guarantee.
    mcpServers: {},
    projects: {
      ...projects,
      [CONTAINER_WORKSPACE]: {
        ...workspaceProject,
        hasTrustDialogAccepted: true,
        // Approve exactly the servers configured in the DB for this tenant.
        enabledMcpjsonServers: Object.keys(servers),
        disabledMcpjsonServers: [],
      },
    },
  };
  await fs.writeFile(file, JSON.stringify(merged, null, 2) + "\n", "utf8");
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

interface McpServerDef {
  type?: string;
  url?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  headers?: Record<string, string>;
}

/**
 * Translates one Claude-style MCP server definition into Codex config.toml
 * shape. Env values of the form ${VAR} are mapped through a `sh -c` wrapper
 * that resolves them from the container env at spawn time — so secret
 * plaintext never lands in config.toml on disk.
 */
function codexServer(def: McpServerDef): Record<string, unknown> {
  if (def.type === "http" || def.type === "sse" || def.url) {
    // Codex reads bearer tokens for remote servers from an env var; map an
    // "Authorization: Bearer ${VAR}" header onto that mechanism.
    const auth = def.headers?.["Authorization"] ?? def.headers?.["authorization"];
    const bearerRef = auth?.match(/^Bearer \$\{([A-Z0-9_]+)\}$/);
    return {
      url: def.url,
      ...(bearerRef ? { bearer_token_env_var: bearerRef[1] } : {}),
    };
  }
  const env = def.env ?? {};
  const command = def.command ?? "";
  const args = def.args ?? [];
  const hasRefs = Object.values(env).some((v) => /\$\{[A-Z0-9_]+\}/.test(String(v)));
  if (!hasRefs) {
    return {
      command,
      args,
      ...(Object.keys(env).length > 0 ? { env } : {}),
    };
  }
  const exports = Object.entries(env)
    .map(([k, v]) => {
      const ref = String(v).match(/^\$\{([A-Z0-9_]+)\}$/);
      return ref ? `export ${k}="$${ref[1]}"` : `export ${k}=${shellQuote(String(v))}`;
    })
    .join("; ");
  const cmdline = [command, ...args].map(shellQuote).join(" ");
  return { command: "sh", args: ["-c", `${exports}; exec ${cmdline}`] };
}

/**
 * Regenerates ~/.codex/config.toml so the same DB MCP config applies to
 * Codex. Existing keys the user set inside the container are preserved;
 * everything we own (mcp_servers, workspace trust, sandbox) is reset.
 * Codex auth lives in ~/.codex/auth.json and is untouched.
 */
async function writeCodexConfig(
  container: ContainerRow,
  servers: Record<string, unknown>
): Promise<void> {
  const file = path.join(localHomePath(container.company), ".codex", "config.toml");
  let existing: Record<string, unknown> = {};
  try {
    existing = TOML.parse(await fs.readFile(file, "utf8"));
  } catch {
    /* first start: no file yet */
  }

  const mcpServers: Record<string, unknown> = {};
  for (const [name, def] of Object.entries(servers)) {
    mcpServers[name] = codexServer(def as McpServerDef);
  }

  const merged = {
    ...existing,
    // the docker container is the sandbox; codex's own sandbox (landlock)
    // is unavailable inside it
    approval_policy: "never",
    sandbox_mode: "danger-full-access",
    shell_environment_policy: { inherit: "all" },
    mcp_servers: mcpServers,
    projects: {
      ...((existing.projects as Record<string, unknown>) ?? {}),
      [CONTAINER_WORKSPACE]: { trust_level: "trusted" },
    },
  };
  await fs.writeFile(file, TOML.stringify(merged) + "\n", "utf8");
}

export async function renderConfigs(
  container: ContainerRow,
  servers: Record<string, unknown>
): Promise<void> {
  await ensureHomeDir(container.company);
  await writeMcpJson(container, servers);
  await writeClaudeJson(container, servers);
  await writeCodexConfig(container, servers);
}

/** Auth heuristics, read from the mounted home dir on the backend side. */
export async function authStatus(
  company: string
): Promise<{ claude: boolean; codex: boolean }> {
  const home = localHomePath(company);
  let claude = false;
  let codex = false;

  try {
    const raw = await fs.readFile(path.join(home, ".claude.json"), "utf8");
    const parsed = JSON.parse(raw);
    claude = Boolean(parsed.oauthAccount || parsed.primaryApiKey);
  } catch {
    /* not authenticated */
  }
  if (!claude) {
    // API-key / helper based logins land in .claude/.credentials.json
    claude = await fileExists(path.join(home, ".claude", ".credentials.json"));
  }

  codex = await fileExists(path.join(home, ".codex", "auth.json"));
  return { claude, codex };
}

async function fileExists(p: string): Promise<boolean> {
  try {
    const stat = await fs.stat(p);
    return stat.isFile() && stat.size > 2;
  } catch {
    return false;
  }
}
