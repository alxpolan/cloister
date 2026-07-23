import type { FastifyInstance } from "fastify";
import {
  CATALOG_COLS,
  pool,
  type AccountRow,
  type CatalogRow,
  type ContainerRow,
  type RunRow,
} from "./db.js";
import { assignmentSummary, getAssignments } from "./mcps.js";
import {
  dockerState,
  execInContainer,
  removeContainer,
  releaseAuthPort,
  resolveAllEnv,
  startCodexAuthProxy,
  startContainer,
  stopContainer,
} from "./docker.js";
import { CLAUDE_TOKEN_ENV } from "./authsessions.js";
import { authStatus, ensureHomeDir } from "./configgen.js";
import { deleteSecret, listSecretRefs, storeSecret } from "./crypto.js";
import { config, hostHomePath } from "./config.js";
import {
  attachMcpWatcher,
  createAuthSession,
  getSession,
  killSession,
  sessionView,
  writeToSession,
} from "./authsessions.js";
import { isOAuthHttp, type McpServerDef } from "./configgen.js";

const COMPANY_RE = /^[a-z0-9][a-z0-9-]{1,40}$/;

function faviconDomain(entry: {
  key: string;
  website: string | null;
  config_json: Record<string, unknown>;
}): string {
  if (entry.website) return entry.website;
  const url = entry.config_json?.url;
  if (typeof url === "string") {
    try {
      const host = new URL(url).hostname;
      return host.split(".").slice(-2).join(".");
    } catch {}
  }
  return `${entry.key}.com`;
}

