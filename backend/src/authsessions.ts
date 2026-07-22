import { randomUUID } from "node:crypto";
import type { Duplex } from "node:stream";
import { docker, containerName } from "./docker.js";
import { CONTAINER_WORKSPACE } from "./configgen.js";
import { storeSecret } from "./crypto.js";
import { pool } from "./db.js";

/**
 * Interactive auth sessions: a TTY exec inside a tenant container whose
 * output is buffered for the dashboard and whose stdin accepts pasted
 * codes/answers. Used for `claude setup-token` and `codex login` — both
 * print an OAuth URL and (for claude) expect a code pasted back.
 */
export interface AuthSession {
  id: string;
  containerId: string;
  company: string;
  cli: "claude" | "codex";
  running: boolean;
  exitCode: number | null;
  createdAt: number;
  output: string;
  stream: Duplex;
}

export const CLAUDE_TOKEN_ENV = "CLAUDE_CODE_OAUTH_TOKEN";

/**
 * `claude setup-token` only PRINTS the long-lived token — it does not persist
 * anything. Capture it from the session output, store it encrypted and wire
 * it up as an env injection so `claude` in this container is authenticated
 * from the next start / next /run exec on.
 */
async function captureClaudeToken(session: AuthSession): Promise<void> {
  const match = session.output.match(/sk-ant-oat[A-Za-z0-9_-]{20,}/);
  if (!match) return;
  const token = match[0];
  const ref = `${session.company}-claude-code-oauth`;
  await storeSecret(ref, token);
  await pool.query(
    "DELETE FROM accounts WHERE container_id = $1 AND env_var = $2",
    [session.containerId, CLAUDE_TOKEN_ENV]
  );
  await pool.query(
    `INSERT INTO accounts (container_id, type, label, role, env_var, secret_ref)
     VALUES ($1, 'claude-code', 'OAuth token', 'auth', $2, $3)`,
    [session.containerId, CLAUDE_TOKEN_ENV, ref]
  );
  // never keep the plaintext token in the session buffer
  session.output =
    session.output.replaceAll(token, "sk-ant-oat…(captured)") +
    `\n\n[agents] Token captured and stored encrypted as secret '${ref}'.` +
    `\n[agents] It is injected automatically as ${CLAUDE_TOKEN_ENV} — Claude Code is ready to use.`;
}

const sessions = new Map<string, AuthSession>();
const MAX_OUTPUT = 64 * 1024;
const SESSION_TTL_MS = 30 * 60 * 1000;

/** Strip ANSI escape sequences and carriage returns for clean display. */
function stripAnsi(s: string): string {
  return s
    // CSI, OSC and simple escape sequences
    .replace(/\x1b(?:\[[0-9;?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)?|[()][0-9A-B]|[=>])/g, "")
    .replace(/\r/g, "");
}

export async function createAuthSession(
  company: string,
  containerId: string,
  cli: "claude" | "codex",
  cmd: string[]
): Promise<AuthSession> {
  // one session per container at a time
  for (const s of sessions.values()) {
    if (s.containerId === containerId && s.running) {
      s.stream.destroy();
      s.running = false;
    }
  }

  const container = docker.getContainer(containerName(company));
  const exec = await container.exec({
    Cmd: cmd,
    AttachStdin: true,
    AttachStdout: true,
    AttachStderr: true,
    Tty: true,
    User: "node",
    WorkingDir: CONTAINER_WORKSPACE,
    Env: ["HOME=/home/node", "TERM=xterm-256color"],
  });
  const stream = (await exec.start({ hijack: true, stdin: true, Tty: true })) as Duplex;
  // wide pseudo-terminal so long OAuth URLs are not hard-wrapped with \n,
  // which would truncate the URL the dashboard extracts
  await exec.resize({ h: 40, w: 500 }).catch(() => {});

  const session: AuthSession = {
    id: randomUUID(),
    containerId,
    company,
    cli,
    running: true,
    exitCode: null,
    createdAt: Date.now(),
    output: "",
    stream,
  };

  stream.on("data", (chunk: Buffer) => {
    session.output = (session.output + chunk.toString("utf8")).slice(-MAX_OUTPUT);
  });
  const finish = async () => {
    if (!session.running) return;
    session.running = false;
    try {
      session.exitCode = (await exec.inspect()).ExitCode ?? null;
    } catch {
      session.exitCode = null;
    }
    if (session.cli === "claude") {
      await captureClaudeToken(session).catch((err) =>
        console.error("token capture failed:", err)
      );
    }
  };
  stream.on("end", finish);
  stream.on("error", finish);

  sessions.set(session.id, session);
  pruneSessions();
  return session;
}

export function getSession(id: string): AuthSession | undefined {
  return sessions.get(id);
}

export function sessionView(s: AuthSession) {
  return {
    id: s.id,
    cli: s.cli,
    running: s.running,
    exitCode: s.exitCode,
    output: stripAnsi(s.output),
  };
}

export function writeToSession(s: AuthSession, text: string): void {
  if (!s.running) throw new Error("session is not running");
  // Raw-TTY input handling (Ink): Enter is "\r", and it must arrive as its
  // own stdin chunk — a long paste with "\r" in the same chunk is treated
  // as pasted text and never submits. Write the text first, then the CR
  // separately after a short delay.
  const clean = text.replace(/\r?\n+$/, "");
  if (clean.length > 0) s.stream.write(clean);
  setTimeout(() => {
    if (!s.running) return;
    try {
      s.stream.write("\r");
    } catch {
      /* stream already gone */
    }
  }, 150);
}

export function killSession(s: AuthSession): void {
  if (s.running) {
    try {
      s.stream.write("\x03"); // SIGINT to the TTY
    } catch {
      /* stream may already be gone */
    }
    s.stream.destroy();
    s.running = false;
  }
  // the user may close the dialog right after the token was printed —
  // still try to salvage it
  if (s.cli === "claude") {
    captureClaudeToken(s).catch(() => {});
  }
  sessions.delete(s.id);
}

function pruneSessions(): void {
  const now = Date.now();
  for (const s of sessions.values()) {
    if (now - s.createdAt > SESSION_TTL_MS) {
      if (s.running) s.stream.destroy();
      sessions.delete(s.id);
    }
  }
}
