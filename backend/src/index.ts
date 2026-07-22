import Fastify from "fastify";
import cors from "@fastify/cors";
import { timingSafeEqual } from "node:crypto";
import { config } from "./config.js";
import { migrate, pool } from "./db.js";
import { initCrypto } from "./crypto.js";
import { registerRoutes } from "./routes.js";
import { docker, resolveHostHomesDir } from "./docker.js";

function tokenMatches(provided: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(config.apiToken);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function main(): Promise<void> {
  await initCrypto();
  await migrate();
  await resolveHostHomesDir();

  const app = Fastify({ logger: true });
  await app.register(cors, { origin: true });

  if (!config.apiToken) {
    app.log.warn(
      "API_TOKEN is not set — the API is UNAUTHENTICATED. Set API_TOKEN in .env for any non-throwaway use.",
    );
  }

  const publicImage =
    /^\/(containers\/[^/]+\/icon|mcp-catalog\/[^/]+\/favicon)(\?|$)/;
    
  app.addHook("onRequest", async (req, reply) => {
    if (!config.apiToken) return;
    if (req.method === "OPTIONS" || req.url === "/health") return;
    if (req.method === "GET" && publicImage.test(req.url)) return;
    const header = req.headers.authorization ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!token || !tokenMatches(token)) {
      return reply
        .code(401)
        .send({ error: "unauthorized: missing or invalid API token" });
    }
  });

  app.get("/health", async () => {
    const db = await pool
      .query("SELECT 1")
      .then(() => true)
      .catch(() => false);
    const dockerOk = await docker
      .ping()
      .then(() => true)
      .catch(() => false);
    return {
      ok: db && dockerOk,
      db,
      docker: dockerOk,
      authRequired: Boolean(config.apiToken),
    };
  });

  await registerRoutes(app);
  await app.listen({ port: config.port, host: config.host });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
