"use client";

import { useEffect, useState } from "react";
import { ScanSearch, Palette, Accessibility, MonitorCheck, Globe2 } from "lucide-react";

interface Row {
  el: string;
  type: string;
  bg: string;
  c: string;
  issue: string;
}

interface Card {
  badge: string;
  badgeBg: string;
  badgeColor: string;
  headline: string;
  detail: string;
  location: string;
}

interface Device {
  label: string;
  w: number;
  h: number;
}

interface TableScene {
  kind: "table";
  icon: typeof ScanSearch;
  label: string;
  badge: string;
  steps: string[];
  summaryTitle: string;
  summarySub: string;
  rows: Row[];
}

interface CardScene {
  kind: "cards";
  icon: typeof ScanSearch;
  label: string;
  badge: string;
  steps: string[];
  cards: Card[];
}

interface DeviceScene {
  kind: "devices";
  icon: typeof ScanSearch;
  label: string;
  badge: string;
  steps: string[];
  devices: Device[];
}

type Scene = TableScene | CardScene | DeviceScene;

const SCENES: Scene[] = [
  {
    kind: "table",
    icon: ScanSearch,
    label: "Figma vs Live",
    badge: "9 nodes · depth=5",
    steps: [
      "Extension captured 112 live styles from real Chrome.",
      "Snapshot loaded — 9 nodes. Zero Figma API calls.",
      "Matching Figma nodes to live elements…",
      "Sending to Groq AI — checking: missing elements, color…",
      "AI identified 8 discrepancies.",
    ],
    summaryTitle: "8 issues found",
    summarySub: "6 missing, 2 color",
    rows: [
      { el: "Solutions", type: "Missing Comps", bg: "#fef2f2", c: "#dc2626", issue: "Missing on live page" },
      { el: "Pricing", type: "Missing Comps", bg: "#fef2f2", c: "#dc2626", issue: "Missing on live page" },
      { el: "Book a demo", type: "Color", bg: "#fdf2f8", c: "#db2777", issue: "Figma: #030407 → #FCFCFD" },
    ],
  },
  {
    kind: "cards",
    icon: Palette,
    label: "Brand Check",
    badge: "6 colors · 3 fonts",
    steps: [
      "Loading brand guide — 6 colors, 3 fonts, spacing rules.",
      "Scanning the live page for colors, fonts, and spacing…",
      "Comparing every match against the brand guide…",
      "Found 5 mismatches.",
    ],
    cards: [
      { badge: "Font Family", badgeBg: "#f5f3ff", badgeColor: "#7c3aed", headline: "Hero heading", detail: "Inter → Söhne", location: "Where to inspect: Top of page" },
      { badge: "Color", badgeBg: "#fdf2f8", badgeColor: "#db2777", headline: "CTA button", detail: "#111827 → #0F0F13", location: "Where to inspect: Above the fold" },
    ],
  },
  {
    kind: "cards",
    icon: Accessibility,
    label: "Accessibility QA",
    badge: "WCAG AA",
    steps: [
      "Rendering the page in a headless browser…",
      "Walking 340 text nodes for contrast ratio…",
      "Checking labels, headings, and focus order…",
      "Found 4 WCAG issues.",
    ],
    cards: [
      { badge: "High · Contrast", badgeBg: "#fef2f2", badgeColor: "#dc2626", headline: "Text contrast is below the WCAG AA minimum", detail: "2.1:1 — needs 4.5:1", location: "Where to inspect: Hero CTA button" },
      { badge: "Medium · Missing label", badgeBg: "#fefce8", badgeColor: "#a16207", headline: "Input has no accessible name", detail: "No aria-label or <label>", location: "Where to inspect: Search bar" },
    ],
  },
  {
    kind: "devices",
    icon: MonitorCheck,
    label: "Responsive Check",
    badge: "acme.com",
    steps: [
      "Loading acme.com inside the device studio…",
      "Preset ready — iPhone 15 Pro (393 × 852)…",
      "Switching to iPad Pro (1024 × 1366)…",
      "Switching to MacBook Pro (1440 × 900)…",
    ],
    devices: [
      { label: "iPhone 15 Pro", w: 130, h: 230 },
      { label: "iPad Pro", w: 190, h: 220 },
      { label: "MacBook Pro", w: 240, h: 155 },
    ],
  },
];

const STEP_DELAY    = 900;   // ms between each step
const RESULT_DELAY  = 600;   // ms after last step before results appear
const ROW_DELAY     = 220;   // ms between each row/card appearing
const DEVICE_DELAY  = 900;   // ms between each device swap
const HOLD          = 3000;  // ms to hold final state before reset
const RESET_PAUSE   = 600;   // ms blank before next cycle

