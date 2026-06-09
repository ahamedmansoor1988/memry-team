import React from "react";

const VARIANTS: Record<string, string> = {
  blocked:        "bg-red-50 text-red-700 border-red-200",
  needs_decision: "bg-zinc-900 text-white border-zinc-900",
  in_progress:    "bg-zinc-100 text-zinc-700 border-zinc-200",
  resolved:       "bg-zinc-100 text-zinc-400 border-zinc-200",
  open:           "bg-zinc-100 text-zinc-600 border-zinc-200",
  archived:       "bg-zinc-100 text-zinc-400 border-zinc-200",
};

const LABELS: Record<string, string> = {
  blocked:        "Blocked",
  needs_decision: "Needs Decision",
  in_progress:    "In Progress",
  resolved:       "Resolved",
  open:           "Open",
  archived:       "Archived",
};

const BASE = "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border";

export function StatusBadge({ status }: { status: string }) {
  const key = status.toLowerCase().replace(/ /g, "_");
  const cls = VARIANTS[key] ?? VARIANTS.open;
  const label = LABELS[key] ?? status;
  return <span className={`${BASE} ${cls}`}>{label}</span>;
}
