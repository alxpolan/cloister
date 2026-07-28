#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { realpathSync, existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { homedir } from "node:os";

const PREFIX = "agent-";
const SELF = realpathSync(fileURLToPath(import.meta.url));
const PKG = dirname(SELF); // holds cli.mjs + compose.pull.yml
const REPO = resolve(PKG, ".."); // repo root — only meaningful in dev mode

// Dev mode = cloned repo (build images locally). Installed = npm global (pull from GHCR).
const DEV = existsSync(resolve(REPO, "docker-compose.yml"));
const OWNER = process.env.CLOISTER_OWNER ?? "alxpolan";
const DATA_DIR = resolve(homedir(), ".cloister");

function docker(args, opts = {}) {
  return spawnSync("docker", args, { encoding: "utf8", ...opts });
}

function requireDocker() {
  const r = docker(["info"], { stdio: "ignore" });
  if (r.status !== 0) {
    console.error("Docker is not reachable. Is the daemon running?");
    process.exit(1);
  }
}

function listContainers() {
  const r = docker([
    "ps",
    "-a",
    "--filter",
    "label=agent-containers.company",
    "--format",
    '{{.Label "agent-containers.company"}}\t{{.State}}',
  ]);
  return r.stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [company, state] = line.split("\t");
      return { company, state };
    })
    .sort((a, b) => a.company.localeCompare(b.company));
}

function containerState(company) {
  return listContainers().find((c) => c.company === company)?.state ?? "missing";
}

function ensureRunning(company) {
  const state = containerState(company);
  if (state === "missing") {
    console.error(
      `No container for '${company}'. Create and start it in the dashboard first.`
    );
    process.exit(1);
  }
  if (state !== "running") {
    process.stderr.write(`Starting agent-${company}… `);
    const r = docker(["start", `${PREFIX}${company}`], { stdio: "ignore" });
    if (r.status !== 0) {
      console.error("failed to start the container.");
      process.exit(1);
    }
    console.error("ok");
  }
}

function printList() {
  const rows = listContainers();
  if (rows.length === 0) {
    console.log("No agent containers yet. Create one in the dashboard.");
    return;
  }
  const width = Math.max(...rows.map((r) => r.company.length), 7);
  console.log("COMPANY".padEnd(width) + "  STATUS");
  for (const r of rows) {
    const dot = r.state === "running" ? "●" : "○";
    console.log(`${r.company.padEnd(width)}  ${dot} ${r.state}`);
  }
}

function shell(company, cli, extra) {
  ensureRunning(company);
  const r = docker(
    ["exec", "-it", "-e", "HOME=/home/node", "-w", "/home/node/workspace", `${PREFIX}${company}`, cli, ...extra],
    { stdio: "inherit" }
  );
  process.exit(r.status ?? 0);
}

const IMAGE = process.env.AGENT_IMAGE ?? "agent-base:latest";

function inspect(company, format) {
  const r = docker(["inspect", `${PREFIX}${company}`, "--format", format]);
  if (r.status !== 0) return null;
  return r.stdout.trim();
}

// Run the company's isolated CLI against the CURRENT host directory.
// A throwaway container reuses the company home (auth + MCP tokens + secrets)
// and bind-mounts $PWD, so the agent edits the exact files you have open.
function here(company, cli, extra) {
  const homeSource = inspect(
    company,
    '{{range .Mounts}}{{if eq .Destination "/home/node"}}{{.Source}}{{end}}{{end}}'
  );
  if (!homeSource) {
    console.error(
      `No container for '${company}'. Create it in the dashboard first (it seeds the home dir with logins/MCPs).`
    );
    process.exit(1);
  }
  const envJson = inspect(company, "{{json .Config.Env}}");
  const env = envJson ? JSON.parse(envJson) : [];
  const envFlags = env
    .filter((e) => /^[A-Z][A-Z0-9_]*=/.test(e))
    .flatMap((e) => ["-e", e]);

  const image = inspect(company, "{{.Config.Image}}") || IMAGE;
  const cwd = process.cwd();
  const name = cwd.split("/").filter(Boolean).pop() || "project";
  const mountPoint = `/home/node/workspace/${name}`;

  const cliArgs =
    cli === "codex"
      ? ["codex", ...extra]
      : [
        "claude",
        "--mcp-config",
        "/home/node/workspace/.mcp.json",
        "--strict-mcp-config",
        ...extra,
      ];

  const r = docker(
    [
      "run",
      "--rm",
      "-it",
      ...envFlags,
      "-e",
      "GIT_TERMINAL_PROMPT=0",
      "-v",
      `${homeSource}:/home/node`,
      "-v",
      `${cwd}:${mountPoint}`,
      "-w",
      mountPoint,
      image,
      ...cliArgs,
    ],
    { stdio: "inherit" }
  );
  process.exit(r.status ?? 0);
}

function stackCtx() {
  if (DEV) return { dir: REPO, envPath: resolve(REPO, ".env"), composeArgs: [] };
  mkdirSync(resolve(DATA_DIR, "homes"), { recursive: true });
  return {
    dir: DATA_DIR,
    envPath: resolve(DATA_DIR, ".env"),
    composeArgs: ["-f", resolve(PKG, "compose.pull.yml"), "-p", "cloister"],
  };
}

function ensureEnv(envPath) {
  let env = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
  let changed = false;
  if (!/^SECRETS_KEY=/m.test(env)) { env += `SECRETS_KEY=${randomBytes(32).toString("hex")}\n`; changed = true; }
  if (!/^API_TOKEN=/m.test(env)) { env += `API_TOKEN=${randomBytes(32).toString("hex")}\n`; changed = true; }
  if (changed) { writeFileSync(envPath, env); console.error("→ wrote .env (encryption key + API token)"); }
}

