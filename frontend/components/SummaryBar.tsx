"use client";

import { Boxes, KeyRound, Play } from "lucide-react";
import type { Container } from "@/lib/api";
import { platformIcon } from "./ContainerCard";

export function SummaryBar({ containers }: { containers: Container[] }) {
  const running = containers.filter((c) => c.status === "running").length;
  const accountsByPlatform = new Map<string, number>();
  for (const c of containers) {
    for (const m of c.mcps) {
      accountsByPlatform.set(m.icon, (accountsByPlatform.get(m.icon) ?? 0) + 1);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-x-8 gap-y-2 border border-neutral-200 bg-white px-4 py-3 rounded">
      <Stat
        icon={<Play size={14} className="text-neutral-500" />}
        label="Running"
        value={`${running} / ${containers.length}`}
      />
      <Stat
        icon={<Boxes size={14} className="text-neutral-500" />}
        label="Containers"
        value={String(containers.length)}
      />
      <div className="flex items-center gap-4 text-xs text-neutral-600">
        <span className="flex items-center gap-1.5 font-medium text-neutral-500">
          <KeyRound size={14} />
          Connections
        </span>
        {accountsByPlatform.size === 0 && <span className="text-neutral-400">none</span>}
        {[...accountsByPlatform.entries()].map(([type, count]) => (
          <span key={type} className="flex items-center gap-1">
            {platformIcon(type, 14)}
            <span className="tabular-nums">{count}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function Stat({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="flex items-center gap-1.5 font-medium text-neutral-500">
        {icon}
        {label}
      </span>
      <span className="font-semibold tabular-nums text-neutral-900">{value}</span>
    </div>
  );
}
