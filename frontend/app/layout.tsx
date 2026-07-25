import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Cloister",
  description: "Multi-tenant Claude Code / Codex container dashboard",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
