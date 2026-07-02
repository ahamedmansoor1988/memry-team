"use client";

import { useEffect, useState } from "react";
import { ScanSearch } from "lucide-react";

const STEPS = [
  "Extension captured 112 live styles from real Chrome.",
  "Snapshot loaded — 9 nodes. Zero Figma API calls.",
  "Matching Figma nodes to live elements…",
  "Sending to Groq AI — checking: missing elements, color…",
  "AI identified 8 discrepancies.",
];

const ROWS = [
  { el: "Solutions",   type: "Missing Comps", bg: "#fef2f2", c: "#dc2626", issue: "Missing on live page" },
  { el: "Pricing",     type: "Missing Comps", bg: "#fef2f2", c: "#dc2626", issue: "Missing on live page" },
  { el: "Book a demo", type: "Color",   bg: "#fdf2f8", c: "#db2777", issue: "Figma: #030407 → #FCFCFD" },
];

const STEP_DELAY   = 900;   // ms between each step
const RESULT_DELAY = 600;   // ms after last step before results appear
const ROW_DELAY    = 180;   // ms between each row appearing
const HOLD         = 3000;  // ms to hold final state before reset
const RESET_PAUSE  = 600;   // ms blank before next cycle

export function AnimatedPreview() {
  const [visibleSteps, setVisibleSteps] = useState(0);
  const [showResults,  setShowResults]  = useState(false);
  const [visibleRows,  setVisibleRows]  = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      // reset
      setVisibleSteps(0);
      setShowResults(false);
      setVisibleRows(0);

      await delay(400);

      // reveal steps one by one
      for (let i = 1; i <= STEPS.length; i++) {
        if (cancelled) return;
        setVisibleSteps(i);
        await delay(STEP_DELAY);
      }

      await delay(RESULT_DELAY);
      if (cancelled) return;
      setShowResults(true);

      // reveal rows one by one
      for (let i = 1; i <= ROWS.length; i++) {
        if (cancelled) return;
        await delay(ROW_DELAY);
        setVisibleRows(i);
      }

      await delay(HOLD);
      if (cancelled) return;

      // fade out
      setVisibleSteps(0);
      setShowResults(false);
      setVisibleRows(0);
      await delay(RESET_PAUSE);
      if (!cancelled) run();
    }

    run();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="rounded-2xl border border-[#e8e8ec] bg-[#fafafa] overflow-hidden shadow-sm">
      {/* Title bar */}
      <div className="border-b border-[#f0f0f0] bg-white px-5 h-[45px] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ScanSearch size={13} className="text-[#71717a]" />
          <span className="text-[13px] font-medium text-[#17171c]">Figma vs Live</span>
          <span className="rounded-full bg-[#f0f0f0] px-2 py-0.5 text-[10px] font-medium text-[#71717a]">Design QA</span>
        </div>
        <span className="rounded-full bg-[#e8f6ee] px-2.5 py-1 text-[11px] font-medium text-[#1a9457]">9 nodes · depth=5</span>
      </div>

      <div className="flex min-h-[280px]">
        {/* Steps panel */}
        <div className="w-[38%] border-r border-[#f0f0f0] px-5 py-4">
          <p className="text-[9px] font-semibold uppercase tracking-widest text-[#d0d0d8] mb-3">Steps</p>
          <div className="space-y-2">
            {STEPS.map((text, i) => (
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
                    color: i === visibleSteps - 1 && visibleSteps < STEPS.length
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
          <div className="rounded-xl border border-orange-100 bg-orange-50 px-4 py-3 mb-4 flex items-center gap-3">
            <div className="h-4 w-4 rounded-full border-2 border-orange-400 flex items-center justify-center shrink-0">
              <div className="h-1.5 w-1.5 rounded-full bg-orange-400" />
            </div>
            <div>
              <p className="text-[13px] font-semibold text-orange-800">8 issues found</p>
              <p className="text-[11px] text-orange-600">6 missing, 2 color</p>
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
                {ROWS.map((row, i) => (
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
        </div>
      </div>
    </div>
  );
}

function delay(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}
