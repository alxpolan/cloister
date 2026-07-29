"use client";

import { useCallback, useEffect, useState } from "react";
import { Boxes, KeyRound, ScrollText, SquareStack } from "lucide-react";
import { api, type Container } from "@/lib/api";
import { IconTile, Modal, Field, inputClass, Button } from "@/components/kit";
import { ContainersView } from "@/components/views/ContainersView";
import { RunsView } from "@/components/views/RunsView";
import { CatalogView } from "@/components/views/CatalogView";
import { SecretsView } from "@/components/views/SecretsView";
import { AuthModal } from "@/components/AuthModal";

type Nav = "containers" | "runs" | "catalog" | "secrets";

const NAV: { key: Nav; label: string; icon: React.ReactNode; color: string }[] =
  [
    {
      key: "containers",
      label: "Containers",
      icon: <Boxes size={14} />,
      color: "bg-blue-500",
    },
    {
      key: "runs",
      label: "Runs",
      icon: <ScrollText size={14} />,
      color: "bg-violet-500",
    },
    {
      key: "catalog",
      label: "MCP Catalog",
      icon: <SquareStack size={14} />,
      color: "bg-orange-500",
    },
    {
      key: "secrets",
      label: "Secrets",
      icon: <KeyRound size={14} />,
      color: "bg-amber-500",
    },
  ];

export default function App() {
  const [nav, setNav] = useState<Nav>("containers");
  const [containers, setContainers] = useState<Container[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [auth, setAuth] = useState<{
    container: Container;
    cli: string;
  } | null>(null);

  const refresh = useCallback(async () => {
    try {
      const list = await api.listContainers();
      setContainers(list);
      setSelectedId((cur) => cur ?? list[0]?.id ?? null);
      setError("");
    } catch (e) {
      setError(String((e as Error).message));
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [refresh]);

  async function onAction(id: string, fn: () => Promise<unknown>) {
    setBusyId(id);
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError(String((e as Error).message));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <nav className="flex w-52 shrink-0 flex-col border-r border-neutral-200 bg-neutral-50/80 px-3 py-4">
        <div className="mb-5 flex items-center gap-2 px-2">
          <IconTile
            color="bg-gradient-to-br from-accent to-violet-600"
            size={26}
          >
            <Boxes size={15} />
          </IconTile>
          <span className="text-sm font-semibold">Cloister</span>
        </div>
        {NAV.map((item) => (
          <button
            key={item.key}
            onClick={() => setNav(item.key)}
            className={`mb-0.5 flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm font-medium transition-colors ${
              nav === item.key
                ? "bg-white text-neutral-900 shadow-sm"
                : "text-neutral-600 hover:bg-white/60"
            }`}
          >
            <IconTile color={item.color} size={22}>
              {item.icon}
            </IconTile>
            {item.label}
          </button>
        ))}
        <div className="mt-auto px-2 text-[11px] text-neutral-400">
          <p>
            Manage from here or the <span className="font-mono">cloister</span>{" "}
            CLI.
          </p>
        </div>
      </nav>

      <main className="flex flex-1 flex-col overflow-hidden bg-neutral-100">
        {error && (
          <div className="border-b border-red-100 bg-red-50 px-4 py-2 text-xs text-red-700">
            {error}
          </div>
        )}
        <div className="flex-1 overflow-hidden">
          {nav === "containers" && (
            <ContainersView
              containers={containers}
              selectedId={selectedId}
              onSelect={setSelectedId}
              busyId={busyId}
              onAction={onAction}
              onNew={() => setShowNew(true)}
              onLogin={(c, cli) => setAuth({ container: c, cli })}
              onRefresh={refresh}
            />
          )}
          {nav === "runs" && <RunsView />}
          {nav === "catalog" && <CatalogView />}
          {nav === "secrets" && <SecretsView />}
        </div>
      </main>

      {showNew && (
        <NewContainerModal onClose={() => setShowNew(false)} onDone={refresh} />
      )}
      {auth && (
        <AuthModal
          container={auth.container}
          cli={auth.cli}
          onClose={() => setAuth(null)}
          onDone={refresh}
        />
      )}
    </div>
  );
}

function NewContainerModal({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: () => void;
}) {
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [error, setError] = useState("");

  async function create() {
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
        <Field label="Display name">
          <input
            className={inputClass}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Marteso"
          />
        </Field>
        <Field
          label="Company slug"
          hint="lowercase letters, digits, hyphens — becomes ./homes/<slug> and container agent-<slug>"
        >
          <input
            className={inputClass}
            value={company}
            onChange={(e) => setCompany(e.target.value.toLowerCase())}
            placeholder="marteso"
          />
        </Field>
        {error && <p className="text-xs text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            onClick={create}
            disabled={!name || !company}
          >
            Create
          </Button>
        </div>
      </div>
    </Modal>
  );
}
