"use client";

import { useCallback, useEffect, useState } from "react";
import { KeyRound, Plug, Plus, RefreshCw, ScrollText } from "lucide-react";
import { api, type Container } from "@/lib/api";
import { Button } from "@/components/ui";
import { SummaryBar } from "@/components/SummaryBar";
import { ContainerCard } from "@/components/ContainerCard";
import { McpConfigModal, NewContainerModal, SecretsModal } from "@/components/dialogs";
import { AuthModal } from "@/components/AuthModal";
import { McpAssignModal } from "@/components/McpAssignModal";
import { CatalogModal } from "@/components/CatalogModal";
import { RunsModal } from "@/components/RunsModal";

type ModalState =
  | { kind: "none" }
  | { kind: "new" }
  | { kind: "secrets" }
  | { kind: "catalog" }
  | { kind: "runs"; company?: string }
  | { kind: "mcps"; container: Container }
  | { kind: "mcp-raw"; container: Container }
  | { kind: "auth"; container: Container; cli: string };

export default function Dashboard() {
  const [containers, setContainers] = useState<Container[] | null>(null);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalState>({ kind: "none" });

  const refresh = useCallback(async () => {
    try {
      setContainers(await api.listContainers());
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

  async function withBusy(id: string, fn: () => Promise<unknown>) {
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
    <div className="mx-auto max-w-6xl px-6 py-8">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Agent Containers</h1>
          <p className="text-xs text-neutral-500">
            Per-tenant Claude Code / Codex runtimes with isolated MCP config
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={refresh} title="Refresh">
            <RefreshCw size={12} />
            Refresh
          </Button>
          <Button onClick={() => setModal({ kind: "runs" })}>
            <ScrollText size={12} />
            Runs
          </Button>
          <Button onClick={() => setModal({ kind: "catalog" })}>
            <Plug size={12} />
            MCP catalog
          </Button>
          <Button onClick={() => setModal({ kind: "secrets" })}>
            <KeyRound size={12} />
            Secrets
          </Button>
          <Button variant="primary" onClick={() => setModal({ kind: "new" })}>
            <Plus size={12} />
            New container
          </Button>
        </div>
      </header>

      {error && (
        <div className="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </div>
      )}

      {containers && (
        <>
          <SummaryBar containers={containers} />
          <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {containers.map((c) => (
              <ContainerCard
                key={c.id}
                container={c}
                busy={busyId === c.id}
                onStart={() => withBusy(c.id, () => api.startContainer(c.id))}
                onStop={() => withBusy(c.id, () => api.stopContainer(c.id))}
                onEditMcp={() => setModal({ kind: "mcps", container: c })}
                onLogin={(cli) => setModal({ kind: "auth", container: c, cli })}
                onDelete={() => {
                  if (confirm(`Remove container "${c.name}"? The home directory (auth state) is kept.`)) {
                    withBusy(c.id, () => api.deleteContainer(c.id));
                  }
                }}
              />
            ))}
          </div>
          {containers.length === 0 && (
            <p className="mt-10 text-center text-sm text-neutral-400">
              No containers yet — create one per company to get isolated Claude
              Code / Codex environments.
            </p>
          )}
        </>
      )}
      {!containers && !error && (
        <p className="mt-10 text-center text-sm text-neutral-400">Loading…</p>
      )}

      {modal.kind === "new" && (
        <NewContainerModal onClose={() => setModal({ kind: "none" })} onDone={refresh} />
      )}
      {modal.kind === "secrets" && (
        <SecretsModal onClose={() => setModal({ kind: "none" })} />
      )}
      {modal.kind === "catalog" && (
        <CatalogModal onClose={() => setModal({ kind: "none" })} />
      )}
      {modal.kind === "runs" && (
        <RunsModal company={modal.company} onClose={() => setModal({ kind: "none" })} />
      )}
      {modal.kind === "mcps" && (
        <McpAssignModal
          container={modal.container}
          onClose={() => setModal({ kind: "none" })}
          onDone={refresh}
          onOpenAdvanced={() => setModal({ kind: "mcp-raw", container: modal.container })}
        />
      )}
      {modal.kind === "mcp-raw" && (
        <McpConfigModal
          container={modal.container}
          onClose={() => setModal({ kind: "none" })}
          onDone={refresh}
        />
      )}
      {modal.kind === "auth" && (
        <AuthModal
          container={modal.container}
          cli={modal.cli}
          onClose={() => setModal({ kind: "none" })}
          onDone={refresh}
        />
      )}
    </div>
  );
}
