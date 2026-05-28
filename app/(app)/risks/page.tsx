"use client";
import { useState, useEffect } from "react";
import { Loader2, AlertTriangle, AlertCircle, Info } from "lucide-react";

interface FeedbackItem {
  id: string; status: string; priority: string;
  ai_summary: string | null; ai_classification: string | null;
  ai_key_question: string | null; ai_tags: string[] | null;
  ai_risk_flag: boolean; ai_vague_flag: boolean;
  created_at: string;
  figma_comment: {
    author_name: string; raw_content: string; figma_created_at: string;
    figma_file: { id: string; name: string; figma_file_key: string } | null;
  } | null;
  project: { id: string; name: string } | null;
}

function timeAgo(date: string): string {
  const diff = Date.now() - new Date(date).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function isStalled(item: FeedbackItem): boolean {
  if (item.status === "resolved" || item.status === "dismissed") return false;
  return Date.now() - new Date(item.created_at).getTime() > 48 * 60 * 60 * 1000;
}

const priorityConfig = {
  high:   { label: "High",   cls: "text-red-500 bg-red-50",    icon: <AlertTriangle size={12} /> },
  medium: { label: "Medium", cls: "text-orange-500 bg-orange-50", icon: <AlertCircle size={12} /> },
  low:    { label: "Low",    cls: "text-blue-500 bg-blue-50",   icon: <Info size={12} /> },
};

export default function RisksPage() {
  const [items, setItems] = useState<FeedbackItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/feedback")
      .then(r => r.json())
      .then((d: { items?: FeedbackItem[] }) => {
        setItems(d.items ?? []);
        setLoading(false);
      });
  }, []);

  const risks = items.filter(i =>
    i.ai_risk_flag ||
    i.ai_classification === "Risk" ||
    i.ai_classification === "Blocked" ||
    isStalled(i)
  );

  const high   = risks.filter(i => i.priority === "high" || i.ai_classification === "Blocked");
  const medium = risks.filter(i => i.priority === "medium" && i.ai_classification !== "Blocked");
  const low    = risks.filter(i => !["high","medium"].includes(i.priority) && i.ai_classification !== "Blocked");

  const groups = [
    { label: "High", color: "text-red-500", bg: "bg-red-50 border-red-100", items: high },
    { label: "Medium", color: "text-orange-500", bg: "bg-orange-50 border-orange-100", items: medium },
    { label: "Low", color: "text-blue-500", bg: "bg-blue-50 border-blue-100", items: low },
  ];

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-[#f5f5f7]">
      <div className="px-8 pt-7 pb-5">
        <div className="flex items-center justify-between mb-1">
          <h1 className="text-gray-900 text-2xl font-bold tracking-tight">Risks</h1>
        </div>
        <p className="text-gray-400 text-sm">Flagged, blocked, and stalled items that need attention</p>
      </div>

      <div className="flex-1 overflow-y-auto px-8 pb-8">
        {loading ? (
          <div className="flex items-center justify-center p-12 text-gray-400">
            <Loader2 size={18} className="animate-spin mr-2" /> Loading…
          </div>
        ) : risks.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-16 text-center bg-white rounded-2xl border border-gray-100">
            <AlertTriangle size={36} className="text-gray-200 mb-3" />
            <p className="text-gray-400 text-sm font-medium">No risks detected</p>
            <p className="text-gray-300 text-xs mt-1">Risk-flagged items will appear here</p>
          </div>
        ) : (
          <div className="space-y-6">
            {groups.filter(g => g.items.length > 0).map(group => (
              <div key={group.label}>
                <div className="flex items-center gap-2 mb-3">
                  <span className={`text-xs font-bold uppercase tracking-wider ${group.color}`}>{group.label}</span>
                  <span className="text-gray-300 text-xs">{group.items.length} item{group.items.length !== 1 ? "s" : ""}</span>
                </div>
                <div className="space-y-2">
                  {group.items.map(item => {
                    const stalled = isStalled(item);
                    const authorInitial = (item.figma_comment?.author_name ?? "?")[0]?.toUpperCase();
                    return (
                      <div key={item.id} className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1 min-w-0">
                            {/* Badges */}
                            <div className="flex items-center gap-2 mb-2 flex-wrap">
                              {item.ai_classification === "Blocked" && (
                                <span className="text-[10px] font-bold text-red-500 bg-red-50 px-2 py-0.5 rounded-full">BLOCKED</span>
                              )}
                              {item.ai_risk_flag && item.ai_classification !== "Blocked" && (
                                <span className="text-[10px] font-bold text-orange-500 bg-orange-50 px-2 py-0.5 rounded-full">RISK FLAGGED</span>
                              )}
                              {stalled && (
                                <span className="text-[10px] font-bold text-yellow-600 bg-yellow-50 px-2 py-0.5 rounded-full">STALLED</span>
                              )}
                              {item.status === "resolved" && (
                                <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">RESOLVED</span>
                              )}
                            </div>

                            <p className="text-gray-900 text-sm font-semibold leading-snug mb-1.5">
                              {item.ai_key_question ?? item.figma_comment?.raw_content ?? "—"}
                            </p>

                            {item.ai_summary && (
                              <p className="text-gray-500 text-xs leading-relaxed mb-3 line-clamp-2">{item.ai_summary}</p>
                            )}

                            <div className="flex items-center gap-2">
                              <div className="w-5 h-5 rounded-full bg-gray-200 flex items-center justify-center flex-shrink-0">
                                <span className="text-gray-600 font-bold" style={{ fontSize: 9 }}>{authorInitial}</span>
                              </div>
                              <span className="text-gray-500 text-xs">{item.figma_comment?.author_name}</span>
                              <span className="text-gray-300 text-xs">·</span>
                              <span className="text-gray-400 text-xs">{timeAgo(item.created_at)}</span>
                              <span className="text-gray-300 text-xs">·</span>
                              <span className="text-gray-400 text-xs">{item.project?.name ?? ""}</span>
                            </div>
                          </div>

                          {/* Priority badge */}
                          {(() => {
                            const p = priorityConfig[item.priority as keyof typeof priorityConfig] ?? priorityConfig.low;
                            return (
                              <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full flex-shrink-0 ${p.cls}`}>
                                {p.icon} {p.label}
                              </span>
                            );
                          })()}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
