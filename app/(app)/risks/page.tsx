"use client";
import { useState, useEffect } from "react";
import { Loader2, AlertTriangle, AlertCircle, Info, Sparkles, GitFork } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

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

interface RiskInsight {
  title: string;
  description: string;
  action: string;
}

interface InsightsData {
  insights:   RiskInsight[];
  summary:    string | null;
  pattern:    string | null;
  risk_count: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

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
  high:   { label: "High",   cls: "text-red-500 bg-red-50",       icon: <AlertTriangle size={12} /> },
  medium: { label: "Medium", cls: "text-orange-500 bg-orange-50", icon: <AlertCircle size={12} /> },
  low:    { label: "Low",    cls: "text-blue-500 bg-blue-50",     icon: <Info size={12} /> },
};

// ─── AI Insights panel ────────────────────────────────────────────────────────

function InsightsSkeleton() {
  return (
    <div className="rounded-panel border border-border bg-paper p-4 space-y-3">
      <div className="flex items-center gap-2 mb-2">
        <div className="skeleton h-4 w-4 rounded" />
        <div className="skeleton h-4 w-32 rounded" />
      </div>
      <div className="skeleton h-3 w-full rounded" />
      <div className="skeleton h-3 w-5/6 rounded" />
      <div className="skeleton h-3 w-2/3 rounded" />
    </div>
  );
}

