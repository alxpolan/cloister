"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { api, type Account, type Container, type SecretRef } from "@/lib/api";
import { Button, inputClass, labelClass, Modal } from "./ui";

const MCP_EXAMPLE = `{
  "github": {
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-github"],
    "env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "\${GITHUB_TOKEN}" }
  }
}`;

export function NewContainerModal({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: () => void;
}) {
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [error, setError] = useState("");

  async function submit() {
    try {
      await api.createContainer(name.trim(), company.trim());
      onDone();
      onClose();
    } catch (e) {
      setError(String((e as Error).message));
    }
  }

  return (
    <Modal title="New container" onClose={onClose}>
      <div className="space-y-3">
        <div>
          <label className={labelClass}>Display name</label>
          <input
            className={inputClass}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Marteso"
          />
        </div>
        <div>
          <label className={labelClass}>
            Company slug (directory & container name)
          </label>
          <input
            className={inputClass}
            value={company}
            onChange={(e) => setCompany(e.target.value.toLowerCase())}
            placeholder="marteso"
          />
          <p className="mt-1 text-xs text-neutral-400">
            lowercase letters, digits, hyphens — becomes ./homes/&lt;slug&gt; and
            container agent-&lt;slug&gt;
          </p>
        </div>
        {error && <p className="text-xs text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit} disabled={!name || !company}>
            Create
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export function McpConfigModal({
  container,
  onClose,
  onDone,
}: {
  container: Container;
  onClose: () => void;
  onDone: () => void;
}) {
  const [text, setText] = useState(
    JSON.stringify(container.mcp_config_json?.mcpServers ?? {}, null, 2)
  );
  const [error, setError] = useState("");

  async function submit() {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(text);
    } catch {
      setError("Invalid JSON");
      return;
    }
    try {
      await api.updateMcpConfig(container.id, parsed);
      onDone();
      onClose();
    } catch (e) {
      setError(String((e as Error).message));
    }
  }

  return (
    <Modal title={`Custom MCP servers — ${container.name}`} onClose={onClose} wide>
      <div className="space-y-3">
        <p className="text-xs text-neutral-500">
          Extra <code className="font-mono">mcpServers</code> entries merged on top
          of the catalog assignments (same name overrides). Reference injected
          secrets via <code className="font-mono">{"${ENV_VAR}"}</code>.
        </p>
        <textarea
          className={`${inputClass} h-64 font-mono text-xs`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          spellCheck={false}
          placeholder={MCP_EXAMPLE}
        />
        {error && <p className="text-xs text-red-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit}>
            Save (applies on next start)
          </Button>
        </div>
      </div>
    </Modal>
  );
}

type AccountDraft = Omit<Account, "id" | "container_id">;

export function AccountsModal({
  container,
  onClose,
  onDone,
}: {
  container: Container;
  onClose: () => void;
  onDone: () => void;
}) {
  const [rows, setRows] = useState<AccountDraft[]>(
    container.accounts.map(({ type, label, role, env_var, secret_ref }) => ({
      type,
      label,
      role,
      env_var,
      secret_ref,
    }))
  );
  const [secrets, setSecrets] = useState<SecretRef[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    api.listSecrets().then(setSecrets).catch(() => setSecrets([]));
  }, []);

  function update(i: number, patch: Partial<AccountDraft>) {
    setRows((r) => r.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
  }

  async function submit() {
    try {
      await api.updateAccounts(container.id, rows);
      onDone();
      onClose();
    } catch (e) {
      setError(String((e as Error).message));
    }
  }

  return (
    <Modal title={`Accounts — ${container.name}`} onClose={onClose} wide>
      <div className="space-y-3">
        {rows.length === 0 && (
          <p className="text-xs text-neutral-400">No accounts yet.</p>
        )}
        {rows.map((row, i) => (
          <div key={i} className="grid grid-cols-[110px_1fr_1fr_1fr_auto] gap-2">
            <select
              className={inputClass}
              value={row.type}
              onChange={(e) => update(i, { type: e.target.value })}
            >
              {["github", "instagram", "linkedin", "revenuecat", "other"].map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <input
              className={inputClass}
              value={row.label}
              onChange={(e) => update(i, { label: e.target.value })}
              placeholder="label (e.g. org account)"
            />
            <input
              className={inputClass}
              value={row.role ?? ""}
              onChange={(e) => update(i, { role: e.target.value })}
              placeholder="role (e.g. repo access)"
            />
            <select
              className={inputClass}
              value={row.secret_ref ?? ""}
              onChange={(e) => update(i, { secret_ref: e.target.value || null })}
            >
              <option value="">— no secret —</option>
              {secrets.map((s) => (
                <option key={s.ref} value={s.ref}>
                  {s.ref}
                </option>
              ))}
            </select>
            <button
              onClick={() => setRows((r) => r.filter((_, idx) => idx !== i))}
              className="text-neutral-300 hover:text-red-500"
              title="Remove row"
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
        <Button
          onClick={() =>
            setRows((r) => [
              ...r,
              { type: "github", label: "", role: "", env_var: null, secret_ref: null },
            ])
          }
        >
          <Plus size={12} />
          Add account
        </Button>
        <p className="text-xs text-neutral-500">
          Secrets are injected as env vars on next start (default name:{" "}
          <code className="font-mono">TYPE_TOKEN</code>, e.g.{" "}
          <code className="font-mono">GITHUB_TOKEN</code>). Manage secret values via
          the Secrets button in the header.
        </p>
        {error && <p className="text-xs text-red-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit}>
            Save
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export function SecretsModal({ onClose }: { onClose: () => void }) {
  const [secrets, setSecrets] = useState<SecretRef[]>([]);
  const [ref, setRef] = useState("");
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");

  async function refresh() {
    setSecrets(await api.listSecrets().catch(() => []));
  }
  useEffect(() => {
    refresh();
  }, []);

  async function submit() {
    setError("");
    setSaved("");
    try {
      await api.putSecret(ref.trim(), value);
      setSaved(ref.trim());
      setRef("");
      setValue("");
      refresh();
    } catch (e) {
      setError(String((e as Error).message));
    }
  }

  return (
    <Modal title="Secrets" onClose={onClose}>
      <div className="space-y-3">
        <p className="text-xs text-neutral-500">
          Values are encrypted with libsodium before they hit the database and are
          only ever decrypted into a container&apos;s env at start.
        </p>
        {secrets.length > 0 && (
          <ul className="divide-y divide-neutral-100 rounded border border-neutral-200">
            {secrets.map((s) => (
              <li
                key={s.ref}
                className="flex items-center justify-between px-3 py-1.5 font-mono text-xs"
              >
                <span>{s.ref}</span>
                <span className="text-neutral-400">set</span>
              </li>
            ))}
          </ul>
        )}
        <div>
          <label className={labelClass}>Reference</label>
          <input
            className={inputClass}
            value={ref}
            onChange={(e) => setRef(e.target.value)}
            placeholder="marteso-github-pat"
          />
        </div>
        <div>
          <label className={labelClass}>Value</label>
          <input
            className={inputClass}
            type="password"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="token / API key"
          />
        </div>
        {saved && <p className="text-xs text-emerald-600">Saved “{saved}”.</p>}
        {error && <p className="text-xs text-red-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Close</Button>
          <Button variant="primary" onClick={submit} disabled={!ref || !value}>
            Save secret
          </Button>
        </div>
      </div>
    </Modal>
  );
}
