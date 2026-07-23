"use client";

import { useEffect, useRef, useState } from "react";
import { api, type RunDetail, type RunSummary } from "@/lib/api";
import { Button, Modal } from "./ui";

function StatusPill({ status }: { status: RunSummary["status"] }) {
  const map = {
    running: "bg-blue-100 text-blue-700",
    succeeded: "bg-emerald-100 text-emerald-700",
    failed: "bg-red-100 text-red-700",
  } as const;
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${map[status]}`}>
      {status}
    </span>
  );
}

function timeAgo(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function RunsModal({
  company,
  onClose,
}: {
  company?: string;
  onClose: () => void;
}) {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const preRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    let active = true;
    const load = () => api.listRuns(company).then((r) => active && setRuns(r)).catch(() => {});
    load();
    const t = setInterval(load, 2000);
    return () => {
      active = false;
      clearInterval(t);
    };
  }, [company]);

  useEffect(() => {
    if (!selected) return;
    let active = true;
    const load = () =>
      api.getRun(selected).then((d) => {
        if (!active) return;
        setDetail(d);
      }).catch(() => {});
    load();
    const t = setInterval(() => {
      if (detail?.status === "running") load();
    }, 1500);
    return () => {
      active = false;
      clearInterval(t);
    };
  }, [selected, detail?.status]);

  useEffect(() => {
    preRef.current?.scrollTo({ top: preRef.current.scrollHeight });
  }, [detail?.stdout]);

  return (
    <Modal title={company ? `Runs — ${company}` : "Runs"} onClose={onClose} wide>
      <div className="flex h-[60vh] gap-3">
        <div className="w-64 shrink-0 overflow-auto rounded border border-neutral-200">
          {runs.length === 0 && (
            <p className="p-3 text-xs text-neutral-400">No runs yet.</p>
          )}
          <ul className="divide-y divide-neutral-100">
            {runs.map((r) => (
              <li key={r.id}>
                <button
                  onClick={() => {
                    setSelected(r.id);
                    setDetail(null);
                  }}
                  className={`flex w-full flex-col gap-1 px-3 py-2 text-left hover:bg-neutral-50 ${
                    selected === r.id ? "bg-neutral-100" : ""
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <StatusPill status={r.status} />
                    {!company && (
                      <span className="text-xs font-medium text-neutral-700">{r.company}</span>
                    )}
                    <span className="ml-auto text-[10px] text-neutral-400">
                      {timeAgo(r.started_at)}
                    </span>
                  </div>
                  <span className="line-clamp-2 text-xs text-neutral-500">{r.prompt}</span>
                  <span className="font-mono text-[10px] text-neutral-400">
                    {r.cli}
                    {r.model ? ` · ${r.model}` : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div className="flex-1 overflow-hidden rounded border border-neutral-200">
          {!detail ? (
            <p className="p-4 text-xs text-neutral-400">
              {selected ? "Loading…" : "Select a run to view its output."}
            </p>
          ) : (
            <div className="flex h-full flex-col">
              <div className="flex items-center gap-2 border-b border-neutral-100 px-3 py-2 text-xs">
                <StatusPill status={detail.status} />
                <span className="font-mono text-neutral-500">
                  {detail.cli}
                  {detail.model ? ` · ${detail.model}` : ""}
                </span>
                {detail.exit_code !== null && (
                  <span className="text-neutral-400">exit {detail.exit_code}</span>
                )}
                <span className="ml-auto text-neutral-400">{timeAgo(detail.started_at)}</span>
              </div>
              <pre
                ref={preRef}
                className="flex-1 overflow-auto whitespace-pre-wrap break-words bg-neutral-950 p-3 font-mono text-xs text-neutral-100"
              >
                {detail.stdout || (detail.status === "running" ? "…working…" : "(no output)")}
                {detail.stderr && (
                  <span className="text-red-400">
                    {"\n\n--- stderr ---\n"}
                    {detail.stderr}
                  </span>
                )}
                {detail.error && (
                  <span className="text-red-400">{"\n\n[error] " + detail.error}</span>
                )}
              </pre>
            </div>
          )}
        </div>
      </div>
      <div className="mt-3 flex justify-end">
        <Button onClick={onClose}>Close</Button>
      </div>
    </Modal>
  );
}
