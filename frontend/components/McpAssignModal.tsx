"use client";

import { useEffect, useState } from "react";
import { api, type CatalogEntry, type Container, type SecretRef } from "@/lib/api";
import { Button, inputClass, Modal } from "./ui";
import { platformIcon } from "./ContainerCard";

interface DraftAssignment {
  enabled: boolean;
  bindings: Record<string, string>; // env -> secret ref
  newTokens: Record<string, string>; // env -> pasted plaintext (stored on save)
}

export function McpAssignModal({
  container,
  onClose,
  onDone,
  onOpenAdvanced,
}: {
  container: Container;
  onClose: () => void;
  onDone: () => void;
  onOpenAdvanced: () => void;
}) {
  const [catalog, setCatalog] = useState<CatalogEntry[] | null>(null);
  const [secrets, setSecrets] = useState<SecretRef[]>([]);
  const [drafts, setDrafts] = useState<Record<string, DraftAssignment>>({});
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [cat, assigned, secs] = await Promise.all([
          api.listCatalog(),
          api.getAssignments(container.id),
          api.listSecrets(),
        ]);
        setCatalog(cat);
        setSecrets(secs);
        const d: Record<string, DraftAssignment> = {};
        for (const entry of cat) {
          const a = assigned.find((x) => x.id === entry.id);
          d[entry.id] = {
            enabled: Boolean(a),
            bindings: a?.bindings_json ?? {},
            newTokens: {},
          };
        }
        setDrafts(d);
      } catch (e) {
        setError(String((e as Error).message));
      }
    })();
  }, [container.id]);

  function update(id: string, patch: Partial<DraftAssignment>) {
    setDrafts((d) => ({ ...d, [id]: { ...d[id], ...patch } }));
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
        // pasted tokens become secrets named <company>-<serverkey>[-n]
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
      onDone();
      onClose();
    } catch (e) {
      setError(String((e as Error).message));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={`MCP servers — ${container.name}`} onClose={onClose} wide>
      <div className="space-y-1">
        {!catalog && <p className="text-xs text-neutral-400">Loading…</p>}
        {catalog?.map((entry) => {
          const draft = drafts[entry.id];
          if (!draft) return null;
          return (
            <div key={entry.id} className="rounded border border-neutral-200">
              <label className="flex cursor-pointer items-center gap-3 px-3 py-2.5">
                <input
                  type="checkbox"
                  checked={draft.enabled}
                  onChange={(e) => update(entry.id, { enabled: e.target.checked })}
                  className="h-3.5 w-3.5 accent-neutral-900"
                />
                {platformIcon(entry.icon, 15)}
                <span className="text-sm font-medium text-neutral-800">
                  {entry.label}
                </span>
                <span className="font-mono text-xs text-neutral-400">{entry.key}</span>
                {entry.secrets_json.length === 0 && (
                  <span className="ml-auto text-xs text-neutral-400">
                    OAuth / no token needed
                  </span>
                )}
              </label>
              {draft.enabled && entry.secrets_json.length > 0 && (
                <div className="space-y-2 border-t border-neutral-100 px-3 py-2.5">
                  {entry.secrets_json.map((spec) => (
                    <div key={spec.env} className="grid grid-cols-[1fr_1fr] gap-2">
                      <select
                        className={inputClass}
                        value={draft.bindings[spec.env] ?? ""}
                        onChange={(e) =>
                          update(entry.id, {
                            bindings: { ...draft.bindings, [spec.env]: e.target.value },
                          })
                        }
                      >
                        <option value="">
                          {spec.label} — choose secret or paste new →
                        </option>
                        {secrets.map((s) => (
                          <option key={s.ref} value={s.ref}>
                            {s.ref}
                          </option>
                        ))}
                      </select>
                      <input
                        className={inputClass}
                        type="password"
                        placeholder={`paste new ${spec.label}`}
                        value={draft.newTokens[spec.env] ?? ""}
                        onChange={(e) =>
                          update(entry.id, {
                            newTokens: { ...draft.newTokens, [spec.env]: e.target.value },
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
        {error && <p className="pt-1 text-xs text-red-600">{error}</p>}
        <div className="flex items-center justify-between pt-3">
          <button
            onClick={onOpenAdvanced}
            className="text-xs text-neutral-400 underline decoration-neutral-300 underline-offset-2 hover:text-neutral-700"
          >
            Advanced: raw JSON extras
          </button>
          <div className="flex gap-2">
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" onClick={save} disabled={saving || !catalog}>
              {saving ? "Saving…" : "Save (applies on next start)"}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
