import path from "node:path";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var ${name}`);
  return v;
}

export const config = {
  port: Number(process.env.PORT ?? 8080),
  databaseUrl:
    process.env.DATABASE_URL ??
    "postgres://agent:agent@localhost:5433/agent_containers",
  /** 32-byte key as 64-char hex string. Generate: openssl rand -hex 32 */
  secretsKey: required("SECRETS_KEY"),
  /**
   * Where the backend process reads/writes the per-company home dirs.
   * When the backend itself runs in a container this is the mount point
   * inside the backend container (e.g. /app/homes).
   */
  homesDir: path.resolve(process.env.HOMES_DIR ?? "./homes"),
  /**
   * The same directory as seen by the Docker daemon (host path). Bind
   * mounts for agent containers must use this path, because the daemon
   * resolves bind sources on the host, not inside the backend container.
   * Left empty it is auto-detected at startup from the backend's own
   * mounts (see resolveHostHomesDir); on a plain host run it falls back
   * to homesDir.
   */
  hostHomesDir: process.env.HOST_HOMES_DIR ?? "",
  agentImage: process.env.AGENT_IMAGE ?? "agent-base:latest",
  containerPrefix: "agent-",
};

export function hostHomePath(company: string): string {
  const base = config.hostHomesDir || config.homesDir;
  return path.posix.join(base, company);
}
