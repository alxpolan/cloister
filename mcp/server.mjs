#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const API = process.env.AGENT_API_URL ?? "http://localhost:8080";

async function api(path, init) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: init?.body ? { "content-type": "application/json" } : undefined,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status} on ${path}`);
  return body;
}

async function containerByCompany(company) {
  const containers = await api("/containers");
  const c = containers.find((x) => x.company === company);
  if (!c) {
    const known = containers.map((x) => x.company).join(", ") || "none";
    throw new Error(`unknown company '${company}' (known: ${known})`);
  }
  return c;
}

function text(value) {
  return { content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }] };
}

function fail(err) {
  return { isError: true, content: [{ type: "text", text: String(err.message ?? err) }] };
}

const server = new McpServer({ name: "agent-containers", version: "0.1.0" });

server.tool(
  "list_containers",
  "List all tenant containers with status, CLI auth state and assigned MCP servers",
  {},
  async () => {
    try {
      const containers = await api("/containers");
      return text(
        containers.map((c) => ({
          company: c.company,
          name: c.name,
          status: c.status,
          claudeAuthenticated: c.claudeAuthenticated,
          codexAuthenticated: c.codexAuthenticated,
          mcps: c.mcps.map((m) => `${m.key}${m.secretsOk ? "" : " (token missing)"}`),
        }))
      );
    } catch (err) {
      return fail(err);
    }
  }
);

server.tool(
  "create_container",
  "Create a new tenant container (home dir + DB entry); start it afterwards with start_container",
  {
    name: z.string().describe("Display name, e.g. Marteso"),
    company: z.string().describe("Slug: lowercase letters, digits, hyphens"),
  },
  async ({ name, company }) => {
    try {
      return text(await api("/containers", { method: "POST", body: JSON.stringify({ name, company }) }));
    } catch (err) {
      return fail(err);
    }
  }
);

server.tool(
  "start_container",
  "Start (or recreate) the container for a company; regenerates MCP configs and injects secrets",
  { company: z.string() },
  async ({ company }) => {
    try {
      const c = await containerByCompany(company);
      return text(await api(`/containers/${c.id}/start`, { method: "POST" }));
    } catch (err) {
      return fail(err);
    }
  }
);

server.tool(
  "stop_container",
  "Stop the container for a company",
  { company: z.string() },
  async ({ company }) => {
    try {
      const c = await containerByCompany(company);
      return text(await api(`/containers/${c.id}/stop`, { method: "POST" }));
    } catch (err) {
      return fail(err);
    }
  }
);

server.tool(
  "run_agent",
  "Run a prompt with Claude Code or Codex inside a company's container and return stdout/exit code. The container must be running and the CLI authenticated.",
  {
    company: z.string(),
    prompt: z.string(),
    cli: z.enum(["claude", "codex"]).optional().describe("default: claude"),
    timeoutMs: z.number().optional().describe("default: 900000 (15 min)"),
  },
  async ({ company, prompt, cli, timeoutMs }) => {
    try {
      return text(await api("/run", { method: "POST", body: JSON.stringify({ company, prompt, cli, timeoutMs }) }));
    } catch (err) {
      return fail(err);
    }
  }
);

server.tool(
  "list_mcp_catalog",
  "List the global MCP server catalog (key, label, required secrets)",
  {},
  async () => {
    try {
      const entries = await api("/mcp-catalog");
      return text(
        entries.map((e) => ({
          key: e.key,
          label: e.label,
          website: e.website,
          requiredSecrets: e.secrets_json.map((s) => s.env),
          config: e.config_json,
        }))
      );
    } catch (err) {
      return fail(err);
    }
  }
);

server.tool(
  "get_mcp_assignments",
  "Show which catalog MCP servers are assigned to a company's container, including secret bindings",
  { company: z.string() },
  async ({ company }) => {
    try {
      const c = await containerByCompany(company);
      const assignments = await api(`/containers/${c.id}/mcps`);
      return text(assignments.map((a) => ({ key: a.key, bindings: a.bindings_json })));
    } catch (err) {
      return fail(err);
    }
  }
);

server.tool(
  "set_mcp_assignments",
  "Replace the MCP server assignments of a company's container. Each entry: catalog key plus optional bindings mapping required env var names to secret refs. Applies on next container start.",
  {
    company: z.string(),
    assignments: z.array(
      z.object({
        key: z.string().describe("catalog key, e.g. github"),
        bindings: z.record(z.string()).optional().describe("env var -> secret ref"),
      })
    ),
  },
  async ({ company, assignments }) => {
    try {
      const c = await containerByCompany(company);
      const catalog = await api("/mcp-catalog");
      const payload = assignments.map((a) => {
        const entry = catalog.find((e) => e.key === a.key);
        if (!entry) throw new Error(`unknown catalog key '${a.key}'`);
        return { catalog_id: entry.id, bindings: a.bindings ?? {} };
      });
      return text(await api(`/containers/${c.id}/mcps`, { method: "PUT", body: JSON.stringify({ assignments: payload }) }));
    } catch (err) {
      return fail(err);
    }
  }
);

server.tool(
  "set_secret",
  "Store or update an encrypted secret (token/API key) under a reference name",
  { ref: z.string(), value: z.string() },
  async ({ ref, value }) => {
    try {
      return text(await api("/secrets", { method: "PUT", body: JSON.stringify({ ref, value }) }));
    } catch (err) {
      return fail(err);
    }
  }
);

server.tool(
  "list_secret_refs",
  "List stored secret references (never plaintext values)",
  {},
  async () => {
    try {
      return text(await api("/secrets"));
    } catch (err) {
      return fail(err);
    }
  }
);

const PAPERCLIP_URL = process.env.PAPERCLIP_URL ?? "http://localhost:3100";

async function paperclip(path, init) {
  const res = await fetch(`${PAPERCLIP_URL}${path}`, {
    ...init,
    headers: init?.body ? { "content-type": "application/json" } : undefined,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `paperclip ${path} failed: HTTP ${res.status}`);
  return body;
}

server.tool(
  "bind_paperclip_company",
  "Route ALL agents of a Paperclip company through an agent-container: sets adapterType=claude_docker and the container slug on every agent. Run again after hiring new agents.",
  {
    paperclipCompany: z.string().describe("Paperclip company name or id"),
    container: z.string().describe("agent-containers company slug, e.g. marteso"),
    cli: z.enum(["claude", "codex"]).optional().describe("default: claude"),
  },
  async ({ paperclipCompany, container, cli }) => {
    try {
      const containers = await api("/containers");
      if (!containers.some((c) => c.company === container)) {
        throw new Error(`unknown container slug '${container}'`);
      }
      const companies = await paperclip("/api/companies");
      const company = companies.find(
        (c) => c.id === paperclipCompany || c.name.toLowerCase() === paperclipCompany.toLowerCase()
      );
      if (!company) {
        throw new Error(
          `unknown paperclip company '${paperclipCompany}' (known: ${companies.map((c) => c.name).join(", ")})`
        );
      }
      const mapModel = (adapterType, oldModel) => {
        if (adapterType === "claude_docker" && oldModel) return oldModel;
        const wantCodex = cli === "codex" || adapterType === "codex_local";
        if (wantCodex) {
          return oldModel && oldModel.startsWith("gpt-") ? `codex:${oldModel}` : "codex:default";
        }
        if (!oldModel) return "claude:default";
        for (const alias of ["haiku", "sonnet", "opus", "fable"]) {
          if (oldModel.includes(alias)) return `claude:${alias}`;
        }
        return `claude:${oldModel}`;
      };
      const agents = await paperclip(`/api/companies/${company.id}/agents`);
      const results = [];
      for (const agent of agents) {
        try {
          const existing =
            agent.adapterConfig && typeof agent.adapterConfig === "object"
              ? agent.adapterConfig
              : {};
          const model = mapModel(agent.adapterType, existing.model);
          await paperclip(`/api/agents/${agent.id}`, {
            method: "PATCH",
            body: JSON.stringify({
              adapterType: "claude_docker",
              adapterConfig: { ...existing, company: container, model },
            }),
          });
          results.push(`${agent.name}: bound (was ${agent.adapterType}, model → ${model})`);
        } catch (err) {
          results.push(`${agent.name}: FAILED — ${err.message}`);
        }
      }
      return text({
        paperclipCompany: company.name,
        container,
        agents: results,
      });
    } catch (err) {
      return fail(err);
    }
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
