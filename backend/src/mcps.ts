import { pool, type AssignmentRow, type ContainerRow } from "./db.js";
import { readSecret } from "./crypto.js";

export async function getAssignments(containerId: string): Promise<AssignmentRow[]> {
  const { rows } = await pool.query<AssignmentRow>(
    `SELECT c.*, cm.container_id, cm.bindings_json
     FROM container_mcps cm
     JOIN mcp_catalog c ON c.id = cm.catalog_id
     WHERE cm.container_id = $1
     ORDER BY c.label`,
    [containerId]
  );
  return rows;
}

/**
 * The MCP servers a container actually gets: catalog assignments first,
 * then any hand-written extras from mcp_config_json (which win on name
 * clash, as the explicit override).
 */
export async function getEffectiveMcpServers(
  container: ContainerRow
): Promise<Record<string, unknown>> {
  const servers: Record<string, unknown> = {};
  for (const a of await getAssignments(container.id)) {
    servers[a.key] = a.config_json;
  }
  Object.assign(servers, container.mcp_config_json?.mcpServers ?? {});
  return servers;
}

/**
 * Env vars required by assigned catalog servers, resolved from the
 * encrypted secret each binding points at.
 */
export async function resolveBindingEnv(containerId: string): Promise<string[]> {
  const env: string[] = [];
  for (const a of await getAssignments(containerId)) {
    for (const spec of a.secrets_json ?? []) {
      const ref = a.bindings_json?.[spec.env];
      if (!ref) continue;
      const value = await readSecret(ref);
      if (value !== null) env.push(`${spec.env}=${value}`);
    }
  }
  return env;
}

/** Compact per-container summary for the dashboard list. */
export async function assignmentSummary(containerId: string): Promise<
  { key: string; label: string; icon: string; secretsOk: boolean }[]
> {
  const assignments = await getAssignments(containerId);
  return assignments.map((a) => ({
    key: a.key,
    label: a.label,
    icon: a.icon,
    secretsOk: (a.secrets_json ?? []).every((s) => Boolean(a.bindings_json?.[s.env])),
  }));
}