function InsightsPanel({ data }: { data: InsightsData }) {
  if (!data.summary && !data.insights.length) return null;

  return (
    <div className="rounded-panel border border-border bg-paper p-4 space-y-4 mb-5">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Sparkles size={15} className="text-violet-500 shrink-0" />
        <span className="text-body font-semibold text-ink">AI Risk Analysis</span>
        {data.risk_count > 0 && (
          <span className="ml-auto text-caption text-muted">{data.risk_count} active risk{data.risk_count !== 1 ? "s" : ""}</span>
        )}
      </div>

      {/* Summary */}
      {data.summary && (
        <p className="text-body text-ink leading-relaxed">{data.summary}</p>
      )}

      {/* Pattern */}
      {data.pattern && (
        <div className="flex items-start gap-2 text-body text-muted italic">
          <GitFork size={13} className="shrink-0 mt-0.5 not-italic text-muted/60" />
          <span>{data.pattern}</span>
        </div>
      )}

      {/* Top risks */}
      {data.insights.length > 0 && (
        <div className="space-y-3">
          {data.insights.map((insight, i) => (
            <div key={i} className="rounded-lg border border-border bg-surface p-3 space-y-1">
              <p className="text-body font-semibold text-ink">{insight.title}</p>
              <p className="text-caption text-muted leading-snug">{insight.description}</p>
              <div className="flex items-center gap-1.5 pt-0.5">
                <span className="text-[10px] text-blue-600 bg-blue-50 border border-blue-100 font-semibold px-2 py-0.5 rounded-full">
                  → {insight.action}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function RisksPage() {
  const [items,    setItems]    = useState<FeedbackItem[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [insights, setInsights] = useState<InsightsData | null>(null);
  const [insightsLoading, setInsightsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    Promise.all([
      fetch("/api/feedback").then(r => r.json()),
      fetch("/api/risks/insights").then(r => r.json()),
    ]).then(([feedbackData, insightsData]: [{ items?: FeedbackItem[] }, InsightsData]) => {
      if (cancelled) return;
      setItems(feedbackData.items ?? []);
      setInsights(insightsData);
      setLoading(false);
      setInsightsLoading(false);
    }).catch(() => {
      if (!cancelled) {
        setLoading(false);
        setInsightsLoading(false);
      }
    });

    return () => { cancelled = true; };
  }, []);

  const risks = items.filter(i =>
    i.ai_risk_flag ||
    i.ai_classification === "Risk" ||
    i.ai_classification === "Blocked" ||
    isStalled(i)
  );

  const high   = risks.filter(i => i.priority === "high" || i.ai_classification === "Blocked");
  const medium = risks.filter(i => i.priority === "medium" && i.ai_classification !== "Blocked");
  const low    = risks.filter(i => !["high", "medium"].includes(i.priority) && i.ai_classification !== "Blocked");

  const groups = [
    { label: "High",   color: "text-red-500",    bg: "bg-red-50 border-red-100",       items: high   },
    { label: "Medium", color: "text-orange-500", bg: "bg-orange-50 border-orange-100", items: medium },
    { label: "Low",    color: "text-blue-500",   bg: "bg-blue-50 border-blue-100",     items: low    },
  ];

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-paper">
      <div className="px-6 pt-6 pb-5 border-b border-border shrink-0">
        <div className="flex items-center gap-2 mb-1">
          <AlertTriangle size={18} className="text-muted shrink-0" />
          <h1 className="text-title font-semibold text-ink">Risks</h1>
        </div>
        <p className="text-body text-muted">Flagged, blocked, and stalled items that need attention</p>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-5">
        {loading ? (
          <div className="space-y-5">
            <InsightsSkeleton />
            <div className="flex items-center justify-center p-8 text-muted">
              <Loader2 size={18} className="animate-spin mr-2" /> Loading…
            </div>
          </div>
        ) : (
          <>
            {/* AI Insights panel — only if risks exist */}
            {risks.length > 0 && (
              insightsLoading
                ? <InsightsSkeleton />
                : insights && <InsightsPanel data={insights} />
            )}

            {/* Risk items */}
            {risks.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-24 gap-3 text-center rounded-panel border border-border bg-surface">
                <AlertTriangle size={32} className="text-wash" />
                <p className="text-lead font-medium text-ink">No risks detected</p>
                <p className="text-body text-muted">Risk-flagged items will appear here</p>
              </div>
            ) : (
              <div className="space-y-6">
                {groups.filter(g => g.items.length > 0).map(group => (
                  <div key={group.label}>
                    <div className="flex items-center gap-2 mb-3">
                      <span className={`text-[10px] font-bold uppercase tracking-wider ${group.color}`}>{group.label}</span>
                      <span className="text-caption text-muted">{group.items.length} item{group.items.length !== 1 ? "s" : ""}</span>
                    </div>
                    <div className="space-y-2">
                      {group.items.map(item => {
                        const stalled = isStalled(item);
                        const authorInitial = (item.figma_comment?.author_name ?? "?")[0]?.toUpperCase();
                        return (
                          <div key={item.id} className="rounded-panel border border-border bg-paper p-4">
                            <div className="flex items-start justify-between gap-4">
                              <div className="flex-1 min-w-0">
                                {/* Badges */}
                                <div className="flex items-center gap-1.5 mb-2 flex-wrap">
                                  {item.ai_classification === "Blocked" && (
                                    <span className="text-[10px] font-bold text-red-500 bg-red-50 px-1.5 py-0.5 rounded border border-red-100">BLOCKED</span>
                                  )}
                                  {item.ai_risk_flag && item.ai_classification !== "Blocked" && (
                                    <span className="text-[10px] font-bold text-orange-500 bg-orange-50 px-1.5 py-0.5 rounded border border-orange-100">RISK</span>
                                  )}
                                  {stalled && (
                                    <span className="text-[10px] font-bold text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-100">STALLED</span>
                                  )}
                                  {item.status === "resolved" && (
                                    <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-100">RESOLVED</span>
                                  )}
                                </div>

                                <p className="text-body font-semibold text-ink leading-snug mb-1.5">
                                  {item.ai_key_question ?? item.figma_comment?.raw_content ?? "—"}
                                </p>

                                {item.ai_summary && (
                                  <p className="text-caption text-muted leading-relaxed mb-3 line-clamp-2">{item.ai_summary}</p>
                                )}

                                <div className="flex items-center gap-2 flex-wrap">
                                  <div className="w-5 h-5 rounded-full bg-surface border border-border flex items-center justify-center shrink-0">
                                    <span className="text-muted font-bold" style={{ fontSize: 9 }}>{authorInitial}</span>
                                  </div>
                                  <span className="text-caption text-muted">{item.figma_comment?.author_name}</span>
                                  <span className="text-wash">·</span>
                                  <span className="text-caption text-muted">{timeAgo(item.created_at)}</span>
                                  <span className="text-wash">·</span>
                                  <span className="text-caption text-muted">{item.project?.name ?? ""}</span>
                                </div>
                              </div>

                              {/* Priority badge */}
                              {(() => {
                                const p = priorityConfig[item.priority as keyof typeof priorityConfig] ?? priorityConfig.low;
                                return (
                                  <span className={`inline-flex items-center gap-1.5 text-[11px] font-semibold px-2 py-0.5 rounded shrink-0 ${p.cls}`}>
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
          </>
        )}
      </div>
    </div>
  );
}
