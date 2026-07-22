import { pool, type AssignmentRow, type ContainerRow } from "./db.js";
import { readSecret } from "./crypto.js";

export async function getAssignments(containerId: string): Promise<AssignmentRow[]> {
  const { rows } = await pool.query<AssignmentRow>(
    `SELECT c.id, c.key, c.label, c.icon, c.website, c.config_json, c.secrets_json,
            c.created_at, cm.container_id, cm.bindings_json
     FROM container_mcps cm
     JOIN mcp_catalog c ON c.id = cm.catalog_id
     WHERE cm.container_id = $1
     ORDER BY c.label`,
    [containerId]
  );
  return rows;
}

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

export async function assignmentSummary(containerId: string): Promise<
  { id: string; key: string; label: string; icon: string; secretsOk: boolean }[]
> {
  const assignments = await getAssignments(containerId);
  return assignments.map((a) => ({
    id: a.id,
    key: a.key,
    label: a.label,
    icon: a.icon,
    secretsOk: (a.secrets_json ?? []).every((s) => Boolean(a.bindings_json?.[s.env])),
  }));
}
