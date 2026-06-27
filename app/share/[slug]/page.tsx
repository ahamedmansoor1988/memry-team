"use client";

import React, { useEffect, useState } from "react";
import { ExternalLink, AlertCircle } from "lucide-react";
import { useParams } from "next/navigation";

interface Issue {
  id: string;
  element: string;
  category: string;
  issue: string;
  severity: string;
}

const categoryColors: Record<string, { bg: string; text: string; label: string }> = {
  missing_elements: { bg: "#fef2f2", text: "#dc2626", label: "Missing"     },
  font_family:      { bg: "#faf5ff", text: "#9333ea", label: "Font Family" },
  font_size:        { bg: "#eff6ff", text: "#2563eb", label: "Font Size"   },
  font_weight:      { bg: "#fffbeb", text: "#d97706", label: "Font Weight" },
  color:            { bg: "#fdf2f8", text: "#db2777", label: "Color"       },
};

function IssueDiff({ issue }: { issue: string }) {
  const m = issue.match(/Figma:\s*(.+?)\s*—\s*Live:\s*(.+)/);
  if (!m) return <span className="text-[#5b5b66]">{issue}</span>;
  return (
    <span className="flex items-center gap-1.5 flex-wrap">
      <span className="rounded px-1.5 py-0.5 bg-[#f0f0f0] text-[#17171c] font-mono text-[10px]">{m[1]}</span>
      <span className="text-[#c8c8d0] text-[10px]">→</span>
      <span className="rounded px-1.5 py-0.5 bg-[#fff0f0] text-red-600 font-mono text-[10px]">{m[2]}</span>
    </span>
  );
}

export default function SharePage() {
  const params = useParams();
  const slug = params.slug as string;
  const [data, setData] = useState<{ live_url: string; scanned_at: string; issues: Issue[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/share?slug=${encodeURIComponent(slug)}`)
      .then(r => r.json())
      .then(d => { if (d.error) setError(d.error); else setData(d); })
      .catch(() => setError("Failed to load"));
  }, [slug]);

  const date = data ? new Date(data.scanned_at).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) : "";
  const time = data ? new Date(data.scanned_at).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }) : "";
  const highCount = data?.issues.filter(i => i.severity === "high" || i.category === "missing_elements").length ?? 0;

  return (
    <div className="min-h-screen bg-[#fafafa] font-sans">
      {/* Header */}
      <div className="border-b border-[#f0f0f0] bg-white px-6 py-4 flex items-center gap-3">
        <img src="/loupe.svg" alt="Loupe" className="h-7 w-auto" />
        
        <span className="text-[#e0e0e6] text-[14px]">/</span>
        <span className="text-[13px] text-[#9a9aa5]">Shared QA Report</span>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-8 space-y-5">
        {!data && !error && (
          <div className="text-center py-16 text-[13px] text-[#9a9aa5]">Loading report…</div>
        )}

        {error && (
          <div className="flex items-center gap-3 rounded-2xl border border-red-100 bg-red-50 px-5 py-4">
            <AlertCircle size={14} className="text-red-500 shrink-0" />
            <p className="text-[13px] text-red-600">{error === "invalid slug" ? "This share link is invalid or expired." : error}</p>
          </div>
        )}

        {data && (
          <>
            {/* Run meta */}
            <div className="rounded-2xl border border-[#f0f0f0] bg-white px-5 py-4 flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <a href={data.live_url} target="_blank" rel="noopener noreferrer"
                    className="text-[14px] font-semibold text-[#17171c] hover:underline flex items-center gap-1.5">
                    {data.live_url}<ExternalLink size={12} className="text-[#9a9aa5]" />
                  </a>
                </div>
                <p className="text-[12px] text-[#9a9aa5]">Scanned {date} at {time}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {highCount > 0 && (
                  <span className="rounded-full px-2.5 py-1 text-[11px] font-medium" style={{ backgroundColor: "#fef2f2", color: "#dc2626" }}>
                    {highCount} high
                  </span>
                )}
                <span className="rounded-full bg-[#f0f0f0] px-2.5 py-1 text-[11px] font-medium text-[#5b5b66]">
                  {data.issues.length} issues
                </span>
              </div>
            </div>

            {data.issues.length === 0 ? (
              <div className="text-center py-10 text-[13px] text-[#9a9aa5]">No issues found in this run.</div>
            ) : (
              <div className="rounded-2xl border border-[#f0f0f0] bg-white overflow-hidden">
                <table className="w-full text-[12px]">
                  <thead>
                    <tr className="bg-[#fafafa] border-b border-[#f0f0f0]">
                      <th className="px-4 py-3 text-left font-medium text-[#9a9aa5] w-8">#</th>
                      <th className="px-4 py-3 text-left font-medium text-[#9a9aa5]">Element</th>
                      <th className="px-4 py-3 text-left font-medium text-[#9a9aa5]">Type</th>
                      <th className="px-4 py-3 text-left font-medium text-[#9a9aa5]">Issue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.issues.map((issue, i) => {
                      const cat = categoryColors[issue.category] ?? { bg: "#f5f5f5", text: "#666", label: issue.category };
                      const isHigh = issue.severity === "high" || issue.category === "missing_elements";
                      return (
                        <tr key={issue.id} style={isHigh ? { backgroundColor: "#fff8f8" } : {}} className="border-b border-[#f7f7f8] last:border-0">
                          <td className="px-4 py-3 text-[#c8c8d0]">{i + 1}</td>
                          <td className="px-4 py-3 font-semibold text-[#17171c]">{issue.element}</td>
                          <td className="px-4 py-3">
                            <span style={{ backgroundColor: cat.bg, color: cat.text }} className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium">
                              {cat.label || issue.category.replace(/_/g, " ")}
                            </span>
                          </td>
                          <td className="px-4 py-3"><IssueDiff issue={issue.issue} /></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
