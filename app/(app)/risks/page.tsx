"use client";
import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, AlertCircle, Info, Sparkles, GitFork, ShieldAlert } from "lucide-react";

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

type Severity = "high" | "medium" | "low";
type FilterKey = "all" | Severity;

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

function severityOf(item: FeedbackItem): Severity {
  if (item.priority === "high" || item.ai_classification === "Blocked") return "high";
  if (item.priority === "medium") return "medium";
  return "low";
}

const SEVERITY_META: Record<Severity, {
  label: string; color: string; soft: string;
  Icon: typeof AlertTriangle;
}> = {
  high:   { label: "High",   color: "var(--red)",   soft: "var(--red-soft)",   Icon: AlertTriangle },
  medium: { label: "Medium", color: "var(--amber)", soft: "var(--amber-soft)", Icon: AlertCircle },
  low:    { label: "Low",    color: "var(--green)", soft: "var(--green-soft)", Icon: Info },
};

// ─── AI Insights panel ────────────────────────────────────────────────────────

function InsightsPanel({ data }: { data: InsightsData }) {
  if (!data.summary && !data.insights.length) return null;

  return (
    <div style={{
      background: "var(--surface)", border: "1px solid var(--border)",
      borderRadius: 12, boxShadow: "var(--shadow-1)", padding: 16, marginBottom: 16,
    }} className="space-y-3">
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Sparkles style={{ width: 14, height: 14, color: "var(--blue)", flexShrink: 0 }} />
        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>AI Risk Analysis</span>
        {data.risk_count > 0 && (
          <span style={{ marginLeft: "auto", fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-3)" }}>
            {data.risk_count} active
          </span>
        )}
      </div>

      {data.summary && (
        <p style={{ fontSize: 13, color: "var(--text)", lineHeight: 1.6 }}>{data.summary}</p>
      )}

      {data.pattern && (
        <div style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 12, color: "var(--text-2)", fontStyle: "italic" }}>
          <GitFork style={{ width: 12, height: 12, flexShrink: 0, marginTop: 3 }} />
          <span>{data.pattern}</span>
        </div>
      )}

      {data.insights.length > 0 && (
        <div className="space-y-2">
          {data.insights.map((insight, i) => (
            <div key={i} style={{ background: "var(--bg)", border: "1px solid var(--border-2)", borderRadius: 8, padding: "10px 12px" }}>
              <p style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text)" }}>{insight.title}</p>
              <p style={{ fontSize: 11.5, color: "var(--text-2)", marginTop: 2, lineHeight: 1.5 }}>{insight.description}</p>
              <span style={{
                display: "inline-block", marginTop: 6,
                fontSize: 10.5, fontWeight: 500, color: "var(--blue)",
                background: "var(--blue-soft)", borderRadius: 99, padding: "2px 9px",
              }}>
                → {insight.action}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Risk row ─────────────────────────────────────────────────────────────────

function RiskRow({ item }: { item: FeedbackItem }) {
  const router = useRouter();
  const sev  = severityOf(item);
  const meta = SEVERITY_META[sev];
  const { Icon } = meta;
  const stalled = isStalled(item);
  const href = item.project ? `/inbox/${item.project.id}/${item.id}` : "#";

  return (
    <div
      onClick={() => item.project && router.push(href)}
      style={{
        display: "flex", alignItems: "center", gap: 12,
        padding: "12px 16px",
        borderBottom: "1px solid var(--border-2)",
        background: "var(--surface)",
        cursor: item.project ? "pointer" : "default",
        transition: "background 0.1s",
      }}
      className="hover:!bg-[var(--accent-softer)] last:border-0"
    >
      {/* Severity icon tile */}
      <div style={{
        width: 32, height: 32, borderRadius: 8, flexShrink: 0,
        background: meta.soft, color: meta.color,
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <Icon style={{ width: 15, height: 15 }} />
      </div>

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: 13, fontWeight: 500, color: "var(--text)" }} className="truncate">
          {item.ai_key_question && item.ai_key_question !== "None"
            ? item.ai_key_question
            : item.ai_summary ?? item.figma_comment?.raw_content ?? "—"}
        </p>
        <p style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2 }} className="truncate">
          {item.project?.name ?? "No project"}
          {item.figma_comment?.author_name && <> · {item.figma_comment.author_name}</>}
          {item.ai_classification === "Blocked" && <> · Blocked</>}
          {stalled && <> · Stalled</>}
          <> · Detected {timeAgo(item.created_at)}</>
        </p>
      </div>

      {/* Severity pill */}
      <span style={{
        fontSize: 11, fontWeight: 500, whiteSpace: "nowrap", flexShrink: 0,
        background: meta.soft, color: meta.color,
        borderRadius: 99, padding: "3px 10px",
      }}>
        {meta.label}
      </span>
    </div>
  );
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function RowSkeleton() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", borderBottom: "1px solid var(--border-2)" }}>
      <div className="skeleton" style={{ width: 32, height: 32, borderRadius: 8, flexShrink: 0 }} />
      <div style={{ flex: 1 }}>
        <div className="skeleton" style={{ height: 13, width: "45%", borderRadius: 4, marginBottom: 6 }} />
        <div className="skeleton" style={{ height: 11, width: "30%", borderRadius: 4 }} />
      </div>
      <div className="skeleton" style={{ height: 22, width: 56, borderRadius: 99 }} />
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function RisksPage() {
  const [items,    setItems]    = useState<FeedbackItem[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [insights, setInsights] = useState<InsightsData | null>(null);
  const [filter,   setFilter]   = useState<FilterKey>("all");

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
    }).catch(() => {
      if (!cancelled) setLoading(false);
    });

    return () => { cancelled = true; };
  }, []);

  const risks = useMemo(() => items.filter(i =>
    i.ai_risk_flag ||
    i.ai_classification === "Risk" ||
    i.ai_classification === "Blocked" ||
    isStalled(i)
  ), [items]);

  const counts = useMemo(() => ({
    all:    risks.length,
    high:   risks.filter(r => severityOf(r) === "high").length,
    medium: risks.filter(r => severityOf(r) === "medium").length,
    low:    risks.filter(r => severityOf(r) === "low").length,
  }), [risks]);

  const filtered = useMemo(
    () => filter === "all" ? risks : risks.filter(r => severityOf(r) === filter),
    [risks, filter],
  );

  // Sort: high → medium → low, newest first within group
  const sorted = useMemo(() => {
    const rank: Record<Severity, number> = { high: 0, medium: 1, low: 2 };
    return [...filtered].sort((a, b) =>
      rank[severityOf(a)] - rank[severityOf(b)]
      || new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  }, [filtered]);

  const tabs: { key: FilterKey; label: string; count: number }[] = [
    { key: "all",    label: "All",    count: counts.all },
    { key: "high",   label: "High",   count: counts.high },
    { key: "medium", label: "Medium", count: counts.medium },
    { key: "low",    label: "Low",    count: counts.low },
  ];

  return (
    <div className="min-h-full" style={{ background: "var(--bg)" }}>
      <div className="px-7 pt-6 pb-10 max-w-4xl">

        {/* ── Header ── */}
        <div className="mb-5">
          <h1 style={{ fontSize: 20, fontWeight: 600, color: "var(--text)", letterSpacing: "-0.02em" }}>Risks</h1>
          <p style={{ fontSize: 13, color: "var(--text-2)", marginTop: 2 }}>
            Potential issues and blockers detected across your tools.
          </p>
        </div>

        {/* ── Severity tabs ── */}
        <div style={{ display: "flex", gap: 4, marginBottom: 12 }}>
          {tabs.map(t => {
            const active = filter === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setFilter(t.key)}
                style={{
                  display: "flex", alignItems: "center", gap: 6,
                  padding: "5px 12px", borderRadius: 99,
                  fontSize: 12, fontWeight: active ? 600 : 400,
                  background: active ? "var(--accent)" : "transparent",
                  color: active ? "var(--accent-ink)" : "var(--text-2)",
                  border: active ? "1px solid var(--accent)" : "1px solid var(--border)",
                  cursor: "pointer", transition: "all 0.1s",
                }}
              >
                {t.label}
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: active ? "var(--accent-ink)" : "var(--text-3)", opacity: active ? 0.8 : 1 }}>
                  {t.count}
                </span>
              </button>
            );
          })}
        </div>

        {/* ── AI Insights ── */}
        {!loading && risks.length > 0 && insights && <InsightsPanel data={insights} />}

        {/* ── List ── */}
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden", boxShadow: "var(--shadow-1)" }}>
          {loading ? (
            <>
              <RowSkeleton /><RowSkeleton /><RowSkeleton />
            </>
          ) : sorted.length === 0 ? (
            <div style={{ padding: "56px 0", textAlign: "center" }}>
              <ShieldAlert style={{ width: 28, height: 28, color: "var(--border)", margin: "0 auto 10px" }} />
              <p style={{ fontSize: 14, fontWeight: 500, color: "var(--text)" }}>
                {risks.length === 0 ? "No risks detected" : "Nothing here"}
              </p>
              <p style={{ fontSize: 12, color: "var(--text-3)", marginTop: 4 }}>
                {risks.length === 0
                  ? "Blocked, flagged, and stalled items will appear here."
                  : "No risks match this filter."}
              </p>
            </div>
          ) : (
            sorted.map(item => <RiskRow key={item.id} item={item} />)
          )}
        </div>

      </div>
    </div>
  );
}
