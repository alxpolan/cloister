"use client";

import { useState } from "react";
import { Github, Globe, Instagram, Linkedin } from "lucide-react";
import { API_URL } from "@/lib/api";

export function platformIcon(icon: string, size = 15) {
  switch (icon.toLowerCase()) {
    case "github":
      return <Github size={size} className="text-neutral-600" />;
    case "instagram":
      return <Instagram size={size} className="text-pink-500" />;
    case "linkedin":
      return <Linkedin size={size} className="text-sky-600" />;
    default:
      return <Globe size={size} className="text-teal-500" />;
  }
}

export function McpFavicon({
  entryId,
  icon,
  size = 16,
}: {
  entryId: string;
  icon: string;
  size?: number;
}) {
  const [failed, setFailed] = useState(false);
  if (failed) return platformIcon(icon, size);
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`${API_URL}/mcp-catalog/${entryId}/favicon`}
      alt=""
      width={size}
      height={size}
      className="rounded object-contain"
      onError={() => setFailed(true)}
    />
  );
}
