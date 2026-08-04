"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { api, type CatalogEntry } from "@/lib/api";
import {
  Button,
  EmptyState,
  Field,
  inputClass,
  Panel,
  Pill,
} from "@/components/kit";
import { McpFavicon } from "@/components/McpIcon";

export function CatalogView() {
  const [entries, setEntries] = useState<CatalogEntry[]>([]);
  const [adding, setAdding] = useState(false);
  const [err, setErr] = useState(false);

  const refresh = () =>
    api
      .listCatalog()
      .then((e) => {
        setEntries(e);
        setErr(false);
      })
      .catch(() => setErr(true));
  useEffect(() => {
    refresh();
  }, []);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-8 py-6">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">MCP Catalog</h1>
          <p className="text-xs text-neutral-400">
            Global server definitions — assign them per container.
          </p>
        </div>
        <Button variant="primary" onClick={() => setAdding((a) => !a)}>
          <Plus size={14} /> Add server
        </Button>
      </div>

      {adding && (
        <AddForm
          onDone={() => {
            setAdding(false);
            refresh();
          }}
        />
      )}

      <Panel>
        {err ? (
          <EmptyState
            icon={<Plus size={32} />}
            title="Can't reach the backend"
            hint="It may still be starting — give it a moment and refresh."
          />
        ) : entries.length === 0 ? (
          <EmptyState icon={<Plus size={32} />} title="Catalog is empty" />
        ) : (
          <div className="divide-y divide-neutral-100">
            {entries.map((e) => (
              <div key={e.id} className="flex items-center gap-3 px-4 py-3">
                <McpFavicon entryId={e.id} icon={e.icon} size={18} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{e.label}</div>
                  <div className="font-mono text-xs text-neutral-400">
                    {e.key}
                    {e.website ? ` · ${e.website}` : ""}
                  </div>
                </div>
                {e.secrets_json.length > 0 ? (
                  <Pill tone="amber">
                    {e.secrets_json.map((s) => s.env).join(", ")}
                  </Pill>
                ) : (
                  <Pill tone="blue">OAuth / no token</Pill>
                )}
                <button
                  onClick={() => {
                    if (confirm(`Delete "${e.label}" from the catalog?`))
                      api.deleteCatalogEntry(e.id).then(refresh);
                  }}
                  className="rounded-lg p-1.5 text-neutral-300 hover:bg-red-50 hover:text-red-500"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>
        )}
      </Panel>
      </div>
    </div>
  );
}

function AddForm({ onDone }: { onDone: () => void }) {
  const [key, setKey] = useState("");
  const [label, setLabel] = useState("");
  const [website, setWebsite] = useState("");
  const [icon, setIcon] = useState("globe");
  const [configText, setConfigText] = useState("");
  const [secretsText, setSecretsText] = useState("");
  const [error, setError] = useState("");

  async function add() {
    setError("");
    let cfg: Record<string, unknown>;
    try {
      cfg = JSON.parse(configText);
    } catch {
      setError("Config is not valid JSON");
      return;
    }
    const secrets = secretsText
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        const [env, ...rest] = l.split("=");
        return { env: env.trim(), label: rest.join("=").trim() || env.trim() };
      });
    try {
      await api.createCatalogEntry({
        key,
        label,
        icon,
        website: website.trim() || undefined,
        config: cfg,
        secrets,
      });
      onDone();
    } catch (e) {
      setError(String((e as Error).message));
    }
  }

  return (
    <Panel className="mb-5">
      <div className="space-y-3 p-4">
        <div className="grid grid-cols-3 gap-3">
          <Field label="Key">
            <input
              className={inputClass}
              value={key}
              onChange={(e) => setKey(e.target.value.toLowerCase())}
              placeholder="linkedin"
            />
          </Field>
          <Field label="Label">
            <input
              className={inputClass}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="LinkedIn"
            />
          </Field>
          <Field label="Icon">
            <select
              className={inputClass}
              value={icon}
              onChange={(e) => setIcon(e.target.value)}
            >
              {["globe", "github", "instagram", "linkedin"].map((i) => (
                <option key={i}>{i}</option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Website (for favicon)">
          <input
            className={inputClass}
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
            placeholder="linkedin.com"
          />
        </Field>
        <Field label="Server config (Claude-style JSON)">
          <textarea
            className={`${inputClass} h-20 font-mono text-xs`}
            value={configText}
            onChange={(e) => setConfigText(e.target.value)}
            spellCheck={false}
            placeholder='{"type":"http","url":"https://mcp.example.com/mcp"}'
          />
        </Field>
        <Field label="Required secrets — one per line: ENV_VAR = Label">
          <textarea
            className={`${inputClass} h-14 font-mono text-xs`}
            value={secretsText}
            onChange={(e) => setSecretsText(e.target.value)}
            spellCheck={false}
            placeholder="LINKEDIN_TOKEN = Access Token"
          />
        </Field>
        {error && <p className="text-xs text-red-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button onClick={onDone}>Cancel</Button>
          <Button
            variant="primary"
            onClick={add}
            disabled={!key || !label || !configText}
          >
            Add
          </Button>
        </div>
      </div>
    </Panel>
  );
}
