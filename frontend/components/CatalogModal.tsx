"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { api, type CatalogEntry } from "@/lib/api";
import { Button, inputClass, labelClass, Modal } from "./ui";
import { platformIcon } from "./ContainerCard";

const CONFIG_PLACEHOLDER = `{"command":"npx","args":["-y","@some/mcp-server"],"env":{"MY_TOKEN":"\${MY_TOKEN}"}}
or remote: {"type":"http","url":"https://mcp.example.com/mcp"}`;

export function CatalogModal({ onClose }: { onClose: () => void }) {
  const [entries, setEntries] = useState<CatalogEntry[]>([]);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const [key, setKey] = useState("");
  const [label, setLabel] = useState("");
  const [icon, setIcon] = useState("globe");
  const [configText, setConfigText] = useState("");
  const [secretsText, setSecretsText] = useState("");

  async function refresh() {
    setEntries(await api.listCatalog().catch(() => []));
  }
  useEffect(() => {
    refresh();
  }, []);

  async function add() {
    setError("");
    let cfg: Record<string, unknown>;
    try {
      cfg = JSON.parse(configText);
    } catch {
      setError("Config is not valid JSON");
      return;
    }
    // one "ENV_VAR = Label" per line
    const secrets = secretsText
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        const [env, ...rest] = l.split("=");
        return { env: env.trim(), label: rest.join("=").trim() || env.trim() };
      });
    try {
      await api.createCatalogEntry({ key, label, icon, config: cfg, secrets });
      setKey("");
      setLabel("");
      setConfigText("");
      setSecretsText("");
      setAdding(false);
      refresh();
    } catch (e) {
      setError(String((e as Error).message));
    }
  }

  return (
    <Modal title="MCP catalog" onClose={onClose} wide>
      <div className="space-y-3">
        <p className="text-xs text-neutral-500">
          Global server definitions. Assign them per container via its MCPs
          button; tokens are bound there.
        </p>
        <ul className="divide-y divide-neutral-100 rounded border border-neutral-200">
          {entries.map((e) => (
            <li key={e.id} className="flex items-center gap-2.5 px-3 py-2 text-xs">
              {platformIcon(e.icon, 14)}
              <span className="font-medium text-neutral-800">{e.label}</span>
              <span className="font-mono text-neutral-400">{e.key}</span>
              <span className="text-neutral-400">
                {e.secrets_json.length > 0
                  ? e.secrets_json.map((s) => s.env).join(", ")
                  : "no token"}
              </span>
              <button
                onClick={() => {
                  if (confirm(`Delete "${e.label}" from the catalog? Container assignments are removed too.`)) {
                    api.deleteCatalogEntry(e.id).then(refresh).catch((err) => setError(String(err.message)));
                  }
                }}
                className="ml-auto text-neutral-300 hover:text-red-500"
                title="Delete"
              >
                <Trash2 size={13} />
              </button>
            </li>
          ))}
          {entries.length === 0 && (
            <li className="px-3 py-2 text-xs text-neutral-400">Catalog is empty.</li>
          )}
        </ul>

        {!adding ? (
          <Button onClick={() => setAdding(true)}>
            <Plus size={12} />
            Add server
          </Button>
        ) : (
          <div className="space-y-2 rounded border border-neutral-200 p-3">
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className={labelClass}>Key</label>
                <input
                  className={inputClass}
                  value={key}
                  onChange={(e) => setKey(e.target.value.toLowerCase())}
                  placeholder="linkedin"
                />
              </div>
              <div>
                <label className={labelClass}>Label</label>
                <input
                  className={inputClass}
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="LinkedIn"
                />
              </div>
              <div>
                <label className={labelClass}>Icon</label>
                <select
                  className={inputClass}
                  value={icon}
                  onChange={(e) => setIcon(e.target.value)}
                >
                  {["globe", "github", "instagram", "linkedin"].map((i) => (
                    <option key={i} value={i}>
                      {i}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label className={labelClass}>Server config (Claude-style JSON)</label>
              <textarea
                className={`${inputClass} h-20 font-mono text-xs`}
                value={configText}
                onChange={(e) => setConfigText(e.target.value)}
                placeholder={CONFIG_PLACEHOLDER}
                spellCheck={false}
              />
            </div>
            <div>
              <label className={labelClass}>
                Required secrets, one per line: ENV_VAR = Label (optional)
              </label>
              <textarea
                className={`${inputClass} h-14 font-mono text-xs`}
                value={secretsText}
                onChange={(e) => setSecretsText(e.target.value)}
                placeholder={"LINKEDIN_TOKEN = Access Token"}
                spellCheck={false}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button onClick={() => setAdding(false)}>Cancel</Button>
              <Button variant="primary" onClick={add} disabled={!key || !label || !configText}>
                Add
              </Button>
            </div>
          </div>
        )}
        {error && <p className="text-xs text-red-600">{error}</p>}
        <div className="flex justify-end">
          <Button onClick={onClose}>Close</Button>
        </div>
      </div>
    </Modal>
  );
}
