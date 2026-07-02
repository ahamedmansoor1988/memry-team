"use client";

import React, { useEffect, useState } from "react";
import { History, ExternalLink, ChevronDown, ChevronRight, Link2, Check } from "lucide-react";

interface Issue {
  id: string;
  element: string;
  category: string;
  issue: string;
  severity: string;
  scanned_at: string;
}

interface Run {
  live_url: string;
  scanned_at: string;
  issues: Issue[];
}

const categoryColors: Record<string, { bg: string; text: string; label: string }> = {
  missing_elements: { bg: "#fef2f2", text: "#dc2626", label: "Missing"     },
  font_family:      { bg: "#faf5ff", text: "#9333ea", label: "Font Family" },
  font_size:        { bg: "#eff6ff", text: "#2563eb", label: "Font Size"   },
  font_weight:      { bg: "#fffbeb", text: "#d97706", label: "Font Weight" },
  color:            { bg: "#fdf2f8", text: "#db2777", label: "Color"       },
  content:          { bg: "#f0fdf4", text: "#16a34a", label: "Content"     },
  spacing:          { bg: "#ecfeff", text: "#0891b2", label: "Spacing"     },
};

function IssueDiff({ issue }: { issue: string }) {
  const m = issue.match(/Figma:\s*(.+?)\s*—\s*Live:\s*(.+)/);
  if (!m) return <span className="text-[#3f3f46]">{issue}</span>;
  return (
    <span className="flex items-center gap-1.5 flex-wrap">
      <span className="rounded px-1.5 py-0.5 bg-[#f0f0f0] text-[#17171c] font-mono text-[10px]">{m[1]}</span>
      <span className="text-[#a1a1aa] text-[10px]">→</span>
      <span className="rounded px-1.5 py-0.5 bg-[#fff0f0] text-red-600 font-mono text-[10px]">{m[2]}</span>
    </span>
  );
}

function makeShareSlug(liveUrl: string, scannedAt: string) {
  const minute = scannedAt.slice(0, 16); // "2025-06-27T12:34"
  const raw    = `${liveUrl}||${minute}`;
  return btoa(raw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

export default function HistoryPage() {
  const [runs, setRuns]       = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [copied, setCopied]     = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/history")
      .then(r => r.json())
      .then(data => { setRuns(data.runs ?? []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  function toggle(key: string) {
    setExpanded(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });
  }

  function copyShareLink(run: Run, key: string) {
    const slug = makeShareSlug(run.live_url, run.scanned_at);
    const url  = `${window.location.origin}/share/${slug}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(key);
      setTimeout(() => setCopied(null), 2000);
    });
  }

  if (loading) return (
    <div className="flex h-full items-center justify-center text-[13px] text-[#71717a]">Loading history…</div>
  );

  if (!runs.length) return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
      <History size={32} className="text-[#e0e0e6]" />
      <p className="text-[14px] font-medium text-[#17171c]">No runs yet</p>
      <p className="text-[12px] text-[#71717a]">Run a Figma vs Live comparison to see history here.</p>
    </div>
  );

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      {/* Header */}
      <div className="border-b border-[#f0f0f0] px-6 h-[45px] flex items-center gap-3 shrink-0">
        <History size={16} className="text-[#71717a]" />
        <h1 className="text-[15px] font-semibold text-[#17171c]">History</h1>
        <span className="rounded-full bg-[#f0f0f0] px-2 py-0.5 text-[11px] font-medium text-[#3f3f46]">{runs.length} runs</span>
      </div>

      {/* Runs list */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
        {runs.map((run, i) => {
          const key = `${run.live_url}-${run.scanned_at}`;
          const isOpen = expanded.has(key);
          const date = new Date(run.scanned_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
          const time = new Date(run.scanned_at).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });

          return (
            <div key={key} className="rounded-2xl border border-[#f0f0f0] overflow-hidden">
              {/* Run header */}
              <button
                onClick={() => toggle(key)}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-[#fafafa] transition-colors text-left"
              >
                {isOpen ? <ChevronDown size={13} className="text-[#71717a] shrink-0" /> : <ChevronRight size={13} className="text-[#71717a] shrink-0" />}
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] font-medium text-[#17171c] truncate">{run.live_url}</p>
                  <p className="text-[11px] text-[#71717a] mt-0.5">{date} at {time}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="rounded-full bg-[#f0f0f0] px-2 py-0.5 text-[10px] font-medium text-[#3f3f46]">
                    {run.issues.length} {run.issues.length === 1 ? "issue" : "issues"}
                  </span>
                  <button
                    onClick={e => { e.stopPropagation(); copyShareLink(run, key); }}
                    className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-medium border transition-colors ${copied === key ? "border-emerald-200 bg-emerald-50 text-emerald-600" : "border-[#e8e8ec] text-[#71717a] hover:border-[#0f0f0f] hover:text-[#0f0f0f]"}`}
                  >
                    {copied === key ? <><Check size={10} />Copied!</> : <><Link2 size={10} />Share</>}
                  </button>
                  <a
                    href={run.live_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={e => e.stopPropagation()}
                    className="text-[#71717a] hover:text-[#3f3f46]"
                  >
                    <ExternalLink size={12} />
                  </a>
                </div>
              </button>

              {/* Issues table */}
              {isOpen && (
                <div className="border-t border-[#f0f0f0] overflow-x-auto">
                  {run.issues.length === 0 ? (
                    <div className="px-4 py-4 text-[12px] text-[#71717a]">No issues found in this run.</div>
                  ) : (
                  <table className="w-full text-[11px]">
                    <thead>
                      <tr className="bg-[#fafafa] border-b border-[#f0f0f0]">
                        <th className="px-4 py-2 text-left font-medium text-[#71717a] w-6">#</th>
                        <th className="px-4 py-2 text-left font-medium text-[#71717a]">Element</th>
                        <th className="px-4 py-2 text-left font-medium text-[#71717a]">Type</th>
                        <th className="px-4 py-2 text-left font-medium text-[#71717a]">Issue</th>
                      </tr>
                    </thead>
                    <tbody>
                      {run.issues.map((issue, j) => {
                        const cat = categoryColors[issue.category] ?? { bg: "#f5f5f5", text: "#666", label: issue.category };
                        const isHigh = issue.severity === "high" || issue.category === "missing_elements";
                        return (
                          <tr key={issue.id} style={isHigh ? { backgroundColor: "#fff8f8" } : {}} className="border-b border-[#f7f7f8] last:border-0">
                            <td className="px-4 py-2 text-[#a1a1aa]">{j + 1}</td>
                            <td className="px-4 py-2 font-semibold text-[#17171c]">{issue.element}</td>
                            <td className="px-4 py-2">
                              <span style={{ backgroundColor: cat.bg, color: cat.text }} className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium">
                                {cat.label || issue.category.replace(/_/g, " ")}
                              </span>
                            </td>
                            <td className="px-4 py-2"><IssueDiff issue={issue.issue} /></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
