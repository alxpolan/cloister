import Fastify from "fastify";
import cors from "@fastify/cors";
import { config } from "./config.js";
import { migrate, pool } from "./db.js";
import { initCrypto } from "./crypto.js";
import { registerRoutes } from "./routes.js";
import { docker, resolveHostHomesDir } from "./docker.js";

async function main(): Promise<void> {
  await initCrypto();
  await migrate();
  await resolveHostHomesDir();

  const app = Fastify({ logger: true });
  await app.register(cors, { origin: true });

  app.get("/health", async () => {
    const db = await pool
      .query("SELECT 1")
      .then(() => true)
      .catch(() => false);
    const dockerOk = await docker
      .ping()
      .then(() => true)
      .catch(() => false);
    return { ok: db && dockerOk, db, docker: dockerOk };
  });

  await registerRoutes(app);
  await app.listen({ port: config.port, host: "0.0.0.0" });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
