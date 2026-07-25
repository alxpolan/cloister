export const API_URL = "/api";

export interface Account {
  id: string;
  container_id: string;
  type: string;
  label: string;
  role: string;
  env_var: string | null;
  secret_ref: string | null;
}

export interface McpSummary {
  id: string;
  key: string;
  label: string;
  icon: string;
  secretsOk: boolean;
  oauth: boolean;
  authorized: boolean | null;
}

export interface Container {
  id: string;
  name: string;
  company: string;
  status: "running" | "stopped";
  home_path: string;
  mcp_config_json: { mcpServers: Record<string, unknown> };
  created_at: string;
  claudeAuthenticated: boolean;
  codexAuthenticated: boolean;
  accounts: Account[];
  mcps: McpSummary[];
  hasIcon: boolean;
  iconVersion: number;
  git_name: string | null;
  git_email: string | null;
  resources: {
    memMb: number;
    cpus: number;
    pidsLimit: number;
    isDefault: boolean;
  };
}

export interface CatalogEntry {
  id: string;
  key: string;
  label: string;
  icon: string;
  website: string | null;
  config_json: Record<string, unknown>;
  secrets_json: { env: string; label: string }[];
}

export interface Assignment extends CatalogEntry {
  container_id: string;
  bindings_json: Record<string, string>;
}

export interface SecretRef {
  ref: string;
  updated_at: string;
}

export interface AuthSessionState {
  id: string;
  cli: "claude" | "codex";
  running: boolean;
  exitCode: number | null;
  output: string;
}

export interface RunSummary {
  id: string;
  company: string;
  cli: string;
  model: string | null;
  source: string;
  status: "running" | "succeeded" | "failed";
  exit_code: number | null;
  prompt: string;
  started_at: string;
  finished_at: string | null;
}

export interface RunDetail extends RunSummary {
  stdout: string;
  stderr: string;
  error: string | null;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: init?.body
      ? { "Content-Type": "application/json", ...init?.headers }
      : init?.headers,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `${res.status} ${res.statusText}`);
  }
  return res.json();
}

export const api = {
  listContainers: () => request<Container[]>("/containers"),
  createContainer: (name: string, company: string) =>
    request<Container>("/containers", {
      method: "POST",
      body: JSON.stringify({ name, company }),
    }),
  startContainer: (id: string) =>
    request<{ ok: boolean }>(`/containers/${id}/start`, { method: "POST" }),
  stopContainer: (id: string) =>
    request<{ ok: boolean }>(`/containers/${id}/stop`, { method: "POST" }),
  deleteContainer: (id: string) =>
    request<{ ok: boolean }>(`/containers/${id}`, { method: "DELETE" }),
  updateMcpConfig: (id: string, mcpServers: Record<string, unknown>) =>
    request<{ ok: boolean }>(`/containers/${id}/mcp-config`, {
      method: "PUT",
      body: JSON.stringify({ mcpServers }),
    }),
  updateGitIdentity: (id: string, name: string, email: string) =>
    request<{ ok: boolean }>(`/containers/${id}/git-identity`, {
      method: "PUT",
      body: JSON.stringify({ name, email }),
    }),
  updateResources: (
    id: string,
    r: { memMb: number | null; cpus: number | null; pidsLimit: number | null },
  ) =>
    request<{ ok: boolean }>(`/containers/${id}/resources`, {
      method: "PUT",
      body: JSON.stringify(r),
    }),
  uploadIcon: (id: string, dataBase64: string, mime: string) =>
    request<{ ok: boolean }>(`/containers/${id}/icon`, {
      method: "PUT",
      body: JSON.stringify({ data: dataBase64, mime }),
    }),
  deleteIcon: (id: string) =>
    request<{ ok: boolean }>(`/containers/${id}/icon`, { method: "DELETE" }),
  updateAccounts: (
    id: string,
    accounts: Omit<Account, "id" | "container_id">[],
  ) =>
    request<{ ok: boolean }>(`/containers/${id}/accounts`, {
      method: "PUT",
      body: JSON.stringify({ accounts }),
    }),
  listCatalog: () => request<CatalogEntry[]>("/mcp-catalog"),
  createCatalogEntry: (entry: {
    key: string;
    label: string;
    icon?: string;
    website?: string;
    config: Record<string, unknown>;
    secrets?: { env: string; label: string }[];
  }) =>
    request<CatalogEntry>("/mcp-catalog", {
      method: "POST",
      body: JSON.stringify(entry),
    }),
  deleteCatalogEntry: (id: string) =>
    request<{ ok: boolean }>(`/mcp-catalog/${id}`, { method: "DELETE" }),
  getAssignments: (id: string) =>
    request<Assignment[]>(`/containers/${id}/mcps`),
  updateAssignments: (
    id: string,
    assignments: { catalog_id: string; bindings?: Record<string, string> }[],
  ) =>
    request<{ ok: boolean }>(`/containers/${id}/mcps`, {
      method: "PUT",
      body: JSON.stringify({ assignments }),
    }),
  startAuth: (id: string, cli: string) =>
    request<{ sessionId: string; note: string }>(
      `/containers/${id}/auth/${encodeURIComponent(cli)}`,
      { method: "POST" },
    ),
  getAuthSession: (sid: string) =>
    request<AuthSessionState>(`/auth-sessions/${sid}`),
  sendAuthInput: (sid: string, text: string) =>
    request<{ ok: boolean }>(`/auth-sessions/${sid}/input`, {
      method: "POST",
      body: JSON.stringify({ text }),
    }),
  killAuthSession: (sid: string) =>
    request<{ ok: boolean }>(`/auth-sessions/${sid}`, { method: "DELETE" }),
  listRuns: (company?: string) =>
    request<RunSummary[]>(
      `/runs${company ? `?company=${encodeURIComponent(company)}` : ""}`,
    ),
  getRun: (id: string) => request<RunDetail>(`/runs/${id}`),
  listSecrets: () => request<SecretRef[]>("/secrets"),
  putSecret: (ref: string, value: string) =>
    request<{ ok: boolean }>("/secrets", {
      method: "PUT",
      body: JSON.stringify({ ref, value }),
    }),
};