function readEnv(envPath) {
  const out = {};
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, "utf8").split("\n")) {
      const m = line.match(/^([A-Z_]+)=(.*)$/);
      if (m) out[m[1]] = m[2];
    }
  }
  return out;
}

function compose(ctx, args, envExtra = {}) {
  return spawnSync("docker", ["compose", ...ctx.composeArgs, ...args], {
    cwd: ctx.dir,
    stdio: "inherit",
    env: { ...process.env, ...envExtra },
  });
}

function stackUp() {
  requireDocker();
  const ctx = stackCtx();
  ensureEnv(ctx.envPath);
  const env = readEnv(ctx.envPath);
  const composeEnv = { ...env, CLOISTER_OWNER: OWNER, CLOISTER_HOME: DATA_DIR };

  if (DEV) {
    console.error("→ building the agent base image…");
    const build = docker(["build", "-q", "-f", "docker/base.Dockerfile", "-t", "agent-base:latest", "docker/"],
      { cwd: REPO, stdio: ["ignore", "ignore", "inherit"] });
    if (build.status !== 0) process.exit(build.status ?? 1);
    console.error("→ starting Postgres, backend and dashboard…");
    if (compose(ctx, ["up", "-d", "--build"], composeEnv).status !== 0) process.exit(1);
  } else {
    console.error("→ pulling the agent base image…");
    docker(["pull", `ghcr.io/${OWNER}/cloister-agent-base:latest`], { stdio: "inherit" });
    console.error("→ pulling and starting Postgres, backend and dashboard…");
    if (compose(ctx, ["up", "-d"], composeEnv).status !== 0) process.exit(1);
  }

  process.stderr.write("→ waiting for the dashboard…");
  for (let i = 0; i < 60; i++) {
    if (spawnSync("curl", ["-s", "--max-time", "2", "-o", "/dev/null", "http://localhost:3000"]).status === 0) break;
    process.stderr.write(".");
    spawnSync("sleep", ["2"]);
  }
  console.error(" ready\n");
  console.log("  Cloister is running.\n");
  console.log("  Dashboard   http://localhost:3000");
  console.log("  CLI         agents            (list)   ·   agents <company>   (open a cell)");
  console.log(`  API token   ${env.API_TOKEN ?? ""}\n`);
  console.log("  Next: open the dashboard, create a container, log in Claude/Codex,");
  console.log("        then run 'agents <company>' to drop into its isolated session.");
}

function stackDown() {
  requireDocker();
  const ctx = stackCtx();
  console.error("→ stopping the Cloister stack (agent containers keep running)…");
  compose(ctx, ["stop"], { CLOISTER_OWNER: OWNER, CLOISTER_HOME: DATA_DIR });
}

function stackStatus() {
  requireDocker();
  const ctx = stackCtx();
  compose(ctx, ["ps"], { CLOISTER_OWNER: OWNER, CLOISTER_HOME: DATA_DIR });
}

function usage() {
  console.log(`cloister / agents — isolated Claude Code / Codex per company

Stack:
  cloister up                   build + start the whole stack (web, API, DB, CLI)
  cloister down                 stop the stack
  cloister status               show stack services


Usage:
  agents                        list containers and status
  agents ls                     same
  agents <company>              open Claude Code in that company's container
  agents <company> codex        open Codex instead
  agents <company> claude -- …   pass extra args to the CLI (e.g. -- --model opus)
  agents here <company>         run the company's agent against the CURRENT
                                directory (your VS Code project) — isolated
                                login + MCPs, editing the files you have open
  agents here <company> codex   same, with Codex
  agents up <company>           start a container
  agents down <company>         stop a container
  agents help                   this help

Containers, MCP servers, logins and secrets are managed in the dashboard
(web at :3000 or the macOS app). This CLI is the fast path into a session.`);
}

function main() {
  const [cmd, ...rest] = process.argv.slice(2);

  if (cmd === "help" || cmd === "-h" || cmd === "--help") return usage();
  if (cmd === "up" && !rest[0]) return stackUp();
  if (cmd === "down" && !rest[0]) return stackDown();
  if (cmd === "status" || cmd === "ps") return stackStatus();

  requireDocker();

  if (!cmd || cmd === "ls" || cmd === "list") return printList();

  if (cmd === "here") {
    const company = rest[0];
    if (!company) return console.error("usage: agents here <company> [claude|codex] [-- args]");
    let cli = "claude";
    let extra = rest.slice(1);
    if (extra[0] === "claude" || extra[0] === "codex") {
      cli = extra[0];
      extra = extra.slice(1);
    }
    if (extra[0] === "--") extra = extra.slice(1);
    return here(company, cli, extra);
  }

  if (cmd === "up") {
    ensureRunning(rest[0]);
    return console.log(`agent-${rest[0]} is running.`);
  }
  if (cmd === "down") {
    docker(["stop", `${PREFIX}${rest[0]}`], { stdio: "ignore" });
    return console.log(`agent-${rest[0]} stopped.`);
  }

  // default: `ac <company> [claude|codex] [-- extra args]`
  const company = cmd;
  let cli = "claude";
  let extra = rest;
  if (rest[0] === "claude" || rest[0] === "codex") {
    cli = rest[0];
    extra = rest.slice(1);
  }
  if (extra[0] === "--") extra = extra.slice(1);
  return shell(company, cli, extra);
}

main();
