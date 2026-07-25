"use client";

import { useEffect, useState } from "react";
import {
  Play,
  Square,
  Terminal,
  Plus,
  Trash2,
  Upload,
  CheckCircle2,
} from "lucide-react";
import {
  api,
  type Assignment,
  type CatalogEntry,
  type Container,
  type SecretRef,
} from "@/lib/api";
import {
  Avatar,
  Button,
  EmptyState,
  Field,
  inputClass,
  Panel,
  Pill,
  SectionTitle,
  StatusDot,
} from "@/components/kit";
import { McpFavicon } from "@/components/McpIcon";

type Tab = "info" | "mcps" | "settings";

export function ContainersView({
  containers,
  selectedId,
  onSelect,
  busyId,
  onAction,
  onNew,
  onLogin,
  onRefresh,
}: {
  containers: Container[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  busyId: string | null;
  onAction: (id: string, fn: () => Promise<unknown>) => void;
  onNew: () => void;
  onLogin: (container: Container, cli: string) => void;
  onRefresh: () => void;
}) {
  const selected = containers.find((c) => c.id === selectedId) ?? null;

  return (
    <div className="flex h-full">
      <aside className="flex w-72 shrink-0 flex-col border-r border-neutral-200 bg-white">
        <div className="flex items-center justify-between px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold">Containers</h2>
            <p className="text-xs text-neutral-400">
              {containers.filter((c) => c.status === "running").length} of{" "}
              {containers.length} running
            </p>
          </div>
          <Button size="sm" variant="primary" onClick={onNew}>
            <Plus size={13} /> New
          </Button>
        </div>
        <div className="flex-1 overflow-auto px-2 pb-2">
          {containers.map((c) => {
            const running = c.status === "running";
            return (
              <button
                key={c.id}
                onClick={() => onSelect(c.id)}
                className={`mb-1 flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors ${
                  selectedId === c.id ? "bg-accent-soft" : "hover:bg-neutral-50"
                }`}
              >
                <div className="relative">
                  {c.hasIcon ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={`/api/containers/${c.id}/icon?v=${c.iconVersion}`}
                      alt=""
                      className="h-7 w-7 rounded-lg object-cover"
                    />
                  ) : (
                    <Avatar name={c.name} />
                  )}
                  <span className="absolute -bottom-0.5 -right-0.5 rounded-full border-2 border-white">
                    <StatusDot running={running} />
                  </span>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{c.name}</div>
                  <div className="truncate font-mono text-[11px] text-neutral-400">
                    agent-{c.company}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </aside>

      <div className="flex-1 overflow-auto">
        {selected ? (
          <ContainerDetail
            key={selected.id}
            container={selected}
            busy={busyId === selected.id}
            onAction={onAction}
            onLogin={onLogin}
            onRefresh={onRefresh}
          />
        ) : (
          <EmptyState
            icon={<Terminal size={40} strokeWidth={1.5} />}
            title="Select a container"
          />
        )}
      </div>
    </div>
  );
}

function ContainerDetail({
  container,
  busy,
  onAction,
  onLogin,
  onRefresh,
}: {
  container: Container;
  busy: boolean;
  onAction: (id: string, fn: () => Promise<unknown>) => void;
  onLogin: (container: Container, cli: string) => void;
  onRefresh: () => void;
}) {
  const [tab, setTab] = useState<Tab>("info");
  const running = container.status === "running";

  return (
    <div className="mx-auto max-w-3xl px-8 py-6">
      <header className="mb-5 flex items-center gap-3">
        {container.hasIcon ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/api/containers/${container.id}/icon?v=${container.iconVersion}`}
            alt=""
            className="h-10 w-10 rounded-xl object-cover"
          />
        ) : (
          <Avatar name={container.name} size={40} />
        )}
        <div className="flex-1">
          <h1 className="text-lg font-semibold">{container.name}</h1>
          <p className="font-mono text-xs text-neutral-400">
            agent-{container.company}
          </p>
        </div>
        {busy ? (
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-neutral-300 border-t-accent" />
        ) : running ? (
          <Button
            onClick={() =>
              onAction(container.id, () => api.stopContainer(container.id))
            }
          >
            <Square size={13} /> Stop
          </Button>
        ) : (
          <Button
            variant="primary"
            onClick={() =>
              onAction(container.id, () => api.startContainer(container.id))
            }
          >
            <Play size={13} /> Start
          </Button>
        )}
      </header>

      <div className="mb-5 inline-flex rounded-lg bg-neutral-200/60 p-0.5 text-[13px]">
        {(["info", "mcps", "settings"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-md px-3 py-1 font-medium capitalize transition-colors ${
              tab === t
                ? "bg-white text-neutral-900 shadow-sm"
                : "text-neutral-500 hover:text-neutral-800"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "info" && (
        <InfoTab
          container={container}
          running={running}
          busy={busy}
          onLogin={onLogin}
        />
      )}
      {tab === "mcps" && <McpsTab container={container} onDone={onRefresh} />}
      {tab === "settings" && (
        <SettingsTab container={container} onDone={onRefresh} />
      )}
    </div>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between px-4 py-2.5 text-sm">
      <span className="text-neutral-500">{label}</span>
      <span className="font-medium">{children}</span>
    </div>
  );
}

function InfoTab({
  container,
  running,
  busy,
  onLogin,
}: {
  container: Container;
  running: boolean;
  busy: boolean;
  onLogin: (container: Container, cli: string) => void;
}) {
  const customCount = Object.keys(container.mcp_config_json?.mcpServers ?? {}).length;
  return (
    <div className="space-y-5">
      <Panel>
        <div className="divide-y divide-neutral-100">
          <Row label="Company">{container.company}</Row>
          <Row label="Container">agent-{container.company}</Row>
          <Row label="Status">
            <Pill tone={running ? "green" : "neutral"}>
              {running ? "Running" : "Stopped"}
            </Pill>
          </Row>
        </div>
      </Panel>

      <div>
        <SectionTitle>Command line tools</SectionTitle>
        <Panel>
          <div className="divide-y divide-neutral-100">
            <CliRow
              name="Claude Code"
              cli="claude"
              ok={container.claudeAuthenticated}
              running={running}
              busy={busy}
              onLogin={() => onLogin(container, "claude")}
            />
            <CliRow
              name="Codex"
              cli="codex"
              ok={container.codexAuthenticated}
              running={running}
              busy={busy}
              onLogin={() => onLogin(container, "codex")}
            />
          </div>
        </Panel>
      </div>

      <div>
        <SectionTitle>MCP servers</SectionTitle>
        <Panel>
          {container.mcps.length === 0 && customCount === 0 ? (
            <p className="px-4 py-3 text-sm text-neutral-400">
              None assigned — use the MCPs tab.
            </p>
          ) : (
            <div className="divide-y divide-neutral-100">
              {container.mcps.map((m) => (
                <div
                  key={m.key}
                  className="flex items-center gap-2.5 px-4 py-2.5 text-sm"
                >
                  <McpFavicon entryId={m.id} icon={m.icon} />
                  <span className="font-medium">{m.label}</span>
                  <span className="ml-auto">
                    {m.oauth ? (
                      m.authorized ? (
                        <Pill tone="green">
                          <CheckCircle2 size={12} /> authorized
                        </Pill>
                      ) : (
                        <span className="flex items-center gap-2">
                          <Pill tone="amber">not authorized</Pill>
                          {running && (
                            <button
                              onClick={() => onLogin(container, `mcp:${m.key}`)}
                              className="text-xs font-medium text-accent hover:underline"
                            >
                              authorize
                            </button>
                          )}
                        </span>
                      )
                    ) : m.secretsOk ? (
                      <CheckCircle2 size={15} className="text-emerald-500" />
                    ) : (
                      <Pill tone="red">token missing</Pill>
                    )}
                  </span>
                </div>
              ))}
              {customCount > 0 && (
                <p className="px-4 py-2 text-xs text-neutral-400">
                  + {customCount} custom (raw JSON)
                </p>
              )}
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}

function CliRow({
  name,
  ok,
  running,
  busy,
  onLogin,
}: {
  name: string;
  cli: string;
  ok: boolean;
  running: boolean;
  busy: boolean;
  onLogin: () => void;
}) {
  return (
    <div className="flex items-center gap-2.5 px-4 py-2.5 text-sm">
      <Terminal size={14} className="text-neutral-400" />
      <span className="font-medium">{name}</span>
      {ok ? (
        <Pill tone="green">authenticated</Pill>
      ) : (
        <Pill tone="neutral">not authenticated</Pill>
      )}
      {running && (
        <button
          onClick={onLogin}
          disabled={busy}
          className="ml-auto text-xs font-medium text-accent hover:underline disabled:opacity-40"
        >
          {ok ? "Re-login" : "Login"}
        </button>
      )}
    </div>
  );
}

// MARK: MCPs tab -------------------------------------------------------------

interface Draft {
  enabled: boolean;
  bindings: Record<string, string>;
  newTokens: Record<string, string>;
}

function McpsTab({
  container,
  onDone,
}: {
  container: Container;
  onDone: () => void;
}) {
  const [catalog, setCatalog] = useState<CatalogEntry[] | null>(null);
  const [secrets, setSecrets] = useState<SecretRef[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      const [cat, assigned, secs] = await Promise.all([
        api.listCatalog(),
        api.getAssignments(container.id),
        api.listSecrets(),
      ]);
      setCatalog(cat);
      setSecrets(secs);
      const d: Record<string, Draft> = {};
      for (const e of cat) {
        const a = assigned.find((x: Assignment) => x.id === e.id);
        d[e.id] = {
          enabled: Boolean(a),
          bindings: a?.bindings_json ?? {},
          newTokens: {},
        };
      }
      setDrafts(d);
    })().catch((e) => setError(String(e.message)));
  }, [container.id]);

  function update(id: string, patch: Partial<Draft>) {
    setDrafts((d) => ({ ...d, [id]: { ...d[id], ...patch } }));
    setSaved(false);
  }

  async function save() {
    if (!catalog) return;
    setSaving(true);
    setError("");
    try {
      const assignments = [];
      for (const entry of catalog) {
        const draft = drafts[entry.id];
        if (!draft?.enabled) continue;
        const bindings = { ...draft.bindings };
        for (const [env, token] of Object.entries(draft.newTokens)) {
          if (!token.trim()) continue;
          const multi = entry.secrets_json.length > 1;
          const ref = multi
            ? `${container.company}-${entry.key}-${env.toLowerCase()}`
            : `${container.company}-${entry.key}`;
          await api.putSecret(ref, token.trim());
          bindings[env] = ref;
        }
        assignments.push({ catalog_id: entry.id, bindings });
      }
      await api.updateAssignments(container.id, assignments);
      setSaved(true);
      onDone();
    } catch (e) {
      setError(String((e as Error).message));
    } finally {
      setSaving(false);
    }
  }

  if (!catalog) return <p className="text-sm text-neutral-400">Loading…</p>;

  return (
    <div className="space-y-3">
      <Panel>
        <div className="divide-y divide-neutral-100">
          {catalog.map((entry) => {
            const draft = drafts[entry.id];
            if (!draft) return null;
            return (
              <div key={entry.id} className="px-4 py-3">
                <label className="flex cursor-pointer items-center gap-3">
                  <input
                    type="checkbox"
                    checked={draft.enabled}
                    onChange={(e) =>
                      update(entry.id, { enabled: e.target.checked })
                    }
                    className="h-4 w-4 rounded accent-accent"
                  />
                  <McpFavicon entryId={entry.id} icon={entry.icon} />
                  <span className="text-sm font-medium">{entry.label}</span>
                  <span className="font-mono text-xs text-neutral-400">
                    {entry.key}
                  </span>
                  {entry.secrets_json.length === 0 && (
                    <span className="ml-auto text-xs text-neutral-400">
                      OAuth / no token
                    </span>
                  )}
                </label>
                {draft.enabled && entry.secrets_json.length > 0 && (
                  <div className="mt-2 space-y-2 pl-7">
                    {entry.secrets_json.map((spec) => (
                      <div key={spec.env} className="grid grid-cols-2 gap-2">
                        <select
                          className={inputClass}
                          value={draft.bindings[spec.env] ?? ""}
                          onChange={(e) =>
                            update(entry.id, {
                              bindings: {
                                ...draft.bindings,
                                [spec.env]: e.target.value,
                              },
                            })
                          }
                        >
                          <option value="">{spec.label} — pick secret</option>
                          {secrets.map((s) => (
                            <option key={s.ref} value={s.ref}>
                              {s.ref}
                            </option>
                          ))}
                        </select>
                        <input
                          type="password"
                          className={inputClass}
                          placeholder={`or paste new ${spec.label}`}
                          value={draft.newTokens[spec.env] ?? ""}
                          onChange={(e) =>
                            update(entry.id, {
                              newTokens: {
                                ...draft.newTokens,
                                [spec.env]: e.target.value,
                              },
                            })
                          }
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Panel>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex items-center justify-end gap-3">
        {saved && (
          <span className="text-xs text-emerald-600">
            Saved — applies on next start.
          </span>
        )}
        <Button variant="primary" onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}

// MARK: Settings tab ---------------------------------------------------------

function SettingsTab({
  container,
  onDone,
}: {
  container: Container;
  onDone: () => void;
}) {
  const [gitName, setGitName] = useState(container.git_name ?? "");
  const [gitEmail, setGitEmail] = useState(container.git_email ?? "");
  const [mem, setMem] = useState(
    container.resources.isDefault ? "" : String(container.resources.memMb),
  );
  const [cpus, setCpus] = useState(
    container.resources.isDefault ? "" : String(container.resources.cpus),
  );
  const [pids, setPids] = useState(
    container.resources.isDefault ? "" : String(container.resources.pidsLimit),
  );
  const [note, setNote] = useState("");

  async function saveGit() {
    await api.updateGitIdentity(container.id, gitName, gitEmail);
    setNote("Git identity saved — applies on next start.");
    onDone();
  }
  async function saveResources() {
    await api.updateResources(container.id, {
      memMb: mem ? Number(mem) : null,
      cpus: cpus ? Number(cpus) : null,
      pidsLimit: pids ? Number(pids) : null,
    });
    setNote("Resource limits saved — applies on next start.");
    onDone();
  }
  async function pickIcon(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const buf = await file.arrayBuffer();
    const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
    await api.uploadIcon(container.id, b64, file.type);
    onDone();
  }

  return (
    <div className="space-y-5">
      <div>
        <SectionTitle>Icon</SectionTitle>
        <Panel>
          <div className="flex items-center gap-3 px-4 py-3">
            {container.hasIcon ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`/api/containers/${container.id}/icon?v=${container.iconVersion}`}
                alt=""
                className="h-9 w-9 rounded-lg object-cover"
              />
            ) : (
              <Avatar name={container.name} size={36} />
            )}
            <label className="cursor-pointer">
              <span className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-[13px] font-medium shadow-sm hover:bg-neutral-50">
                <Upload size={13} /> Choose image
              </span>
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={pickIcon}
              />
            </label>
            {container.hasIcon && (
              <button
                onClick={() => api.deleteIcon(container.id).then(onDone)}
                className="text-xs font-medium text-red-600 hover:underline"
              >
                Remove
              </button>
            )}
          </div>
        </Panel>
      </div>

      <div>
        <SectionTitle>Git identity</SectionTitle>
        <Panel>
          <div className="space-y-3 p-4">
            <Field label="Name">
              <input
                className={inputClass}
                value={gitName}
                onChange={(e) => setGitName(e.target.value)}
                placeholder={`${container.name} Agent`}
              />
            </Field>
            <Field label="Email">
              <input
                className={inputClass}
                value={gitEmail}
                onChange={(e) => setGitEmail(e.target.value)}
                placeholder={`agents+${container.company}@users.noreply.github.com`}
              />
            </Field>
            <div className="flex justify-end">
              <Button size="sm" onClick={saveGit}>
                Save identity
              </Button>
            </div>
          </div>
        </Panel>
      </div>

      <div>
        <SectionTitle>Resource limits</SectionTitle>
        <Panel>
          <div className="space-y-3 p-4">
            <div className="grid grid-cols-3 gap-3">
              <Field label="Memory (MB)">
                <input
                  className={inputClass}
                  value={mem}
                  onChange={(e) => setMem(e.target.value)}
                  placeholder={String(container.resources.memMb)}
                />
              </Field>
              <Field label="CPUs">
                <input
                  className={inputClass}
                  value={cpus}
                  onChange={(e) => setCpus(e.target.value)}
                  placeholder={String(container.resources.cpus)}
                />
              </Field>
              <Field label="Process limit">
                <input
                  className={inputClass}
                  value={pids}
                  onChange={(e) => setPids(e.target.value)}
                  placeholder={String(container.resources.pidsLimit)}
                />
              </Field>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-neutral-400">
                {container.resources.isDefault
                  ? "Using global defaults — leave blank to keep them."
                  : "Custom limits set."}
              </span>
              <Button size="sm" onClick={saveResources}>
                Save limits
              </Button>
            </div>
          </div>
        </Panel>
      </div>

      {note && <p className="text-xs text-emerald-600">{note}</p>}
    </div>
  );
}
