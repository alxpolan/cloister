const DEFAULT_API_URL = "http://localhost:8080";

const DEFAULT_PROMPT_TEMPLATE = [
  "You are agent {{agent.id}} ({{agent.name}}). Continue your Paperclip work.",
  "",
  "Execution contract:",
  "- Start actionable work in this heartbeat; do not stop at a plan unless the issue asks for planning.",
  "- Leave durable progress in comments, documents, or work products, then update the issue to a clear final disposition before ending the heartbeat.",
  "- Final disposition checklist: mark `done` when complete; use `in_review` only with a real reviewer path; use `blocked` only with a named unblock owner/action; keep `in_progress` only when a live continuation path exists.",
  "- Use the Paperclip API at $PAPERCLIP_API_URL (auth: $PAPERCLIP_API_KEY) to read your issue, add comments and update status.",
  "- If blocked, mark the issue blocked and name the unblock owner and action.",
  "- Respect budget, pause/cancel, approval gates, and company boundaries.",
].join("\n");

function str(value, fallback = "") {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function num(value, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function obj(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function resolvePath(data, path) {
  let cur = data;
  for (const part of path.split(".")) {
    if (cur == null || typeof cur !== "object") return "";
    cur = cur[part];
  }
  return cur == null ? "" : String(cur);
}

function renderTemplate(template, data) {
  return template.replace(/{{\s*([a-zA-Z0-9_.-]+)\s*}}/g, (_, p) => resolvePath(data, p));
}

function joinSections(sections) {
  return sections
    .map((s) => (typeof s === "string" ? s.trim() : ""))
    .filter(Boolean)
    .join("\n\n");
}

function hostReachableFromContainer(url) {
  try {
    const parsed = new URL(url);
    if (["localhost", "127.0.0.1", "0.0.0.0", "::1"].includes(parsed.hostname)) {
      parsed.hostname = "host.docker.internal";
      return parsed.toString().replace(/\/$/, "");
    }
    return url;
  } catch {
    return url;
  }
}

function paperclipApiUrl() {
  const configured =
    process.env.PAPERCLIP_RUNTIME_API_URL ?? process.env.PAPERCLIP_API_URL ?? "";
  if (configured) return hostReachableFromContainer(configured);
  const port = process.env.PAPERCLIP_LISTEN_PORT ?? process.env.PORT ?? "3100";
  return `http://host.docker.internal:${port}`;
}

function containersApiUrl() {
  return process.env.AGENT_CONTAINERS_API_URL ?? DEFAULT_API_URL;
}

function containersApiToken() {
  return process.env.AGENT_CONTAINERS_API_TOKEN ?? "";
}

function resolveCliAndModel(config) {
  const raw = str(config?.model);
  let cli = "claude";
  let model = "";

  if (raw.includes(":")) {
    const idx = raw.indexOf(":");
    cli = raw.slice(0, idx) === "codex" ? "codex" : "claude";

    const rest = raw.slice(idx + 1);
    model = rest === "default" ? "" : rest;
  } else if (raw === "codex" || raw === "claude") {
    cli = raw;
  } else if (raw) {
    model = raw;
  }

  const explicitCli = str(config?.cli);
  if (explicitCli === "claude" || explicitCli === "codex") cli = explicitCli;
  return { cli, model };
}

async function deriveCompanySlug(paperclipCompanyId) {
  if (!paperclipCompanyId) return "";
  try {
    const port = process.env.PAPERCLIP_LISTEN_PORT ?? process.env.PORT ?? "3100";
    const res = await fetch(`http://localhost:${port}/api/companies`, {
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) return "";
    const companies = await res.json();
    const company = companies.find((c) => c.id === paperclipCompanyId);

    if (!company?.name) return "";
    const slug = company.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");

    const containers = await api("/containers");
    return containers.some((c) => c.company === slug) ? slug : "";
  } catch {
    return "";
  }
}

async function api(path, init) {
  const headers = {};
  if (init?.body) headers["content-type"] = "application/json";
  const token = containersApiToken();
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`${containersApiUrl()}${path}`, { ...init, headers });
  const body = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(body.error ?? `agent-containers ${path} failed: HTTP ${res.status}`);
  }
  return body;
}

function postJsonLongPoll(path, payload, timeoutMs) {
  return new Promise((resolve, reject) => {
    import("node:http").then((http) => {
      const url = new URL(`${containersApiUrl()}${path}`);
      const data = JSON.stringify(payload);
      const token = containersApiToken();
      const req = http.request(
        {
          hostname: url.hostname,
          port: url.port || 80,
          path: url.pathname,
          method: "POST",
          headers: {
            "content-type": "application/json",
            "content-length": Buffer.byteLength(data),
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
        },
        (res) => {
          let raw = "";
          res.on("data", (c) => (raw += c));
          res.on("end", () => {
            let body = {};
            try {
              body = JSON.parse(raw);
            } catch {
            }
            if (res.statusCode >= 200 && res.statusCode < 300) resolve(body);
            else reject(new Error(body.error ?? `agent-containers ${path} failed: HTTP ${res.statusCode}`));
          });
        }
      );
      const deadline = setTimeout(() => {
        req.destroy(new Error(`agent-containers ${path} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      req.on("close", () => clearTimeout(deadline));
      req.on("error", reject);
      req.write(data);
      req.end();
    }, reject);
  });
}

export function createServerAdapter() {
  return {
    type: "claude_docker",
    label: "Agent Container (Claude / Codex)",
    supportsLocalAgentJwt: true,
    supportsInstructionsBundle: false,

    models: [
      { id: "claude:fable", label: "Claude Code — Fable" },
      { id: "claude:opus", label: "Claude Code — Opus" },
      { id: "claude:sonnet", label: "Claude Code — Sonnet" },
      { id: "claude:haiku", label: "Claude Code — Haiku" },
      { id: "codex:gpt-5.6-sol", label: "Codex — GPT-5.6 Sol" },
      { id: "codex:gpt-5.6-terra", label: "Codex — GPT-5.6 Terra" },
      { id: "codex:gpt-5.6-luna", label: "Codex — GPT-5.6 Luna" },
    ],

    agentConfigurationDoc: [
      "# claude_docker agent configuration",
      "",
      "Adapter: claude_docker — runs each heartbeat inside the tenant's isolated",
      "Docker container via the agent-containers backend (POST /run).",
      "",
      "Core fields:",
      "- company (string, required): agent-containers company slug, e.g. `marteso`",
      '- model (string, optional): "claude" (default) or "codex" — set via the model picker',
      '- cli (string, optional): explicit override of the model-based CLI choice',
      "- timeoutSec (number, optional): run timeout, default 900",
      "- promptTemplate (string, optional): overrides the default heartbeat prompt",
      "- env (object, optional): extra env vars injected into the container exec",
      "",
      "The container must be running and the chosen CLI authenticated",
      "(see the Agents dashboard). MCP servers and secrets are managed per",
      "company in agent-containers, not here.",
    ].join("\n"),

    async getConfigSchema() {
      let options = [];
      try {
        const containers = await api("/containers");
        options = containers.map((c) => ({
          value: c.company,
          label: `${c.name} (agent-${c.company}${c.status === "running" ? "" : ", stopped"})`,
        }));
      } catch {
      }
      return {
        fields: [
          {
            key: "company",
            type: options.length > 0 ? "select" : "text",
            label: "Container",
            hint: "agent-containers company slug this agent runs in",
            required: true,
            ...(options.length > 0 ? { options } : {}),
          },
          { key: "timeoutSec", type: "number", label: "Timeout (seconds)", required: false },
          { key: "promptTemplate", type: "textarea", label: "Prompt template", required: false },
        ],
      };
    },

    async execute(ctx) {
      const { runId, agent, config, context, onLog, authToken } = ctx;
      let company = str(config.company);

      if (!company) {
        company = await deriveCompanySlug(agent.companyId);
        if (company) {
          await onLog(
            "stdout",
            `[claude_docker] no container configured — derived '${company}' from the Paperclip company name\n`
          );
        }
      }

      if (!company) {
        throw new Error(
          "claude_docker: no container configured and no container matches the Paperclip company name — set adapterConfig.company to a slug from the Agents dashboard"
        );
      }
      const { cli, model } = resolveCliAndModel(config);
      const timeoutSec = num(config.timeoutSec, 1800);
      const templateData = {
        agentId: agent.id,
        companyId: agent.companyId,
        runId,
        company: { id: agent.companyId },
        agent,
        run: { id: runId, source: "on_demand" },
        context,
      };

      const wake = context?.paperclipWake;
      const wakeSection = wake
        ? "## Wake payload\n```json\n" + JSON.stringify(wake, null, 2) + "\n```"
        : "";
        
      const prompt = joinSections([
        wakeSection,
        str(context?.paperclipSessionHandoffMarkdown),
        str(context?.paperclipTaskMarkdown),
        renderTemplate(str(config.promptTemplate, DEFAULT_PROMPT_TEMPLATE), templateData),
      ]);

      const scratchDir = `/tmp/paperclip-run-${runId}`;
      const configEnv = Object.fromEntries(
        Object.entries(obj(config.env)).filter(
          ([k, v]) => typeof v === "string" && !v.startsWith("/Users/") && !v.startsWith("/var/folders/")
        )
      );
      const env = {
        ...configEnv,
        PAPERCLIP_AGENT_ID: agent.id,
        PAPERCLIP_COMPANY_ID: agent.companyId,
        PAPERCLIP_RUN_ID: runId,
        PAPERCLIP_API_URL: paperclipApiUrl(),
        ...(authToken ? { PAPERCLIP_API_KEY: authToken } : {}),
        TMPDIR: "/tmp",
        PAPERCLIP_TMPDIR: scratchDir,
        PAPERCLIP_SCRATCH_DIR: scratchDir,
        PAPERCLIP_RUN_SCRATCH_DIR: scratchDir,
        PAPERCLIP_TASK_SCRATCH_DIR: scratchDir,
      };

      await onLog(
        "stdout",
        `[claude_docker] dispatching run to container agent-${company} (cli=${cli}${model ? ", model=" + model : ""})\n`
      );

      const startedAt = Date.now();
      const keepAlive = setInterval(() => {
        const elapsed = Math.round((Date.now() - startedAt) / 1000);
        onLog("stdout", `[claude_docker] container still working (${elapsed}s elapsed)\n`).catch(() => { });
      }, 15000);

      let body;
      try {
        body = await postJsonLongPoll(
          "/run",
          { company, prompt, cli, ...(model ? { model } : {}), timeoutMs: timeoutSec * 1000, env },
          (timeoutSec + 60) * 1000
        );
      } catch (err) {
        clearInterval(keepAlive);
        await onLog("stderr", `[claude_docker] ${err.message}\n`);
        return {
          exitCode: null,
          signal: null,
          timedOut: /timed out|timeout/i.test(String(err.message)),
          errorMessage: String(err.message),
          errorCode: "dispatch_failed",
        };
      }
      clearInterval(keepAlive);

      if (body.stdout) await onLog("stdout", body.stdout);
      if (body.stderr) await onLog("stderr", body.stderr);

      const exitCode = typeof body.exitCode === "number" ? body.exitCode : null;
      return {
        exitCode,
        signal: null,
        timedOut: false,
        errorMessage:
          exitCode === 0
            ? null
            : (str(body.stderr) || str(body.stdout) || "run failed").slice(0, 2000),
        resultJson: { stdout: body.stdout ?? "", stderr: body.stderr ?? "" },
      };
    },

    async testEnvironment(ctx) {
      const checks = [];
      const company =
        str(ctx.config?.company) || (await deriveCompanySlug(ctx.companyId));
      try {
        const health = await api("/health");
        checks.push({
          code: "backend",
          level: health.ok ? "info" : "error",
          message: health.ok
            ? `agent-containers backend reachable at ${containersApiUrl()}`
            : "agent-containers backend unhealthy",
        });
      } catch (err) {
        checks.push({
          code: "backend",
          level: "error",
          message: `agent-containers backend not reachable at ${containersApiUrl()}`,
          detail: String(err.message),
          hint: "docker compose up in the agent-containers repo",
        });
      }
      if (!company) {
        checks.push({
          code: "config",
          level: "error",
          message:
            "no container configured — pick one in the adapter settings (or name the Paperclip company like its container slug)",
        });
      } else {
        try {
          const containers = await api("/containers");
          const c = containers.find((x) => x.company === company);
          if (!c) {
            checks.push({
              code: "container",
              level: "error",
              message: `no container for company '${company}'`,
              hint: "create it in the Agents dashboard",
            });
          } else {
            checks.push({
              code: "container",
              level: c.status === "running" ? "info" : "warn",
              message: `container agent-${company} is ${c.status}`,
            });
            const { cli } = resolveCliAndModel(ctx.config);
            const authed = cli === "codex" ? c.codexAuthenticated : c.claudeAuthenticated;
            checks.push({
              code: "cli_auth",
              level: authed ? "info" : "error",
              message: `${cli} is ${authed ? "" : "NOT "}authenticated in this container`,
              hint: authed ? null : "use the login button in the Agents dashboard",
            });
          }
        } catch (err) {
          checks.push({
            code: "container",
            level: "error",
            message: "could not list containers",
            detail: String(err.message),
          });
        }
      }
      const status = checks.some((c) => c.level === "error")
        ? "fail"
        : checks.some((c) => c.level === "warn")
          ? "warn"
          : "pass";
      return {
        adapterType: "claude_docker",
        status,
        checks,
        testedAt: new Date().toISOString(),
      };
    },
  };
}
