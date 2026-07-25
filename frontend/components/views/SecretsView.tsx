"use client";

import { useEffect, useState } from "react";
import { KeyRound, Plus } from "lucide-react";
import { api, type SecretRef } from "@/lib/api";
import { Button, EmptyState, Field, inputClass, Panel } from "@/components/kit";

export function SecretsView() {
  const [secrets, setSecrets] = useState<SecretRef[]>([]);
  const [ref, setRef] = useState("");
  const [value, setValue] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  const refresh = () =>
    api
      .listSecrets()
      .then(setSecrets)
      .catch(() => {});
  useEffect(() => {
    refresh();
  }, []);

  async function save() {
    setError("");
    setNote("");
    try {
      await api.putSecret(ref.trim(), value);
      setNote(`Saved "${ref.trim()}".`);
      setRef("");
      setValue("");
      refresh();
    } catch (e) {
      setError(String((e as Error).message));
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-8 py-6">
      <div className="mb-5">
        <h1 className="text-lg font-semibold">Secrets</h1>
        <p className="text-xs text-neutral-400">
          Encrypted with libsodium before hitting the database; decrypted only
          into a container&apos;s env at start.
        </p>
      </div>

      <Panel className="mb-5">
        <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-3 p-4">
          <Field label="Reference">
            <input
              className={inputClass}
              value={ref}
              onChange={(e) => setRef(e.target.value)}
              placeholder="marteso-github-pat"
            />
          </Field>
          <Field label="Value">
            <input
              type="password"
              className={inputClass}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="token / API key"
            />
          </Field>
          <Button variant="primary" onClick={save} disabled={!ref || !value}>
            <Plus size={14} /> Save
          </Button>
        </div>
        {(note || error) && (
          <p
            className={`px-4 pb-3 text-xs ${error ? "text-red-600" : "text-emerald-600"}`}
          >
            {error || note}
          </p>
        )}
      </Panel>

      <Panel>
        {secrets.length === 0 ? (
          <EmptyState icon={<KeyRound size={32} />} title="No secrets yet" />
        ) : (
          <div className="divide-y divide-neutral-100">
            {secrets.map((s) => (
              <div
                key={s.ref}
                className="flex items-center gap-2.5 px-4 py-2.5"
              >
                <KeyRound size={14} className="text-amber-500" />
                <span className="font-mono text-sm">{s.ref}</span>
                <span className="ml-auto text-xs text-neutral-400">set</span>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}
