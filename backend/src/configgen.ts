import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import * as TOML from "smol-toml";
import { config } from "./config.js";
import type { ContainerRow } from "./db.js";

export function localHomePath(company: string): string {
  return path.join(config.homesDir, company);
}

export const CONTAINER_WORKSPACE = "/home/node/workspace";

export async function ensureHomeDir(company: string): Promise<string> {
  const home = localHomePath(company);
  await fs.mkdir(path.join(home, "workspace"), { recursive: true });
  await fs.mkdir(path.join(home, ".codex"), { recursive: true });
  try {
    await chownRecursive(home, 1000, 1000);
  } catch {
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

async function writeMcpJson(
  container: ContainerRow,
  servers: Record<string, unknown>
): Promise<void> {
  const file = path.join(localHomePath(container.company), "workspace", ".mcp.json");
  const rendered: Record<string, unknown> = {};
  for (const [name, def] of Object.entries(servers)) {
    rendered[name] = effectiveDef(def as McpServerDef);
  }
  await fs.writeFile(
    file,
    JSON.stringify({ mcpServers: rendered }, null, 2) + "\n",
    "utf8"
  );
}

async function writeClaudeJson(
  container: ContainerRow,
  servers: Record<string, unknown>
): Promise<void> {
  const file = path.join(localHomePath(container.company), ".claude.json");
  let existing: Record<string, unknown> = {};
  try {
    existing = JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
  }

  const projects = (existing.projects as Record<string, unknown> | undefined) ?? {};
  const workspaceProject =
    (projects[CONTAINER_WORKSPACE] as Record<string, unknown> | undefined) ?? {};

  const merged = {
    ...existing,
    hasCompletedOnboarding: true,
    mcpServers: {},
    projects: {
      ...projects,
      [CONTAINER_WORKSPACE]: {
        ...workspaceProject,
        hasTrustDialogAccepted: true,
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

export interface McpServerDef {
  type?: string;
  url?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  headers?: Record<string, string>;
}

export function isOAuthHttp(def: McpServerDef): boolean {
  const hasUrl = Boolean(def.url) || def.type === "http" || def.type === "sse";
  const auth = def.headers?.["Authorization"] ?? def.headers?.["authorization"];
  return hasUrl && !auth;
}

function effectiveDef(def: McpServerDef): McpServerDef {
  if (isOAuthHttp(def) && def.url) {
    return { command: "mcp-remote", args: [def.url] };
  }
  return def;
}

function codexServer(def: McpServerDef): Record<string, unknown> {
  if (def.type === "http" || def.type === "sse" || def.url) {
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

async function writeCodexConfig(
  container: ContainerRow,
  servers: Record<string, unknown>
): Promise<void> {
  const file = path.join(localHomePath(container.company), ".codex", "config.toml");
  let existing: Record<string, unknown> = {};
  try {
    existing = TOML.parse(await fs.readFile(file, "utf8"));
  } catch {
  }

  const mcpServers: Record<string, unknown> = {};
  for (const [name, def] of Object.entries(servers)) {
    mcpServers[name] = codexServer(effectiveDef(def as McpServerDef));
  }

  const merged = {
    ...existing,
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

async function writeGitConfig(container: ContainerRow): Promise<void> {
  const file = path.join(localHomePath(container.company), ".gitconfig");
  const content = [
    "[user]",
    `\tname = ${container.git_name?.trim() || `${container.name} Agent`}`,
    `\temail = ${container.git_email?.trim() || `agents+${container.company}@users.noreply.github.com`}`,
    "[init]",
    "\tdefaultBranch = main",
    "[safe]",
    "\tdirectory = *",
    '[credential "https://github.com"]',
    '\thelper = "!f() { echo username=x-access-token; echo password=$GITHUB_TOKEN; }; f"',
    '[credential "https://gist.github.com"]',
    '\thelper = "!f() { echo username=x-access-token; echo password=$GITHUB_TOKEN; }; f"',
    "[push]",
    "\tautoSetupRemote = true",
    "",
  ].join("\n");
  await fs.writeFile(file, content, "utf8");
}

export async function renderConfigs(
  container: ContainerRow,
  servers: Record<string, unknown>
): Promise<void> {
  await ensureHomeDir(container.company);
  await writeMcpJson(container, servers);
  await writeClaudeJson(container, servers);
  await writeCodexConfig(container, servers);
  await writeGitConfig(container);
}

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
  }
  if (!claude) {
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

export async function mcpAuthorized(company: string, serverUrl: string): Promise<boolean> {
  const dir = path.join(localHomePath(company), ".mcp-auth");
  const hash = createHash("md5").update(serverUrl).digest("hex");
  try {
    for (const entry of await fs.readdir(dir, { recursive: true, withFileTypes: true })) {
      if (entry.isFile() && entry.name === `${hash}_tokens.json`) return true;
    }
  } catch {
  }
  return false;
}
