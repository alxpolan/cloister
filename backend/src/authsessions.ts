import { randomUUID } from "node:crypto";
import type { Duplex } from "node:stream";
import { docker, containerName } from "./docker.js";
import { CONTAINER_WORKSPACE } from "./configgen.js";

/**
 * Interactive auth sessions: a TTY exec inside a tenant container whose
 * output is buffered for the dashboard and whose stdin accepts pasted
 * codes/answers. Used for `claude setup-token` and `codex login` — both
 * print an OAuth URL and (for claude) expect a code pasted back.
 */
export interface AuthSession {
  id: string;
  containerId: string;
  cli: "claude" | "codex";
  running: boolean;
  exitCode: number | null;
  createdAt: number;
  output: string;
  stream: Duplex;
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
  s.stream.write(text.endsWith("\n") ? text : text + "\n");
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
