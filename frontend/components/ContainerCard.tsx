"use client";

import {
  Github,
  Instagram,
  Linkedin,
  Globe,
  Play,
  Plug,
  Square,
  Terminal,
  Trash2,
} from "lucide-react";
import type { Container } from "@/lib/api";
import { Button, StatusDot } from "./ui";

export function platformIcon(type: string, size = 14) {
  switch (type.toLowerCase()) {
    case "github":
      return <Github size={size} className="text-neutral-600" />;
    case "instagram":
      return <Instagram size={size} className="text-neutral-600" />;
    case "linkedin":
      return <Linkedin size={size} className="text-neutral-600" />;
    default:
      return <Globe size={size} className="text-neutral-600" />;
  }
}

export function ContainerCard({
  container,
  busy,
  onStart,
  onStop,
  onEditMcp,
  onDelete,
  onLogin,
}: {
  container: Container;
  busy: boolean;
  onStart: () => void;
  onStop: () => void;
  onEditMcp: () => void;
  onDelete: () => void;
  onLogin: (cli: "claude" | "codex") => void;
}) {
  const running = container.status === "running";
  const customCount = Object.keys(container.mcp_config_json?.mcpServers ?? {}).length;
  const mcpCount = container.mcps.length + customCount;

  return (
    <div className="flex flex-col rounded border border-neutral-200 bg-white">
      <div className="flex items-center justify-between border-b border-neutral-100 px-4 py-3">
        <div>
          <div className="flex items-center gap-2">
            <StatusDot running={running} />
            <h3 className="text-sm font-semibold">{container.name}</h3>
          </div>
          <p className="mt-0.5 font-mono text-xs text-neutral-400">
            {container.company} · {running ? "running" : "stopped"} · {mcpCount} MCP
            {mcpCount === 1 ? " server" : " servers"}
          </p>
        </div>
        <button
          onClick={onDelete}
          className="text-neutral-300 hover:text-red-500"
          title="Remove container"
        >
          <Trash2 size={15} />
        </button>
      </div>

      <div className="space-y-1.5 border-b border-neutral-100 px-4 py-3">
        <CliRow
          name="Claude Code"
          ok={container.claudeAuthenticated}
          canLogin={running && !busy}
          onLogin={() => onLogin("claude")}
        />
        <CliRow
          name="Codex"
          ok={container.codexAuthenticated}
          canLogin={running && !busy}
          onLogin={() => onLogin("codex")}
        />
      </div>

      <div className="flex-1 px-4 py-3">
        {container.mcps.length === 0 && customCount === 0 ? (
          <p className="text-xs text-neutral-400">No MCP servers assigned</p>
        ) : (
          <ul className="space-y-1.5">
            {container.mcps.map((m) => (
              <li key={m.key} className="flex items-center gap-2 text-xs">
                {platformIcon(m.icon)}
                <span className="font-medium text-neutral-800">{m.label}</span>
                {!m.secretsOk && (
                  <span className="ml-auto text-red-500">token missing</span>
                )}
              </li>
            ))}
            {customCount > 0 && (
              <li className="text-xs text-neutral-400">
                + {customCount} custom (raw JSON)
              </li>
            )}
          </ul>
        )}
      </div>

      <div className="flex items-center gap-2 border-t border-neutral-100 px-4 py-3">
        {running ? (
          <Button onClick={onStop} disabled={busy}>
            <Square size={12} />
            Stop
          </Button>
        ) : (
          <Button onClick={onStart} disabled={busy} variant="primary">
            <Play size={12} />
            Start
          </Button>
        )}
        <Button onClick={onEditMcp} disabled={busy}>
          <Plug size={12} />
          MCPs
        </Button>
      </div>
    </div>
  );
}

function CliRow({
  name,
  ok,
  canLogin,
  onLogin,
}: {
  name: string;
  ok: boolean;
  canLogin: boolean;
  onLogin: () => void;
}) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <Terminal size={13} className="text-neutral-400" />
      <span className="w-24 font-medium text-neutral-700">{name}</span>
      <StatusDot ok={ok} />
      <span className={ok ? "text-neutral-600" : "text-neutral-400"}>
        {ok ? "authenticated" : "not authenticated"}
      </span>
      {canLogin && (
        <button
          onClick={onLogin}
          className="ml-auto text-neutral-400 underline decoration-neutral-300 underline-offset-2 hover:text-neutral-700"
        >
          {ok ? "re-login" : "login"}
        </button>
      )}
    </div>
  );
}
