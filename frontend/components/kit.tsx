"use client";

import { X } from "lucide-react";
import type { ReactNode } from "react";

// MARK: colors ---------------------------------------------------------------

const AVATAR_PALETTE = [
  "from-blue-500 to-blue-600",
  "from-violet-500 to-violet-600",
  "from-pink-500 to-rose-600",
  "from-orange-500 to-amber-600",
  "from-teal-500 to-emerald-600",
  "from-indigo-500 to-indigo-600",
  "from-cyan-500 to-sky-600",
  "from-fuchsia-500 to-purple-600",
];

export function companyGradient(name: string): string {
  let hash = 5381;
  for (const ch of name) hash = (hash << 5) + hash + ch.charCodeAt(0);
  return AVATAR_PALETTE[Math.abs(hash) % AVATAR_PALETTE.length];
}

// MARK: primitives -----------------------------------------------------------

export function Avatar({ name, size = 28 }: { name: string; size?: number }) {
  return (
    <div
      className={`flex shrink-0 items-center justify-center rounded-lg bg-gradient-to-br font-semibold text-white ${companyGradient(name)}`}
      style={{ width: size, height: size, fontSize: size * 0.44 }}
    >
      {name.slice(0, 1).toUpperCase()}
    </div>
  );
}

export function IconTile({
  children,
  color,
  size = 24,
}: {
  children: ReactNode;
  color: string;
  size?: number;
}) {
  return (
    <div
      className={`flex shrink-0 items-center justify-center rounded-md text-white ${color}`}
      style={{ width: size, height: size }}
    >
      {children}
    </div>
  );
}

export function StatusDot({ running }: { running: boolean }) {
  return (
    <span className="relative flex h-2 w-2">
      {running && (
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
      )}
      <span
        className={`relative inline-flex h-2 w-2 rounded-full ${running ? "bg-emerald-500" : "bg-neutral-300"}`}
      />
    </span>
  );
}

export function Pill({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "green" | "red" | "amber" | "blue";
}) {
  const tones = {
    neutral: "bg-neutral-100 text-neutral-600",
    green: "bg-emerald-50 text-emerald-700",
    red: "bg-red-50 text-red-600",
    amber: "bg-amber-50 text-amber-700",
    blue: "bg-blue-50 text-blue-700",
  }[tone];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium ${tones}`}
    >
      {children}
    </span>
  );
}

export function Button({
  children,
  onClick,
  variant = "secondary",
  disabled,
  title,
  size = "md",
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  disabled?: boolean;
  title?: string;
  size?: "sm" | "md";
  type?: "button" | "submit";
}) {
  const styles = {
    primary: "bg-accent text-white hover:bg-accent-hover shadow-sm",
    secondary:
      "bg-white text-neutral-700 hover:bg-neutral-50 border border-neutral-200 shadow-sm",
    ghost: "text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800",
    danger:
      "bg-white text-red-600 hover:bg-red-50 border border-neutral-200 shadow-sm",
  }[variant];
  const sizing =
    size === "sm" ? "px-2 py-1 text-xs" : "px-3 py-1.5 text-[13px]";
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`inline-flex items-center gap-1.5 rounded-lg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${sizing} ${styles}`}
    >
      {children}
    </button>
  );
}

export function Panel({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-xl border border-neutral-200 bg-white shadow-sm ${className}`}
    >
      {children}
    </div>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <div className="px-1 pb-2 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
      {children}
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-neutral-600">
        {label}
      </span>
      {children}
      {hint && (
        <span className="mt-1 block text-xs text-neutral-400">{hint}</span>
      )}
    </label>
  );
}

export const inputClass =
  "w-full rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-sm text-neutral-900 placeholder-neutral-400 shadow-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20";

export function Modal({
  title,
  onClose,
  children,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-neutral-900/30 p-4 pt-[8vh] backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`w-full ${wide ? "max-w-2xl" : "max-w-md"} rounded-2xl border border-neutral-200 bg-white shadow-2xl`}
      >
        <div className="flex items-center justify-between border-b border-neutral-100 px-5 py-3.5">
          <h2 className="text-sm font-semibold">{title}</h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  hint,
}: {
  icon: ReactNode;
  title: string;
  hint?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-20 text-center">
      <div className="text-neutral-300">{icon}</div>
      <p className="text-sm font-medium text-neutral-600">{title}</p>
      {hint && <p className="max-w-xs text-xs text-neutral-400">{hint}</p>}
    </div>
  );
}
