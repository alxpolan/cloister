import pg from "pg";
import { config } from "./config.js";

export const pool = new pg.Pool({ connectionString: config.databaseUrl });

export async function migrate(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS containers (
      id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name            text NOT NULL UNIQUE,
      company         text NOT NULL UNIQUE,
      status          text NOT NULL DEFAULT 'stopped',
      home_path       text NOT NULL,
      mcp_config_json jsonb NOT NULL DEFAULT '{"mcpServers":{}}',
      created_at      timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS accounts (
      id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      container_id uuid NOT NULL REFERENCES containers(id) ON DELETE CASCADE,
      type         text NOT NULL,
      label        text NOT NULL,
      role         text NOT NULL DEFAULT '',
      env_var      text,
      secret_ref   text,
      created_at   timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS secrets (
      ref        text PRIMARY KEY,
      ciphertext bytea NOT NULL,
      nonce      bytea NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS mcp_catalog (
      id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      key          text NOT NULL UNIQUE,
      label        text NOT NULL,
      icon         text NOT NULL DEFAULT 'globe',
      config_json  jsonb NOT NULL,
      secrets_json jsonb NOT NULL DEFAULT '[]',
      created_at   timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS container_mcps (
      container_id  uuid NOT NULL REFERENCES containers(id) ON DELETE CASCADE,
      catalog_id    uuid NOT NULL REFERENCES mcp_catalog(id) ON DELETE CASCADE,
      bindings_json jsonb NOT NULL DEFAULT '{}',
      PRIMARY KEY (container_id, catalog_id)
    );
  `);
  await seedCatalog();
}

/** Preset servers so a fresh install is usable without hand-writing JSON. */
async function seedCatalog(): Promise<void> {
  const { rows } = await pool.query("SELECT count(*)::int AS n FROM mcp_catalog");
  if (rows[0].n > 0) return;
  const presets = [
    {
      key: "github",
      label: "GitHub",
      icon: "github",
      config: {
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-github"],
        env: { GITHUB_PERSONAL_ACCESS_TOKEN: "${GITHUB_TOKEN}" },
      },
      secrets: [{ env: "GITHUB_TOKEN", label: "Personal Access Token" }],
    },
    {
      key: "notion",
      label: "Notion",
      icon: "globe",
      config: { type: "http", url: "https://mcp.notion.com/mcp" },
      secrets: [],
    },
    {
      key: "revenuecat",
      label: "RevenueCat",
      icon: "globe",
      config: {
        type: "http",
        url: "https://mcp.revenuecat.ai/mcp",
        headers: { Authorization: "Bearer ${REVENUECAT_API_KEY}" },
      },
      secrets: [{ env: "REVENUECAT_API_KEY", label: "API Key (v2)" }],
    },
  ];
  for (const p of presets) {
    await pool.query(
      `INSERT INTO mcp_catalog (key, label, icon, config_json, secrets_json)
       VALUES ($1, $2, $3, $4, $5) ON CONFLICT (key) DO NOTHING`,
      [p.key, p.label, p.icon, JSON.stringify(p.config), JSON.stringify(p.secrets)]
    );
  }
}

export interface ContainerRow {
  id: string;
  name: string;
  company: string;
  status: string;
  home_path: string;
  mcp_config_json: { mcpServers: Record<string, unknown> };
  created_at: string;
}

export interface CatalogRow {
  id: string;
  key: string;
  label: string;
  icon: string;
  config_json: Record<string, unknown>;
  secrets_json: { env: string; label: string }[];
  created_at: string;
}

export interface AssignmentRow extends CatalogRow {
  container_id: string;
  bindings_json: Record<string, string>; // env var -> secret ref
}

export interface AccountRow {
  id: string;
  container_id: string;
  type: string;
  label: string;
  role: string;
  env_var: string | null;
  secret_ref: string | null;
  created_at: string;
}