export function AnimatedPreview() {
  const [sceneIndex,   setSceneIndex]   = useState(0);
  const [visibleSteps, setVisibleSteps] = useState(0);
  const [showResults,  setShowResults]  = useState(false);
  const [visibleRows,  setVisibleRows]  = useState(0);
  const [deviceIndex,  setDeviceIndex]  = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      let scene = 0;

      while (!cancelled) {
        const current = SCENES[scene];

        setSceneIndex(scene);
        setVisibleSteps(0);
        setShowResults(false);
        setVisibleRows(0);
        setDeviceIndex(0);

        await delay(400);

        for (let i = 1; i <= current.steps.length; i++) {
          if (cancelled) return;
          setVisibleSteps(i);
          await delay(STEP_DELAY);
        }

        await delay(RESULT_DELAY);
        if (cancelled) return;
        setShowResults(true);

        if (current.kind === "table") {
          for (let i = 1; i <= current.rows.length; i++) {
            if (cancelled) return;
            await delay(ROW_DELAY);
            setVisibleRows(i);
          }
        } else if (current.kind === "cards") {
          for (let i = 1; i <= current.cards.length; i++) {
            if (cancelled) return;
            await delay(ROW_DELAY);
            setVisibleRows(i);
          }
        } else {
          for (let i = 0; i < current.devices.length; i++) {
            if (cancelled) return;
            setDeviceIndex(i);
            await delay(DEVICE_DELAY);
          }
        }

        await delay(HOLD);
        if (cancelled) return;

        setVisibleSteps(0);
        setShowResults(false);
        setVisibleRows(0);
        await delay(RESET_PAUSE);

        scene = (scene + 1) % SCENES.length;
      }
    }

    run();
    return () => { cancelled = true; };
  }, []);

  const scene = SCENES[sceneIndex];
  const Icon = scene.icon;

  return (
    <div className="rounded-2xl border border-[#e8e8ec] bg-[#fafafa] overflow-hidden shadow-sm">
      {/* Title bar */}
      <div className="border-b border-[#f0f0f0] bg-white px-5 h-[45px] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon size={13} className="text-[#71717a]" />
          <span className="text-[13px] font-medium text-[#17171c]">{scene.label}</span>
          <span className="rounded-full bg-[#f0f0f0] px-2 py-0.5 text-[10px] font-medium text-[#71717a]">Design QA</span>
        </div>
        <span className="rounded-full bg-[#e8f6ee] px-2.5 py-1 text-[11px] font-medium text-[#1a9457]">{scene.badge}</span>
      </div>

      {/* Scene dots */}
      <div className="flex items-center justify-center gap-1.5 border-b border-[#f0f0f0] bg-white py-2">
        {SCENES.map((s, i) => (
          <span
            key={s.label}
            className="h-1.5 rounded-full transition-all duration-300"
            style={{
              width: i === sceneIndex ? 16 : 6,
              backgroundColor: i === sceneIndex ? "#a855f7" : "#e4e4e7",
            }}
          />
        ))}
      </div>

      <div className="flex min-h-[280px]">
        {/* Steps panel */}
        <div className="w-[38%] border-r border-[#f0f0f0] px-5 py-4">
          <p className="text-[9px] font-semibold uppercase tracking-widest text-[#d0d0d8] mb-3">Steps</p>
          <div className="space-y-2">
            {scene.steps.map((text, i) => (
              <div
                key={i}
                style={{
                  opacity:    visibleSteps > i ? 1 : 0,
                  transform:  visibleSteps > i ? "translateY(0)" : "translateY(6px)",
                  transition: "opacity 0.35s ease, transform 0.35s ease",
                }}
                className="flex items-start gap-2 text-[11px] text-[#71717a]"
              >
                <span
                  style={{
                    color: i === visibleSteps - 1 && visibleSteps < scene.steps.length
                      ? "#a855f7"
                      : "#d0d0d8",
                    transition: "color 0.3s",
                  }}
                  className="shrink-0 mt-0.5"
                >
                  ›
                </span>
                {text}
              </div>
            ))}
          </div>
        </div>

        {/* Results panel */}
        <div
          className="flex-1 px-5 py-4"
          style={{
            opacity:    showResults ? 1 : 0,
            transform:  showResults ? "translateY(0)" : "translateY(10px)",
            transition: "opacity 0.45s ease, transform 0.45s ease",
          }}
        >
          {scene.kind === "table" && (
            <>
              <div className="rounded-xl border border-orange-100 bg-orange-50 px-4 py-3 mb-4 flex items-center gap-3">
                <div className="h-4 w-4 rounded-full border-2 border-orange-400 flex items-center justify-center shrink-0">
                  <div className="h-1.5 w-1.5 rounded-full bg-orange-400" />
                </div>
                <div>
                  <p className="text-[13px] font-semibold text-orange-800">{scene.summaryTitle}</p>
                  <p className="text-[11px] text-orange-600">{scene.summarySub}</p>
                </div>
              </div>

              <div className="rounded-xl border border-[#f0f0f0] overflow-hidden">
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="bg-[#fafafa] border-b border-[#f0f0f0]">
                      <th className="px-3 py-2 text-left text-[#71717a] font-medium">#</th>
                      <th className="px-3 py-2 text-left text-[#71717a] font-medium">Element</th>
                      <th className="px-3 py-2 text-left text-[#71717a] font-medium">Type</th>
                      <th className="px-3 py-2 text-left text-[#71717a] font-medium">Issue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {scene.rows.map((row, i) => (
                      <tr
                        key={i}
                        className="border-b border-[#f7f7f8] last:border-0"
                        style={{
                          opacity:    visibleRows > i ? 1 : 0,
                          transform:  visibleRows > i ? "translateY(0)" : "translateY(4px)",
                          transition: "opacity 0.3s ease, transform 0.3s ease",
                        }}
                      >
                        <td className="px-3 py-2 text-[#a1a1aa]">{i + 1}</td>
                        <td className="px-3 py-2 font-semibold text-[#17171c]">{row.el}</td>
                        <td className="px-3 py-2">
                          <span style={{ backgroundColor: row.bg, color: row.c }} className="rounded-full px-2 py-0.5 text-[10px] font-medium">
                            {row.type}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-[#3f3f46]">{row.issue}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {scene.kind === "cards" && (
            <div className="space-y-2.5">
              {scene.cards.map((card, i) => (
                <div
                  key={card.headline}
                  className="rounded-xl border border-[#f0f0f0] bg-white px-3.5 py-3"
                  style={{
                    opacity:    visibleRows > i ? 1 : 0,
                    transform:  visibleRows > i ? "translateY(0)" : "translateY(4px)",
                    transition: "opacity 0.3s ease, transform 0.3s ease",
                  }}
                >
                  <div className="mb-1.5 flex items-center gap-1.5">
                    <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-[#0f0f0f] px-1 text-[9px] font-bold text-white">{i + 1}</span>
                    <span style={{ backgroundColor: card.badgeBg, color: card.badgeColor }} className="rounded-full px-2 py-0.5 text-[9px] font-semibold">
                      {card.badge}
                    </span>
                  </div>
                  <p className="text-[12px] font-semibold text-[#17171c]">{card.headline}</p>
                  <p className="mt-0.5 font-mono text-[11px] text-[#3f3f46]">{card.detail}</p>
                  <p className="mt-1 text-[10px] text-[#a1a1aa]">{card.location}</p>
                </div>
              ))}
            </div>
          )}

          {scene.kind === "devices" && (
            <div className="relative flex h-[220px] items-center justify-center rounded-xl bg-[#242426] overflow-hidden">
              <span className="absolute right-3 top-3 rounded-lg bg-black/60 px-2.5 py-1 font-mono text-[10px] font-semibold text-white/75">
                {scene.devices[deviceIndex].label}
              </span>
              {scene.devices.map((d, i) => (
                <div
                  key={d.label}
                  className="absolute overflow-hidden rounded-[10px] bg-white shadow-[0_12px_40px_rgba(0,0,0,0.35)]"
                  style={{
                    width: d.w,
                    height: d.h,
                    opacity: deviceIndex === i ? 1 : 0,
                    transform: `scale(${deviceIndex === i ? 1 : 0.92})`,
                    transition: "opacity 0.4s ease, transform 0.4s ease",
                  }}
                >
                  <div className="flex h-5 items-center gap-1 border-b border-black/[0.06] bg-[#f5f5f7] px-2">
                    <Globe2 size={8} className="text-[#a1a1aa]" />
                    <span className="text-[7px] font-medium text-[#a1a1aa]">acme.com</span>
                  </div>
                  <div className="space-y-1.5 p-2.5">
                    <div className="h-2 w-3/4 rounded bg-[#ececf0]" />
                    <div className="h-1.5 w-full rounded bg-[#f2f2f4]" />
                    <div className="h-1.5 w-5/6 rounded bg-[#f2f2f4]" />
                    <div className="mt-2 h-6 w-1/2 rounded bg-[#e4e4e7]" />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function delay(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}
