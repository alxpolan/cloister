"use client";

import { X } from "lucide-react";
import type { ReactNode } from "react";

export function StatusDot({ ok, running }: { ok?: boolean; running?: boolean }) {
  const color =
    running === true || ok === true
      ? "bg-emerald-500"
      : running === false
        ? "bg-neutral-300"
        : "bg-red-400";
  return <span className={`inline-block h-2 w-2 rounded-full ${color}`} />;
}

export function Button({
  children,
  onClick,
  variant = "secondary",
  disabled,
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "secondary" | "danger";
  disabled?: boolean;
  title?: string;
}) {
  const styles = {
    primary:
      "bg-neutral-900 text-white hover:bg-neutral-700 border border-neutral-900",
    secondary:
      "bg-white text-neutral-700 hover:bg-neutral-100 border border-neutral-300",
    danger: "bg-white text-red-600 hover:bg-red-50 border border-neutral-300",
  }[variant];
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${styles}`}
    >
      {children}
    </button>
  );
}

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
      className="fixed inset-0 z-50 flex items-start justify-center bg-neutral-900/40 p-4 pt-[8vh]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`w-full ${wide ? "max-w-2xl" : "max-w-md"} rounded border border-neutral-200 bg-white shadow-xl`}
      >
        <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-3">
          <h2 className="text-sm font-semibold">{title}</h2>
          <button
            onClick={onClose}
            className="text-neutral-400 hover:text-neutral-700"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

export const inputClass =
  "w-full rounded border border-neutral-300 bg-white px-2.5 py-1.5 text-sm text-neutral-900 placeholder-neutral-400 focus:border-neutral-500 focus:outline-none";

export const labelClass = "mb-1 block text-xs font-medium text-neutral-600";
