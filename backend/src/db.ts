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
  await pool.query(`
    ALTER TABLE containers ADD COLUMN IF NOT EXISTS icon bytea;
    ALTER TABLE containers ADD COLUMN IF NOT EXISTS icon_mime text;
    ALTER TABLE containers ADD COLUMN IF NOT EXISTS icon_updated_at timestamptz;

    ALTER TABLE containers ADD COLUMN IF NOT EXISTS git_name text;
    ALTER TABLE containers ADD COLUMN IF NOT EXISTS git_email text;
    ALTER TABLE containers ADD COLUMN IF NOT EXISTS mem_mb integer;
    ALTER TABLE containers ADD COLUMN IF NOT EXISTS cpus real;
    ALTER TABLE containers ADD COLUMN IF NOT EXISTS pids_limit integer;

    ALTER TABLE mcp_catalog ADD COLUMN IF NOT EXISTS website text;
    ALTER TABLE mcp_catalog ADD COLUMN IF NOT EXISTS favicon bytea;
    ALTER TABLE mcp_catalog ADD COLUMN IF NOT EXISTS favicon_mime text;
    ALTER TABLE mcp_catalog ADD COLUMN IF NOT EXISTS favicon_fetched_at timestamptz;

    UPDATE mcp_catalog SET website = 'github.com'     WHERE key = 'github'     AND website IS NULL;
    UPDATE mcp_catalog SET website = 'notion.so'      WHERE key = 'notion'     AND website IS NULL;
    UPDATE mcp_catalog SET website = 'revenuecat.com' WHERE key = 'revenuecat' AND website IS NULL;

    CREATE TABLE IF NOT EXISTS runs (
      id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      company      text NOT NULL,
      cli          text NOT NULL,
      model        text,
      source       text NOT NULL DEFAULT 'api',
      prompt       text NOT NULL,
      status       text NOT NULL DEFAULT 'running',
      exit_code    integer,
      stdout       text NOT NULL DEFAULT '',
      stderr       text NOT NULL DEFAULT '',
      error        text,
      started_at   timestamptz NOT NULL DEFAULT now(),
      finished_at  timestamptz
    );
    CREATE INDEX IF NOT EXISTS runs_company_started_idx ON runs (company, started_at DESC);
  `);
  await seedCatalog();
}

export interface RunRow {
  id: string;
  company: string;
  cli: string;
  model: string | null;
  source: string;
  prompt: string;
  status: "running" | "succeeded" | "failed";
  exit_code: number | null;
  stdout: string;
  stderr: string;
  error: string | null;
  started_at: string;
  finished_at: string | null;
}

