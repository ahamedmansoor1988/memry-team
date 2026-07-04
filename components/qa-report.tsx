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

/**
 * A viewport-sized crop of the stitched page screenshot, scrolled so the
 * finding is centered, with the offending element outlined and numbered.
 * Uses translateY(%) (relative to the image's own height) so the crop is
 * responsive without measuring the rendered size.
 */
export function FocusedIssueView({ screenshot, finding, cropHeight = 520 }: {
  screenshot: Screenshot;
  finding: AnnotatedFinding;
  cropHeight?: number;
}) {
  const y = finding.y ?? 0;
  const boxH = Math.max(finding.height ?? 32, 18);
  const boxW = Math.max(finding.width ?? 32, 18);
  const crop = Math.min(cropHeight, screenshot.height);
  // Center the finding in the crop window, clamped to the image bounds.
  const offsetY = Math.max(0, Math.min(y + boxH / 2 - crop / 2, screenshot.height - crop));
  const color = BOX_COLORS[finding.severity];

  if (typeof finding.y !== "number" || finding.y >= screenshot.height) return null;

  return (
    <div
      className="relative w-full overflow-hidden rounded-lg border border-black/[0.08]"
      style={{ paddingTop: `${(crop / screenshot.width) * 100}%` }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={screenshot.dataUrl}
        alt={`Issue ${finding.index} in context`}
        className="absolute left-0 top-0 w-full"
        style={{ transform: `translateY(-${(offsetY / screenshot.height) * 100}%)` }}
      />
      <div
        className="absolute rounded-sm"
        style={{
          left: `${((finding.x ?? 0) / screenshot.width) * 100}%`,
          top: `${((y - offsetY) / crop) * 100}%`,
          width: `${Math.min((boxW / screenshot.width) * 100, 100)}%`,
          height: `${(boxH / crop) * 100}%`,
          border: `2px solid ${color}`,
          background: `${color}1a`,
          boxShadow: "0 0 0 1px #ffffffaa",
        }}
      >
        <span
          className="absolute -left-1 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] font-bold text-white"
          style={{ background: color }}
        >
          {finding.index}
        </span>
      </div>
    </div>
  );
}

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
export function AnnotatedScreenshot({ screenshot, findings, caption, onBoxClick }: {
  screenshot: Screenshot;
  findings: AnnotatedFinding[];
  caption?: string;
  onBoxClick?: (id: string) => void;
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
              onClick={() => onBoxClick?.(f.id)}
              title={onBoxClick ? `Jump to issue ${f.index}` : undefined}
              className={`absolute rounded-sm ${onBoxClick ? "cursor-pointer" : ""}`}
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
