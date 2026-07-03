"use client";

import { useState } from "react";
import { scoreTone } from "@/lib/qa-score";

export interface Screenshot {
  dataUrl: string;
  width: number;
  height: number;
  truncated?: boolean;
  fullHeight?: number;
}

export interface AnnotatedFinding {
  id: string;
  index: number;
  severity: "high" | "medium" | "low";
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

const BOX_COLORS = {
  high: "#dc2626",
  medium: "#d97706",
  low: "#2563eb",
};

export function ScoreBadge({ score, label }: { score: number; label: string }) {
  const tone = scoreTone(score);
  return (
    <div className="flex items-center gap-3 rounded-xl border border-black/[0.08] p-3" style={{ background: tone.bg }}>
      <div
        className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border-4 bg-white text-[18px] font-bold"
        style={{ borderColor: tone.color, color: tone.color }}
      >
        {score}
      </div>
      <div>
        <p className="text-[13px] font-semibold" style={{ color: tone.color }}>{tone.label}</p>
        <p className="text-[11px] text-[#4b5563]">{label}</p>
      </div>
    </div>
  );
}

/**
 * Screenshot with numbered finding boxes overlaid at page coordinates.
 * Coordinates are scaled from captured-pixel space to the rendered size
 * using percentages, so the overlay survives responsive resizing.
 */
export function AnnotatedScreenshot({ screenshot, findings, caption }: {
  screenshot: Screenshot;
  findings: AnnotatedFinding[];
  caption?: string;
}) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const placeable = findings.filter(f =>
    typeof f.x === "number" && typeof f.y === "number" && f.y! < screenshot.height
  );

  return (
    <figure className="space-y-2">
      <div className="relative overflow-hidden rounded-lg border border-black/[0.08]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={screenshot.dataUrl} alt={caption ?? "Page screenshot"} className="block w-full" />
        {placeable.map(f => {
          const w = Math.max(f.width ?? 32, 18);
          const h = Math.max(f.height ?? 32, 18);
          const color = BOX_COLORS[f.severity];
          const active = activeId === f.id;
          return (
            <div
              key={f.id}
              onMouseEnter={() => setActiveId(f.id)}
              onMouseLeave={() => setActiveId(null)}
              className="absolute rounded-sm"
              style={{
                left: `${(f.x! / screenshot.width) * 100}%`,
                top: `${(f.y! / screenshot.height) * 100}%`,
                width: `${Math.min((w / screenshot.width) * 100, 100)}%`,
                height: `${(h / screenshot.height) * 100}%`,
                border: `2px solid ${color}`,
                background: active ? `${color}33` : `${color}14`,
                boxShadow: `0 0 0 1px #ffffffaa`,
              }}
            >
              <span
                className="absolute -left-1 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] font-bold text-white"
                style={{ background: color }}
              >
                {f.index}
              </span>
            </div>
          );
        })}
      </div>
      {(caption || screenshot.truncated) && (
        <figcaption className="text-[11px] text-[#71717a]">
          {caption}
          {screenshot.truncated && ` · Screenshot shows the first ${screenshot.height}px of ${screenshot.fullHeight}px.`}
          {placeable.length < findings.length && ` · ${findings.length - placeable.length} finding(s) below the captured area.`}
        </figcaption>
      )}
    </figure>
  );
}