async function seedCatalog(): Promise<void> {
  const { rows } = await pool.query(
    "SELECT count(*)::int AS n FROM mcp_catalog",
  );
  if (rows[0].n > 0) return;
  // GitHub ships as the official stdio server (needs a PAT). Everything else is a
  // hosted remote endpoint wrapped via mcp-remote. Every URL below was reachability-
  // checked. OAuth servers need no secret — the dashboard drives the login flow;
  // API-key servers carry a Bearer header filled from the named secret.
  const github = {
    key: "github",
    label: "GitHub",
    icon: "github",
    config: {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-github"],
      env: { GITHUB_PERSONAL_ACCESS_TOKEN: "${GITHUB_TOKEN}" },
    },
    secrets: [{ env: "GITHUB_TOKEN", label: "Personal Access Token" }],
  };

  // [key, label, url]                    → hosted OAuth server (no secret)
  // [key, label, url, ENV, "Label"]      → hosted server with a Bearer API key
  const hosted: [string, string, string, string?, string?][] = [
    // dev & infra
    ["linear", "Linear", "https://mcp.linear.app/mcp"],
    ["sentry", "Sentry", "https://mcp.sentry.dev/mcp"],
    ["vercel", "Vercel", "https://mcp.vercel.com"],
    ["netlify", "Netlify", "https://netlify-mcp.netlify.app/mcp"],
    ["cloudflare", "Cloudflare", "https://mcp.cloudflare.com/mcp"],
    ["gitlab", "GitLab", "https://gitlab.com/api/v4/mcp"],
    ["supabase", "Supabase", "https://mcp.supabase.com/mcp"],
    ["neon", "Neon", "https://mcp.neon.tech/mcp"],
    ["planetscale", "PlanetScale", "https://mcp.pscale.dev/mcp/planetscale"],
    ["prisma", "Prisma", "https://mcp.prisma.io/mcp"],
    ["render", "Render", "https://mcp.render.com/mcp"],
    ["railway", "Railway", "https://mcp.railway.com"],
    ["heroku", "Heroku", "https://mcp.heroku.com/mcp"],
    [
      "digitalocean",
      "DigitalOcean",
      "https://apps.mcp.digitalocean.com/mcp",
      "DIGITALOCEAN_API_TOKEN",
      "API Token",
    ],
    ["grafana", "Grafana Cloud", "https://mcp.grafana.com/mcp"],
    ["datadog", "Datadog", "https://mcp.datadoghq.com/v1/mcp"],
    ["honeycomb", "Honeycomb", "https://mcp.honeycomb.io/mcp"],
    [
      "pagerduty",
      "PagerDuty",
      "https://mcp.pagerduty.com/mcp",
      "PAGERDUTY_USER_API_KEY",
      "User API Token",
    ],
    [
      "raygun",
      "Raygun",
      "https://api.raygun.com/v3/mcp",
      "RAYGUN_PAT",
      "Personal Access Token",
    ],
    ["postman", "Postman", "https://mcp.postman.com/mcp"],
    ["sourcegraph", "Sourcegraph", "https://sourcegraph.com/.api/mcp/v1"],
    // data, ai & search
    [
      "posthog",
      "PostHog",
      "https://mcp.posthog.com/mcp",
      "POSTHOG_API_KEY",
      "Personal API Key",
    ],
    ["amplitude", "Amplitude", "https://mcp.amplitude.com/mcp"],
    ["mixpanel", "Mixpanel", "https://mcp.mixpanel.com/mcp"],
    ["exa", "Exa", "https://mcp.exa.ai/mcp"],
    ["firecrawl", "Firecrawl", "https://mcp.firecrawl.dev/v2/mcp"],
    ["apify", "Apify", "https://mcp.apify.com"],
    ["kagi", "Kagi", "https://mcp.kagi.com/mcp", "KAGI_API_KEY", "API Key"],
    [
      "huggingface",
      "Hugging Face",
      "https://huggingface.co/mcp",
      "HF_TOKEN",
      "Access Token",
    ],
    [
      "replicate",
      "Replicate",
      "https://mcp.replicate.com/sse",
      "REPLICATE_API_TOKEN",
      "API Token",
    ],
    ["algolia", "Algolia", "https://mcp.algolia.com/mcp"],
    [
      "cloudinary",
      "Cloudinary",
      "https://asset-management.mcp.cloudinary.com/mcp",
    ],
    ["semgrep", "Semgrep", "https://mcp.semgrep.ai/mcp"],
    ["hex", "Hex", "https://app.hex.tech/mcp"],
    // payments & fintech
    ["stripe", "Stripe", "https://mcp.stripe.com"],
    ["paypal", "PayPal", "https://mcp.paypal.com/mcp"],
    ["plaid", "Plaid", "https://api.dashboard.plaid.com/mcp"],
    ["revenuecat", "RevenueCat", "https://mcp.revenuecat.ai/mcp"],
    ["square", "Square", "https://mcp.squareup.com/sse"],
    // productivity & collaboration
    ["notion", "Notion", "https://mcp.notion.com/mcp"],
    ["atlassian", "Atlassian", "https://mcp.atlassian.com/v1/mcp"],
    ["asana", "Asana", "https://mcp.asana.com/v2/mcp"],
    ["monday", "monday.com", "https://mcp.monday.com/mcp"],
    ["clickup", "ClickUp", "https://mcp.clickup.com/mcp"],
    ["trello", "Trello", "https://mcp.trello.com/v1"],
    ["slack", "Slack", "https://mcp.slack.com/mcp"],
    ["airtable", "Airtable", "https://mcp.airtable.com/mcp"],
    ["box", "Box", "https://mcp.box.com"],
    ["dropbox", "Dropbox", "https://mcp.dropbox.com/mcp"],
    ["calendly", "Calendly", "https://mcp.calendly.com"],
    ["miro", "Miro", "https://mcp.miro.com/"],
    ["canva", "Canva", "https://mcp.canva.com/mcp"],
    ["figma", "Figma", "https://mcp.figma.com/mcp"],
    ["make", "Make", "https://mcp.make.com/stream"],
    [
      "zapier",
      "Zapier",
      "https://mcp.zapier.com/api/v1/connect",
      "ZAPIER_MCP_TOKEN",
      "MCP Token",
    ],
    // crm, support & marketing
    ["hubspot", "HubSpot", "https://mcp.hubspot.com/anthropic"],
    [
      "salesforce",
      "Salesforce",
      "https://api.salesforce.com/platform/mcp/v1/platform/sobject-reads",
    ],
    ["intercom", "Intercom", "https://mcp.intercom.com/mcp"],
    ["pipedrive", "Pipedrive", "https://mcp.pipedrive.ai/mcp"],
    ["close", "Close", "https://mcp.close.com/mcp", "CLOSE_API_KEY", "API Key"],
    ["customerio", "Customer.io", "https://mcp.customer.io/mcp"],
    ["resend", "Resend", "https://mcp.resend.com/mcp"],
    // cms
    ["contentful", "Contentful", "https://mcp.contentful.com/mcp"],
    ["sanity", "Sanity", "https://mcp.sanity.io"],
    [
      "storyblok",
      "Storyblok",
      "https://mcp.labs.storyblok.com/mcp",
      "STORYBLOK_PERSONAL_ACCESS_TOKEN",
      "Personal Access Token",
    ],
    ["webflow", "Webflow", "https://mcp.webflow.com/sse"],
    ["wix", "Wix", "https://mcp.wix.com/mcp"],
  ];

  const presets = [
    github,
    ...hosted.map(([key, label, url, env, secretLabel]) => {
      const config: Record<string, unknown> = { type: "http", url };
      const secrets: { env: string; label: string }[] = [];
      if (env) {
        config.headers = { Authorization: "Bearer ${" + env + "}" };
        secrets.push({ env, label: secretLabel ?? "API Key" });
      }
      return { key, label, icon: "globe", config, secrets };
    }),
  ];
  for (const p of presets) {
    await pool.query(
      `INSERT INTO mcp_catalog (key, label, icon, config_json, secrets_json)
       VALUES ($1, $2, $3, $4, $5) ON CONFLICT (key) DO NOTHING`,
      [
        p.key,
        p.label,
        p.icon,
        JSON.stringify(p.config),
        JSON.stringify(p.secrets),
      ],
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
  git_name: string | null;
  git_email: string | null;
  mem_mb: number | null;
  cpus: number | null;
  pids_limit: number | null;
  created_at: string;
}

export interface CatalogRow {
  id: string;
  key: string;
  label: string;
  icon: string;
  website: string | null;
  config_json: Record<string, unknown>;
  secrets_json: { env: string; label: string }[];
  created_at: string;
}

export const CATALOG_COLS =
  "id, key, label, icon, website, config_json, secrets_json, created_at";

export interface AssignmentRow extends CatalogRow {
  container_id: string;
  bindings_json: Record<string, string>;
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