async function getContainerRow(id: string): Promise<ContainerRow | null> {
  const { rows } = await pool.query<ContainerRow>(
    "SELECT * FROM containers WHERE id = $1",
    [id],
  );
  return rows[0] ?? null;
}

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  // ---------- containers ----------

  app.get("/containers", async () => {
    const { rows } = await pool.query<
      ContainerRow & { has_icon: boolean; icon_version: number }
    >(
      `SELECT id, name, company, status, home_path, mcp_config_json, git_name, git_email,
              mem_mb, cpus, pids_limit, created_at,
              (icon IS NOT NULL) AS has_icon,
              COALESCE(extract(epoch FROM icon_updated_at), 0)::bigint AS icon_version
       FROM containers ORDER BY created_at`,
    );
    const { rows: accounts } = await pool.query<AccountRow>(
      "SELECT * FROM accounts ORDER BY created_at",
    );
    const { rows: tokenRows } = await pool.query<{ container_id: string }>(
      `SELECT a.container_id FROM accounts a
       JOIN secrets s ON s.ref = a.secret_ref
       WHERE a.env_var = $1`,
      [CLAUDE_TOKEN_ENV],
    );
    const tokenAuth = new Set(tokenRows.map((r) => r.container_id));
    return Promise.all(
      rows.map(async (c) => {
        const [state, auth] = await Promise.all([
          dockerState(c.company),
          authStatus(c.company),
        ]);
        auth.claude = auth.claude || tokenAuth.has(c.id);
        const status = state === "running" ? "running" : "stopped";
        if (status !== c.status) {
          await pool.query("UPDATE containers SET status = $1 WHERE id = $2", [
            status,
            c.id,
          ]);
        }
        return {
          ...c,
          status,
          claudeAuthenticated: auth.claude,
          codexAuthenticated: auth.codex,
          accounts: accounts.filter((a) => a.container_id === c.id),
          mcps: await assignmentSummary(c.id, c.company),
          hasIcon: c.has_icon,
          iconVersion: Number(c.icon_version),
          resources: {
            memMb: c.mem_mb ?? config.agentMemoryMb,
            cpus: c.cpus ?? config.agentCpus,
            pidsLimit: c.pids_limit ?? config.agentPidsLimit,
            isDefault: c.mem_mb === null && c.cpus === null && c.pids_limit === null,
          },
        };
      }),
    );
  });

  app.post<{ Body: { name: string; company: string } }>(
    "/containers",
    async (req, reply) => {
      const { name, company } = req.body ?? ({} as any);
      if (!name || !company || !COMPANY_RE.test(company)) {
        return reply.code(400).send({
          error:
            "name and company required; company must match [a-z0-9][a-z0-9-]{1,40} (used as directory and container name)",
        });
      }
      await ensureHomeDir(company);
      try {
        const { rows } = await pool.query<ContainerRow>(
          `INSERT INTO containers (name, company, home_path)
         VALUES ($1, $2, $3) RETURNING *`,
          [name, company, hostHomePath(company)],
        );
        return reply.code(201).send(rows[0]);
      } catch (err: any) {
        if (err.code === "23505") {
          return reply
            .code(409)
            .send({ error: "name or company already exists" });
        }
        throw err;
      }
    },
  );

  app.post<{ Params: { id: string } }>(
    "/containers/:id/start",
    async (req, reply) => {
      const row = await getContainerRow(req.params.id);
      if (!row) return reply.code(404).send({ error: "not found" });
      await startContainer(row);
      return { ok: true, status: "running" };
    },
  );

  app.post<{ Params: { id: string } }>(
    "/containers/:id/stop",
    async (req, reply) => {
      const row = await getContainerRow(req.params.id);
      if (!row) return reply.code(404).send({ error: "not found" });
      await stopContainer(row);
      return { ok: true, status: "stopped" };
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/containers/:id",
    async (req, reply) => {
      const row = await getContainerRow(req.params.id);
      if (!row) return reply.code(404).send({ error: "not found" });
      await removeContainer(row);
      await pool.query("DELETE FROM containers WHERE id = $1", [row.id]);
      return { ok: true };
    },
  );

  app.put<{
    Params: { id: string };
    Body: { mcpServers: Record<string, unknown> };
  }>("/containers/:id/mcp-config", async (req, reply) => {
    const row = await getContainerRow(req.params.id);
    if (!row) return reply.code(404).send({ error: "not found" });
    const mcpServers = req.body?.mcpServers;
    if (
      !mcpServers ||
      typeof mcpServers !== "object" ||
      Array.isArray(mcpServers)
    ) {
      return reply
        .code(400)
        .send({ error: "body must be { mcpServers: { ... } }" });
    }
    const { rows } = await pool.query<ContainerRow>(
      "UPDATE containers SET mcp_config_json = $1 WHERE id = $2 RETURNING *",
      [JSON.stringify({ mcpServers }), row.id],
    );
    return { ok: true, container: rows[0], note: "applies on next start" };
  });

  app.put<{ Params: { id: string }; Body: { name?: string; email?: string } }>(
    "/containers/:id/git-identity",
    async (req, reply) => {
      const row = await getContainerRow(req.params.id);
      if (!row) return reply.code(404).send({ error: "not found" });
      const { name, email } = req.body ?? ({} as any);
      await pool.query(
        "UPDATE containers SET git_name = $1, git_email = $2 WHERE id = $3",
        [name?.trim() || null, email?.trim() || null, row.id]
      );
      return { ok: true, note: "applies on next start" };
    }
  );

  app.put<{
    Params: { id: string };
    Body: { memMb?: number | null; cpus?: number | null; pidsLimit?: number | null };
  }>("/containers/:id/resources", async (req, reply) => {
    const row = await getContainerRow(req.params.id);
    if (!row) return reply.code(404).send({ error: "not found" });
    const { memMb, cpus, pidsLimit } = req.body ?? ({} as any);
    const clean = (v: unknown, min: number) =>
      typeof v === "number" && Number.isFinite(v) && v >= min ? v : null;
    await pool.query(
      "UPDATE containers SET mem_mb = $1, cpus = $2, pids_limit = $3 WHERE id = $4",
      [clean(memMb, 256), clean(cpus, 0.25), clean(pidsLimit, 16), row.id]
    );
    return { ok: true, note: "applies on next start" };
  });

  // ---------- container icons ----------

  app.get<{ Params: { id: string } }>(
    "/containers/:id/icon",
    async (req, reply) => {
      const { rows } = await pool.query(
        "SELECT icon, icon_mime FROM containers WHERE id = $1",
        [req.params.id],
      );
      if (!rows[0]?.icon) return reply.code(404).send({ error: "no icon" });
      return reply
        .header("Cache-Control", "public, max-age=31536000, immutable")
        .type(rows[0].icon_mime ?? "image/png")
        .send(rows[0].icon);
    },
  );

  app.put<{ Params: { id: string }; Body: { data: string; mime: string } }>(
    "/containers/:id/icon",
    { bodyLimit: 8 * 1024 * 1024 },
    async (req, reply) => {
      const { data, mime } = req.body ?? ({} as any);
      if (!data || !mime?.startsWith("image/")) {
        return reply
          .code(400)
          .send({ error: "body must be { data: <base64>, mime: image/* }" });
      }
      const buf = Buffer.from(data, "base64");
      if (buf.length === 0 || buf.length > 2 * 1024 * 1024) {
        return reply
          .code(400)
          .send({ error: "icon must be between 1 byte and 2 MB" });
      }
      const { rowCount } = await pool.query(
        "UPDATE containers SET icon = $1, icon_mime = $2, icon_updated_at = now() WHERE id = $3",
        [buf, mime, req.params.id],
      );
      if (!rowCount) return reply.code(404).send({ error: "not found" });
      return { ok: true };
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/containers/:id/icon",
    async (req, reply) => {
      const { rowCount } = await pool.query(
        "UPDATE containers SET icon = NULL, icon_mime = NULL, icon_updated_at = now() WHERE id = $1",
        [req.params.id],
      );
      if (!rowCount) return reply.code(404).send({ error: "not found" });
      return { ok: true };
    },
  );

  // ---------- MCP catalog & assignments ----------

  app.get("/mcp-catalog", async () => {
    const { rows } = await pool.query<CatalogRow>(
      `SELECT ${CATALOG_COLS} FROM mcp_catalog ORDER BY label`,
    );
    return rows;
  });

  // ---------- catalog favicons (fetched like Claude does, cached in DB) ----

  app.get<{ Params: { id: string } }>(
    "/mcp-catalog/:id/favicon",
    async (req, reply) => {
      const { rows } = await pool.query(
        `SELECT ${CATALOG_COLS}, favicon, favicon_mime, favicon_fetched_at
       FROM mcp_catalog WHERE id = $1`,
        [req.params.id],
      );
      const entry = rows[0];
      if (!entry) return reply.code(404).send({ error: "not found" });

      const fresh =
        entry.favicon &&
        entry.favicon_fetched_at &&
        Date.now() - new Date(entry.favicon_fetched_at).getTime() <
          7 * 24 * 3600 * 1000;

      if (!fresh) {
        const domain = faviconDomain(entry);
        try {
          const res = await fetch(
            `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`,
            { signal: AbortSignal.timeout(5000) },
          );
          if (res.ok) {
            const buf = Buffer.from(await res.arrayBuffer());
            const mime = res.headers.get("content-type") ?? "image/png";
            await pool.query(
              "UPDATE mcp_catalog SET favicon = $1, favicon_mime = $2, favicon_fetched_at = now() WHERE id = $3",
              [buf, mime, entry.id],
            );
            entry.favicon = buf;
            entry.favicon_mime = mime;
          }
        } catch {}
      }

      if (!entry.favicon) return reply.code(404).send({ error: "no favicon" });
      return reply
        .header("Cache-Control", "public, max-age=86400")
        .type(entry.favicon_mime ?? "image/png")
        .send(entry.favicon);
    },
  );

  app.post<{
    Body: {
      key: string;
      label: string;
      icon?: string;
      website?: string;
      config: Record<string, unknown>;
      secrets?: { env: string; label: string }[];
    };
  }>("/mcp-catalog", async (req, reply) => {
    const {
      key,
      label,
      icon,
      website,
      config: cfg,
      secrets,
    } = req.body ?? ({} as any);
    if (!key || !label || !cfg || typeof cfg !== "object") {
      return reply.code(400).send({ error: "key, label and config required" });
    }
    try {
      const { rows } = await pool.query<CatalogRow>(
        `INSERT INTO mcp_catalog (key, label, icon, website, config_json, secrets_json)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${CATALOG_COLS}`,
        [
          key,
          label,
          icon ?? "globe",
          website?.trim() || null,
          JSON.stringify(cfg),
          JSON.stringify(secrets ?? []),
        ],
      );
      return reply.code(201).send(rows[0]);
    } catch (err: any) {
      if (err.code === "23505")
        return reply.code(409).send({ error: "key already exists" });
      throw err;
    }
  });

  app.put<{
    Params: { id: string };
    Body: {
      label?: string;
      icon?: string;
      config?: Record<string, unknown>;
      secrets?: { env: string; label: string }[];
    };
  }>("/mcp-catalog/:id", async (req, reply) => {
    const { label, icon, config: cfg, secrets } = req.body ?? ({} as any);
    const { rows } = await pool.query<CatalogRow>(
      `UPDATE mcp_catalog SET
         label = COALESCE($2, label),
         icon = COALESCE($3, icon),
         config_json = COALESCE($4, config_json),
         secrets_json = COALESCE($5, secrets_json)
       WHERE id = $1 RETURNING *`,
      [
        req.params.id,
        label ?? null,
        icon ?? null,
        cfg ? JSON.stringify(cfg) : null,
        secrets ? JSON.stringify(secrets) : null,
      ],
    );
    if (rows.length === 0) return reply.code(404).send({ error: "not found" });
    return {
      ok: true,
      entry: rows[0],
      note: "applies to containers on next start",
    };
  });

  app.delete<{ Params: { id: string } }>(
    "/mcp-catalog/:id",
    async (req, reply) => {
      const { rowCount } = await pool.query(
        "DELETE FROM mcp_catalog WHERE id = $1",
        [req.params.id],
      );
      if (!rowCount) return reply.code(404).send({ error: "not found" });
      return { ok: true };
    },
  );

  app.get<{ Params: { id: string } }>(
    "/containers/:id/mcps",
    async (req, reply) => {
      const row = await getContainerRow(req.params.id);
      if (!row) return reply.code(404).send({ error: "not found" });
      return getAssignments(row.id);
    },
  );

  app.put<{
    Params: { id: string };
    Body: {
      assignments: { catalog_id: string; bindings?: Record<string, string> }[];
    };
  }>("/containers/:id/mcps", async (req, reply) => {
    const row = await getContainerRow(req.params.id);
    if (!row) return reply.code(404).send({ error: "not found" });
    const assignments = req.body?.assignments;
    if (!Array.isArray(assignments)) {
      return reply
        .code(400)
        .send({ error: "body must be { assignments: [...] }" });
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("DELETE FROM container_mcps WHERE container_id = $1", [
        row.id,
      ]);
      for (const a of assignments) {
        await client.query(
          `INSERT INTO container_mcps (container_id, catalog_id, bindings_json)
           VALUES ($1, $2, $3)`,
          [row.id, a.catalog_id, JSON.stringify(a.bindings ?? {})],
        );
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
    return {
      ok: true,
      assignments: await getAssignments(row.id),
      note: "applies on next start",
    };
  });

  // ---------- accounts ----------

  app.put<{
    Params: { id: string };
    Body: {
      accounts: {
        type: string;
        label: string;
        role?: string;
        env_var?: string;
        secret_ref?: string;
      }[];
    };
  }>("/containers/:id/accounts", async (req, reply) => {
    const row = await getContainerRow(req.params.id);
    if (!row) return reply.code(404).send({ error: "not found" });
    const accounts = req.body?.accounts;
    if (!Array.isArray(accounts)) {
      return reply
        .code(400)
        .send({ error: "body must be { accounts: [...] }" });
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("DELETE FROM accounts WHERE container_id = $1", [
        row.id,
      ]);
      for (const a of accounts) {
        if (!a.type || !a.label)
          throw new Error("account entries need type and label");
        await client.query(
          `INSERT INTO accounts (container_id, type, label, role, env_var, secret_ref)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            row.id,
            a.type,
            a.label,
            a.role ?? "",
            a.env_var ?? null,
            a.secret_ref ?? null,
          ],
        );
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
    const { rows: saved } = await pool.query<AccountRow>(
      "SELECT * FROM accounts WHERE container_id = $1 ORDER BY created_at",
      [row.id],
    );
    return { ok: true, accounts: saved, note: "env vars apply on next start" };
  });

  // ---------- secrets ----------

  app.get("/secrets", async () => {
    return listSecretRefs();
  });

  app.put<{ Body: { ref: string; value: string } }>(
    "/secrets",
    async (req, reply) => {
      const { ref, value } = req.body ?? ({} as any);
      if (!ref || !value)
        return reply.code(400).send({ error: "ref and value required" });
      await storeSecret(ref, value);
      return { ok: true, ref };
    },
  );

  app.delete<{ Params: { ref: string } }>("/secrets/:ref", async (req) => {
    await deleteSecret(req.params.ref);
    return { ok: true };
  });

  // ---------- interactive CLI auth sessions ----------

  app.post<{ Params: { id: string; cli: string } }>(
    "/containers/:id/auth/:cli",
    async (req, reply) => {
      const row = await getContainerRow(req.params.id);
      if (!row) return reply.code(404).send({ error: "not found" });
      const cli = req.params.cli;

      if (cli.startsWith("mcp:")) {
        const key = cli.slice(4);
        const assignments = await getAssignments(row.id);
        const assignment = assignments.find((a) => a.key === key);
        if (!assignment) {
          return reply
            .code(404)
            .send({ error: `MCP '${key}' is not assigned to this container` });
        }
        const def = assignment.config_json as McpServerDef;
        if (!isOAuthHttp(def) || !def.url) {
          return reply
            .code(400)
            .send({
              error: `MCP '${key}' uses token auth, nothing to authorize`,
            });
        }
        await releaseAuthPort(row.company);
        await startContainer(row, { codexAuthPort: true });
        await startCodexAuthProxy(row.company);
        const session = await createAuthSession(row.company, row.id, "mcp", [
          "mcp-remote",
          def.url,
          "1455",
        ]);
        attachMcpWatcher(session, def.url);
        return reply.code(201).send({
          sessionId: session.id,
          note: `open the authorization URL in your browser; the session finishes on its own once the token is stored`,
        });
      }

      if (cli !== "claude" && cli !== "codex") {
        return reply
          .code(400)
          .send({ error: "cli must be claude, codex or mcp:<key>" });
      }

      if (cli === "codex") {
        await releaseAuthPort(row.company);
        await startContainer(row, { codexAuthPort: true });
        await startCodexAuthProxy(row.company);
      } else if ((await dockerState(row.company)) !== "running") {
        return reply
          .code(409)
          .send({ error: "container must be running; start it first" });
      }

      const cmd =
        cli === "claude" ? ["claude", "setup-token"] : ["codex", "login"];
      const session = await createAuthSession(row.company, row.id, cli, cmd);
      return reply.code(201).send({
        sessionId: session.id,
        note:
          cli === "codex"
            ? "container restarted with port 1455 published; a plain restart removes it again"
            : "open the printed URL, then paste the code back as input",
      });
    },
  );

  app.get<{ Params: { sid: string } }>(
    "/auth-sessions/:sid",
    async (req, reply) => {
      const s = getSession(req.params.sid);
      if (!s) return reply.code(404).send({ error: "unknown session" });
      return sessionView(s);
    },
  );

  app.post<{ Params: { sid: string }; Body: { text: string } }>(
    "/auth-sessions/:sid/input",
    async (req, reply) => {
      const s = getSession(req.params.sid);
      if (!s) return reply.code(404).send({ error: "unknown session" });
      const text = req.body?.text;
      if (typeof text !== "string") {
        return reply.code(400).send({ error: "body must be { text: string }" });
      }
      writeToSession(s, text);
      return { ok: true };
    },
  );

  app.delete<{ Params: { sid: string } }>(
    "/auth-sessions/:sid",
    async (req, reply) => {
      const s = getSession(req.params.sid);
      if (!s) return reply.code(404).send({ error: "unknown session" });
      killSession(s);
      return { ok: true };
    },
  );

  // ---------- run (Paperclip adapter endpoint) ----------

  app.post<{
    Body: {
      company: string;
      prompt: string;
      cli?: "claude" | "codex";
      model?: string;
      timeoutMs?: number;
      env?: Record<string, string>;
    };
  }>("/run", async (req, reply) => {
    const {
      company,
      prompt,
      cli = "claude",
      model,
      timeoutMs,
      env: extraEnv,
    } = req.body ?? ({} as any);
    if (!company || !prompt) {
      return reply.code(400).send({ error: "company and prompt required" });
    }
    const { rows } = await pool.query<ContainerRow>(
      "SELECT * FROM containers WHERE company = $1",
      [company],
    );
    const row = rows[0];
    if (!row)
      return reply.code(404).send({ error: `unknown company '${company}'` });

    const state = await dockerState(company);
    if (state !== "running") {
      return reply
        .code(409)
        .send({
          error: `container for '${company}' is ${state}; start it first`,
        });
    }

    const modelArgs =
      typeof model === "string" && model.trim().length > 0
        ? cli === "codex"
          ? ["-m", model.trim()]
          : ["--model", model.trim()]
        : [];
    const cmd =
      cli === "codex"
        ? ["codex", "exec", "--skip-git-repo-check", ...modelArgs, prompt]
        : [
            "claude",
            "-p",
            prompt,
            "--output-format",
            "text",
            "--dangerously-skip-permissions",
            ...modelArgs,
          ];

    const requestEnv = Object.entries(extraEnv ?? {})
      .filter(([k, v]) => /^[A-Z][A-Z0-9_]*$/.test(k) && typeof v === "string")
      .map(([k, v]) => `${k}=${v}`);
    const env = [...(await resolveAllEnv(row.id)), ...requestEnv];

    const { rows: runRows } = await pool.query<{ id: string }>(
      `INSERT INTO runs (company, cli, model, source, prompt)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [company, cli, model?.trim() || null, req.headers["x-run-source"] ?? "api", prompt],
    );
    const runId = runRows[0].id;

    // buffer live output and flush to the DB at most every 2s so a running
    // run shows progress in the dashboard without hammering Postgres
    let outBuf = "";
    let errBuf = "";
    let dirty = false;
    const flush = async () => {
      if (!dirty) return;
      dirty = false;
      await pool
        .query("UPDATE runs SET stdout = $1, stderr = $2 WHERE id = $3", [outBuf, errBuf, runId])
        .catch(() => {});
    };
    const timer = setInterval(flush, 2000);

    try {
      const result = await execInContainer(company, cmd, timeoutMs, env, (streamName, chunk) => {
        if (streamName === "stdout") outBuf += chunk;
        else errBuf += chunk;
        dirty = true;
      });
      clearInterval(timer);
      await pool.query(
        `UPDATE runs SET status = $1, exit_code = $2, stdout = $3, stderr = $4, finished_at = now()
         WHERE id = $5`,
        [result.exitCode === 0 ? "succeeded" : "failed", result.exitCode, outBuf, errBuf, runId],
      );
      return {
        runId,
        company,
        cli,
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
      };
    } catch (err: any) {
      clearInterval(timer);
      await pool.query(
        `UPDATE runs SET status = 'failed', stdout = $1, stderr = $2, error = $3, finished_at = now()
         WHERE id = $4`,
        [outBuf, errBuf, String(err?.message ?? err), runId],
      );
      throw err;
    }
  });

  // ---------- run history ----------

  app.get<{ Querystring: { company?: string; limit?: string } }>(
    "/runs",
    async (req) => {
      const { company, limit } = req.query;
      const n = Math.min(Number(limit) || 50, 200);
      const params: unknown[] = [];
      let where = "";
      if (company) {
        params.push(company);
        where = "WHERE company = $1";
      }
      const { rows } = await pool.query<RunRow>(
        `SELECT id, company, cli, model, source, status, exit_code,
                left(prompt, 500) AS prompt, started_at, finished_at,
                length(stdout) AS stdout_len
         FROM runs ${where} ORDER BY started_at DESC LIMIT ${n}`,
        params,
      );
      return rows;
    },
  );

  app.get<{ Params: { id: string } }>("/runs/:id", async (req, reply) => {
    const { rows } = await pool.query<RunRow>("SELECT * FROM runs WHERE id = $1", [
      req.params.id,
    ]);
    if (!rows[0]) return reply.code(404).send({ error: "not found" });
    return rows[0];
  });
}
