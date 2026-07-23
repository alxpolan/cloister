import path from "node:path";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var ${name}`);
  return v;
}

export const config = {
  port: Number(process.env.PORT ?? 8080),
  host: process.env.HOST ?? "127.0.0.1",
  databaseUrl:
    process.env.DATABASE_URL ??
    "postgres://agent:agent@localhost:5433/agent_containers",
  secretsKey: required("SECRETS_KEY"),
  apiToken: process.env.API_TOKEN ?? "",
  homesDir: path.resolve(process.env.HOMES_DIR ?? "./homes"),
  hostHomesDir: process.env.HOST_HOMES_DIR ?? "",
  agentImage: process.env.AGENT_IMAGE ?? "agent-base:latest",
  containerPrefix: "agent-",
  agentMemoryMb: Number(process.env.AGENT_MEMORY_MB ?? 4096),
  agentCpus: Number(process.env.AGENT_CPUS ?? 2),
  agentPidsLimit: Number(process.env.AGENT_PIDS_LIMIT ?? 512),
};

export function hostHomePath(company: string): string {
  const base = config.hostHomesDir || config.homesDir;
  return path.posix.join(base, company);
}
