"use client";

import { useEffect, useRef, useState } from "react";
import { ExternalLink, Send } from "lucide-react";
import { api, type AuthSessionState, type Container } from "@/lib/api";
import { Button, inputClass, Modal } from "./ui";

const URL_RE = /https:\/\/[^\s"'<>)\]]+/g;

export function AuthModal({
  container,
  cli,
  onClose,
  onDone,
}: {
  container: Container;
  cli: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const isMcp = cli.startsWith("mcp:");
  const title = isMcp
    ? `Authorize ${cli.slice(4)} — ${container.name}`
    : `${cli === "claude" ? "Claude Code" : "Codex"} login — ${container.name}`;
  const [session, setSession] = useState<AuthSessionState | null>(null);
  const [note, setNote] = useState("");
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const [succeeded, setSucceeded] = useState(false);
  const sidRef = useRef<string | null>(null);
  const preRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    let cancelled = false;

    (async () => {
      try {
        const { sessionId, note } = await api.startAuth(container.id, cli);
        if (cancelled) return;
        sidRef.current = sessionId;
        setNote(note);
        timer = setInterval(async () => {
          try {
            const s = await api.getAuthSession(sessionId);
            setSession(s);
            if (!s.running && timer) {
              clearInterval(timer);
              if (s.exitCode === 0) {
                setSucceeded(true);
                onDone();
                setTimeout(() => {
                  sidRef.current = null;
                  onClose();
                }, 1800);
              }
            }
          } catch {
            if (timer) clearInterval(timer);
          }
        }, 1000);
      } catch (e) {
        setError(String((e as Error).message));
      }
    })();

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      if (sidRef.current) api.killAuthSession(sidRef.current).catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    preRef.current?.scrollTo({ top: preRef.current.scrollHeight });
  }, [session?.output]);

  const urls = [...new Set(session?.output.match(URL_RE) ?? [])];
  const authUrl = urls.find(
    (u) => u.includes("oauth") || u.includes("auth") || u.includes("login")
  );

  async function send() {
    if (!sidRef.current || !input) return;
    try {
      await api.sendAuthInput(sidRef.current, input);
      setInput("");
      setError("");
    } catch (e) {
      setError(String((e as Error).message));
    }
  }

  function close() {
    onDone();
    onClose();
  }

  if (succeeded) {
    return (
      <Modal
        title={title}
        onClose={close}
        wide
      >
        <div className="flex flex-col items-center gap-3 py-14">
          <svg viewBox="0 0 24 24" className="h-12 w-12 fill-emerald-500">
            <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm-1.2 14.5-4-4 1.4-1.4 2.6 2.6 5.8-5.8 1.4 1.4-7.2 7.2Z" />
          </svg>
          <p className="text-sm font-semibold">{isMcp ? "Authorization successful" : "Login successful"}</p>
          <p className="text-xs text-neutral-500">
            {isMcp
              ? `Authorization stored — ${cli.slice(4)} is ready for autonomous runs.`
              : cli === "claude"
                ? "Token captured and stored securely — Claude Code is ready."
                : "Codex is authenticated."}
          </p>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      title={title}
      onClose={close}
      wide
    >
      <div className="space-y-3">
        {note && <p className="text-xs text-neutral-500">{note}</p>}
        <pre
          ref={preRef}
          className="h-64 overflow-auto rounded border border-neutral-200 bg-neutral-950 p-3 font-mono text-xs leading-relaxed text-neutral-100"
        >
          {session?.output || "starting…"}
        </pre>
        {authUrl && (
          <a
            href={authUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded border border-neutral-900 bg-neutral-900 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-neutral-700"
          >
            <ExternalLink size={12} />
            Open authorization URL
          </a>
        )}
        {session && !session.running && (
          <p className="text-xs text-neutral-500">
            Session ended (exit code {session.exitCode ?? "?"}). Close this dialog —
            the auth status refreshes automatically.
          </p>
        )}
        <div className="flex gap-2">
          <input
            className={inputClass}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send()}
            placeholder="paste code / answer here, Enter to send"
            disabled={!session?.running}
          />
          <Button onClick={send} disabled={!session?.running || !input}>
            <Send size={12} />
            Send
          </Button>
        </div>
        {error && <p className="text-xs text-red-600">{error}</p>}
        <div className="flex justify-end">
          <Button onClick={close}>Close</Button>
        </div>
      </div>
    </Modal>
  );
}
