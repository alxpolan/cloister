"use client";

import { useEffect, useRef, useState } from "react";
import { ScrollText } from "lucide-react";
import { api, type RunDetail, type RunSummary } from "@/lib/api";
import { EmptyState, Panel, Pill } from "@/components/kit";

function tone(status: RunSummary["status"]) {
  return status === "succeeded"
    ? "green"
    : status === "failed"
      ? "red"
      : "blue";
}

function ago(iso: string) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function RunsView() {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const preRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    let active = true;
    const load = () =>
      api
        .listRuns()
        .then((r) => active && setRuns(r))
        .catch(() => {});
    load();
    const t = setInterval(load, 2500);
    return () => {
      active = false;
      clearInterval(t);
    };
  }, []);

  useEffect(() => {
    if (!selected) return;
    let active = true;
    const load = () =>
      api
        .getRun(selected)
        .then((d) => active && setDetail(d))
        .catch(() => {});
    load();
    const t = setInterval(() => detail?.status === "running" && load(), 1500);
    return () => {
      active = false;
      clearInterval(t);
    };
  }, [selected, detail?.status]);

  useEffect(() => {
    preRef.current?.scrollTo({ top: preRef.current.scrollHeight });
  }, [detail?.stdout]);

  return (
    <div className="flex h-full">
      <aside className="flex w-80 shrink-0 flex-col border-r border-neutral-200 bg-white">
        <div className="px-4 py-3">
          <h2 className="text-sm font-semibold">Runs</h2>
          <p className="text-xs text-neutral-400">{runs.length} recent</p>
        </div>
        <div className="flex-1 overflow-auto px-2 pb-2">
          {runs.map((r) => (
            <button
              key={r.id}
              onClick={() => {
                setSelected(r.id);
                setDetail(null);
              }}
              className={`mb-1 flex w-full flex-col gap-1 rounded-lg px-3 py-2 text-left transition-colors ${
                selected === r.id ? "bg-accent-soft" : "hover:bg-neutral-50"
              }`}
            >
              <div className="flex items-center gap-2">
                <Pill tone={tone(r.status)}>{r.status}</Pill>
                <span className="text-xs font-medium">{r.company}</span>
                <span className="ml-auto text-[11px] text-neutral-400">
                  {ago(r.started_at)}
                </span>
              </div>
              <span className="line-clamp-2 text-xs text-neutral-500">
                {r.prompt}
              </span>
              <span className="font-mono text-[10px] text-neutral-400">
                {r.cli}
                {r.model ? ` · ${r.model}` : ""}
              </span>
            </button>
          ))}
        </div>
      </aside>

      <div className="flex-1 overflow-hidden">
        {!detail ? (
          <EmptyState
            icon={<ScrollText size={40} strokeWidth={1.5} />}
            title={selected ? "Loading…" : "Select a run"}
            hint="Agent runs triggered through the API appear here."
          />
        ) : (
          <div className="flex h-full flex-col p-8">
            <div className="mb-3 flex items-center gap-2">
              <Pill tone={tone(detail.status)}>{detail.status}</Pill>
              <span className="font-mono text-xs text-neutral-500">
                {detail.cli}
                {detail.model ? ` · ${detail.model}` : ""}
              </span>
              {detail.exit_code !== null && (
                <span className="text-xs text-neutral-400">
                  exit {detail.exit_code}
                </span>
              )}
              <span className="ml-auto text-xs text-neutral-400">
                {ago(detail.started_at)}
              </span>
            </div>
            <Panel className="flex-1 overflow-hidden">
              <pre
                ref={preRef}
                className="h-full overflow-auto whitespace-pre-wrap break-words rounded-xl bg-neutral-950 p-4 font-mono text-xs leading-relaxed text-neutral-100"
              >
                {detail.stdout ||
                  (detail.status === "running" ? "…working…" : "(no output)")}
                {detail.stderr && (
                  <span className="text-red-400">
                    {"\n\n--- stderr ---\n"}
                    {detail.stderr}
                  </span>
                )}
                {detail.error && (
                  <span className="text-red-400">
                    {"\n\n[error] " + detail.error}
                  </span>
                )}
              </pre>
            </Panel>
          </div>
        )}
      </div>
    </div>
  );
}
