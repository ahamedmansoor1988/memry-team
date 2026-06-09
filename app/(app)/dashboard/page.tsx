"use client";
import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { RefreshCw, ExternalLink, Columns, Clock, ShieldAlert, AlertTriangle, MessageSquare, CheckCircle2, TrendingUp, TrendingDown, Minus } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface PulseData {
  health: { score: number; label: string };
  stalledDecisions:  { count: number; items: unknown[] };
  unresolvedBlocks:  { count: number; items: unknown[] };
  riskFlags:         { count: number; items: unknown[] };
  vagueComments:     { count: number; items: unknown[] };
  topWaitingOn:      { owner_name: string; count: number }[];
}

interface FeedbackItem {
  id:                string;
  status:            string;
  priority:          string;
  ai_classification: string | null;
  ai_key_question:   string | null;
  ai_summary:        string | null;
  created_at:        string;
  project:           { id: string; name: string } | null;
}

interface DecisionItem {
  id:            string;
  decision_text: string;
  owner_name:    string | null;
  source:        string;
  decided_at:    string;
}

interface TimelineGroup {
  date:      string;
  decisions: DecisionItem[];
}

interface TrendEntry {
  direction: "up" | "down" | "flat";
  delta:     number;
}

interface TrendsData {
  current: {
    total: number; resolved: number; blocked: number;
    risk_flags: number; needs_decision: number;
  };
  trends: {
    total:          TrendEntry;
    resolved:       TrendEntry;
    blocked:        TrendEntry;
    risk_flags:     TrendEntry;
    needs_decision: TrendEntry;
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function timeAgo(date: string): string {
  const diff = Date.now() - new Date(date).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return `${Math.floor(d / 30)}mo ago`;
}

const CLASS_CLS: Record<string, string> = {
  "Needs Decision": "bg-zinc-900 text-white border-zinc-900",
  "Blocked":        "bg-red-50 text-red-700 border-red-200",
  "Risk":           "bg-zinc-100 text-zinc-600 border-zinc-200",
  "Approved":       "bg-zinc-100 text-zinc-600 border-zinc-200",
  "Info":           "bg-zinc-100 text-zinc-600 border-zinc-200",
};

const SOURCE_CLS: Record<string, string> = {
  figma:   "bg-zinc-100 text-zinc-600 border-zinc-200",
  manual:  "bg-zinc-100 text-zinc-500 border-zinc-200",
  ai:      "bg-indigo-50 text-indigo-600 border-indigo-200",
  meeting: "bg-indigo-50 text-indigo-600 border-indigo-200",
};

// ─── Skeleton atoms ───────────────────────────────────────────────────────────

function SkeletonLine({ w = "w-full", h = "h-3" }: { w?: string; h?: string }) {
  return <div className={`skeleton ${h} ${w} rounded`} />;
}

// ─── Health Score Card ────────────────────────────────────────────────────────

function HealthCard({ pulse }: { pulse: PulseData }) {
  const { score, label } = pulse.health;
  const ringColor = score >= 80 ? "border-indigo-500" : score >= 60 ? "border-zinc-400" : "border-red-400";
  const scoreColor = score >= 80 ? "text-indigo-600" : score >= 60 ? "text-zinc-700" : "text-red-600";
  const labelCls   = score >= 80
    ? "bg-indigo-50 text-indigo-700 border-indigo-200"
    : score >= 60
    ? "bg-zinc-100 text-zinc-600 border-zinc-200"
    : "bg-red-50 text-red-600 border-red-200";

  const stats = [
    { icon: <Clock size={12} />,         label: "Stalled",       value: pulse.stalledDecisions?.count  ?? 0 },
    { icon: <ShieldAlert size={12} />,   label: "Blocked",       value: pulse.unresolvedBlocks?.count  ?? 0, red: true },
    { icon: <AlertTriangle size={12} />, label: "Risks",         value: pulse.riskFlags?.count         ?? 0 },
    { icon: <MessageSquare size={12} />, label: "Needs Clarity", value: pulse.vagueComments?.count     ?? 0 },
  ];

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-5 flex flex-col sm:flex-row sm:items-center gap-5">
      {/* Health ring */}
      <div className="flex items-center gap-4 shrink-0">
        <div className={`w-16 h-16 rounded-full border-4 ${ringColor} flex items-center justify-center shrink-0`}>
          <span className={`text-xl font-bold tabular-nums leading-none ${scoreColor}`}>{score}</span>
        </div>
        <div className="flex flex-col gap-1">
          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border ${labelCls}`}>
            {label}
          </span>
          <span className="text-xs text-zinc-400">Workspace health</span>
        </div>
      </div>

      {/* Divider */}
      <div className="hidden sm:block w-px h-10 bg-zinc-100 shrink-0" />

      {/* Stat chips */}
      <div className="flex flex-wrap gap-2">
        {stats.map(s => (
          <span key={s.label} className={`inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border bg-white border-zinc-200 ${s.red && s.value > 0 ? "text-red-600 border-red-200 bg-red-50" : "text-zinc-700"}`}>
            {s.icon}
            <span className="font-bold">{s.value}</span>
            <span className="font-normal text-zinc-400">{s.label}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function HealthCardSkeleton() {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-5 flex items-center gap-5">
      <div className="skeleton w-16 h-16 rounded-full" />
      <div className="skeleton h-6 w-24 rounded-full" />
      <div className="flex gap-2 ml-4">
        {[1,2,3,4].map(n => <div key={n} className="skeleton h-8 w-24 rounded-lg" />)}
      </div>
    </div>
  );
}

// ─── Quick Actions ────────────────────────────────────────────────────────────

function QuickActions() {
  const [syncing, setSyncing] = useState<"idle" | "syncing" | "done" | "error">("idle");

  function syncFigma() {
    setSyncing("syncing");
    fetch("/api/figma/pull", { method: "POST" })
      .then(r => r.ok ? setSyncing("done") : setSyncing("error"))
      .catch(() => setSyncing("error"))
      .finally(() => setTimeout(() => setSyncing("idle"), 3000));
  }

  const syncLabel = syncing === "syncing" ? "Syncing…" : syncing === "done" ? "Done ✓" : syncing === "error" ? "Error" : "Sync Figma";
  const syncCls   = syncing === "done" ? "text-indigo-600 border-indigo-300" : syncing === "error" ? "text-red-500 border-red-300" : "text-zinc-700 border-zinc-200 hover:bg-zinc-50";

  return (
    <div className="flex gap-2 flex-wrap">
      <button
        onClick={syncFigma}
        disabled={syncing === "syncing"}
        className={`flex items-center gap-2 px-4 py-2 rounded-lg border bg-white text-sm font-medium shadow-sm transition-colors disabled:opacity-50 ${syncCls}`}
      >
        <RefreshCw size={14} className={syncing === "syncing" ? "animate-spin" : ""} />
        {syncLabel}
      </button>
      <Link
        href="/decisions"
        className="flex items-center gap-2 px-4 py-2 rounded-lg border border-zinc-200 bg-white text-sm font-medium text-zinc-700 hover:bg-zinc-50 shadow-sm transition-colors"
      >
        <ExternalLink size={14} />
        Generate Brief
      </Link>
      <Link
        href="/inbox"
        className="flex items-center gap-2 px-4 py-2 rounded-lg border border-zinc-200 bg-white text-sm font-medium text-zinc-700 hover:bg-zinc-50 shadow-sm transition-colors"
      >
        <Columns size={14} />
        View Inbox
      </Link>
    </div>
  );
}

// ─── Needs Attention ─────────────────────────────────────────────────────────

function NeedsAttentionCard({ items, loading }: { items: FeedbackItem[]; loading: boolean }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-100">
        <span className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Needs Attention</span>
        <Link href="/inbox" className="text-xs text-zinc-400 hover:text-zinc-700 transition-colors">
          View all →
        </Link>
      </div>
      <div className="flex-1 divide-y divide-zinc-100">
        {loading ? (
          [1,2,3,4,5].map(n => (
            <div key={n} className="px-4 py-3 space-y-1.5">
              <SkeletonLine w="w-16" h="h-3" />
              <SkeletonLine w="w-full" h="h-3" />
              <SkeletonLine w="w-1/2" h="h-2.5" />
            </div>
          ))
        ) : items.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <CheckCircle2 size={24} className="text-zinc-300 mx-auto mb-2" />
            <p className="text-sm text-zinc-400">All clear!</p>
          </div>
        ) : (
          items.map(item => {
            const title = item.ai_key_question && item.ai_key_question !== "None"
              ? item.ai_key_question
              : item.ai_summary ?? "Feedback item";
            const href = item.project?.id ? `/inbox/${item.project.id}/${item.id}` : "/inbox";
            const classCls = item.ai_classification ? (CLASS_CLS[item.ai_classification] ?? null) : null;

            return (
              <Link key={item.id} href={href} className="flex flex-col gap-1 px-4 py-3 hover:bg-zinc-50 transition-colors">
                {classCls && (
                  <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border self-start ${classCls}`}>
                    {item.ai_classification}
                  </span>
                )}
                <p className="text-sm text-zinc-900 line-clamp-1">{title}</p>
                <div className="flex items-center gap-1.5 text-xs text-zinc-400">
                  {item.project?.name && <span>{item.project.name}</span>}
                  <span className="opacity-40">·</span>
                  <span>{timeAgo(item.created_at)}</span>
                </div>
              </Link>
            );
          })
        )}
      </div>
    </div>
  );
}

// ─── Recent Decisions ─────────────────────────────────────────────────────────

function RecentDecisionsCard({ decisions, loading }: { decisions: DecisionItem[]; loading: boolean }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-100">
        <span className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Recent Decisions</span>
        <Link href="/decisions" className="text-xs text-zinc-400 hover:text-zinc-700 transition-colors">
          View all →
        </Link>
      </div>
      <div className="flex-1 divide-y divide-zinc-100">
        {loading ? (
          [1,2,3,4,5].map(n => (
            <div key={n} className="px-4 py-3 space-y-1.5">
              <SkeletonLine w="w-full" h="h-3" />
              <SkeletonLine w="w-1/3" h="h-2.5" />
            </div>
          ))
        ) : decisions.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <p className="text-sm text-zinc-400">No decisions yet</p>
          </div>
        ) : (
          decisions.map(d => {
            const srcCls = SOURCE_CLS[d.source] ?? SOURCE_CLS.manual;
            return (
              <div key={d.id} className="flex flex-col gap-1 px-4 py-3">
                <p className="text-sm text-zinc-900 line-clamp-1">{d.decision_text}</p>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${srcCls}`}>
                    {d.source}
                  </span>
                  {d.owner_name && (
                    <span className="text-xs text-zinc-400">{d.owner_name}</span>
                  )}
                  <span className="text-xs text-zinc-400 ml-auto">{timeAgo(d.decided_at)}</span>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// ─── Waiting On ───────────────────────────────────────────────────────────────

function WaitingOnRow({ entries }: { entries: { owner_name: string; count: number }[] }) {
  if (!entries.length) return null;
  return (
    <div className="rounded-xl border border-zinc-200 bg-white px-4 py-3 flex items-center gap-2 flex-wrap">
      <span className="text-xs text-zinc-400 shrink-0">Waiting on:</span>
      {entries.map(e => (
        <span key={e.owner_name} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-zinc-50 border border-zinc-200 text-sm text-zinc-700">
          <span className="w-5 h-5 rounded-full bg-zinc-200 flex items-center justify-center text-[9px] font-bold text-zinc-500 shrink-0">
            {e.owner_name.slice(0, 2).toUpperCase()}
          </span>
          {e.owner_name}
          <span className="text-[10px] font-bold text-zinc-400">{e.count}</span>
        </span>
      ))}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const [pulse,         setPulse]         = useState<PulseData | null>(null);
  const [pulseLoading,  setPulseLoading]  = useState(true);
  const [feedbackItems, setFeedbackItems] = useState<FeedbackItem[]>([]);
  const [feedbackLoading, setFeedbackLoading] = useState(true);
  const [decisions,     setDecisions]     = useState<DecisionItem[]>([]);
  const [decisionsLoading, setDecisionsLoading] = useState(true);
  const [trendsData,    setTrendsData]    = useState<TrendsData | null>(null);

  const loadAll = useCallback(() => {
    fetch("/api/pulse")
      .then(r => r.json())
      .then((d: PulseData) => { setPulse(d); setPulseLoading(false); })
      .catch(() => setPulseLoading(false));

    fetch("/api/feedback")
      .then(r => r.json())
      .then((d: { items?: FeedbackItem[] }) => { setFeedbackItems(d.items ?? []); setFeedbackLoading(false); })
      .catch(() => setFeedbackLoading(false));

    fetch("/api/decisions/timeline")
      .then(r => r.json())
      .then((d: { timeline?: TimelineGroup[] }) => {
        const flat = (d.timeline ?? []).flatMap(g => g.decisions);
        setDecisions(flat.slice(0, 5));
        setDecisionsLoading(false);
      })
      .catch(() => setDecisionsLoading(false));
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  useEffect(() => {
    fetch("/api/pulse/trends")
      .then(r => r.json())
      .then((d: TrendsData) => setTrendsData(d))
      .catch(() => {});
  }, []);

  const needsAttention = feedbackItems
    .filter(i => i.status === "open" || i.status === "needs_decision")
    .slice(0, 5);

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-white">

      {/* Header */}
      <div className="px-8 pt-7 pb-5 border-b border-zinc-200 shrink-0">
        <h1 className="text-2xl font-semibold text-zinc-900">Dashboard</h1>
        <p className="text-sm text-zinc-400 mt-0.5">Overview of your workspace health and recent activity</p>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-8 py-6 space-y-5 max-w-6xl">

        {/* Section 1 — Health */}
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400 mb-3">Workspace Health</p>
          {pulseLoading ? <HealthCardSkeleton /> : pulse ? <HealthCard pulse={pulse} /> : null}
        </div>

        {/* Section 2 — Quick Actions */}
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400 mb-3">Quick Actions</p>
          <QuickActions />
        </div>

        {/* Section 3 — Two columns */}
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400 mb-3">Activity</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <NeedsAttentionCard items={needsAttention} loading={feedbackLoading} />
            <RecentDecisionsCard decisions={decisions} loading={decisionsLoading} />
          </div>
        </div>

        {/* Section 4 — Waiting On */}
        {pulse && (pulse.topWaitingOn ?? []).length > 0 && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400 mb-3">Waiting On</p>
            <WaitingOnRow entries={pulse.topWaitingOn ?? []} />
          </div>
        )}

        {/* Section 5 — Trends this week */}
        {trendsData && (() => {
          type MetricKey = "total" | "resolved" | "blocked" | "risk_flags" | "needs_decision";
          const metaCfg: { key: MetricKey; label: string; goodDir: "up" | "down" | "flat" }[] = [
            { key: "total",          label: "New Items",      goodDir: "flat" },
            { key: "resolved",       label: "Resolved",       goodDir: "up"   },
            { key: "blocked",        label: "Blocked",        goodDir: "down" },
            { key: "risk_flags",     label: "Risks",          goodDir: "down" },
            { key: "needs_decision", label: "Needs Decision", goodDir: "down" },
          ];

          return (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400 mb-3">Trends This Week</p>
              <div className="grid grid-cols-5 gap-2">
                {metaCfg.map(({ key, label, goodDir }) => {
                  const t   = trendsData.trends[key];
                  const val = trendsData.current[key];

                  const isGood = t.direction === goodDir || (goodDir === "flat" && t.direction !== "up");
                  const isBad  = (goodDir === "up"   && t.direction === "down") ||
                                 (goodDir === "down" && t.direction === "up")   ||
                                 (goodDir === "flat" && t.direction === "up");

                  const numColor  = isBad ? "text-red-500" : isGood ? "text-indigo-600" : "text-zinc-600";
                  const deltaCls  = isBad ? "text-red-400" : isGood ? "text-indigo-500" : "text-zinc-400";
                  const ArrowIcon = t.direction === "up" ? TrendingUp : t.direction === "down" ? TrendingDown : Minus;

                  return (
                    <div key={key} className="flex flex-col items-center gap-0.5 rounded-xl border border-zinc-200 bg-white p-3 text-center">
                      <span className="text-[10px] text-zinc-400 leading-tight mb-1">{label}</span>
                      <span className={`text-[22px] font-bold leading-none tabular-nums ${numColor}`}>{val}</span>
                      <div className={`flex items-center gap-0.5 mt-1 ${deltaCls}`}>
                        <ArrowIcon size={11} />
                        <span className="text-[10px] font-semibold">
                          {t.delta > 0 ? `+${t.delta}` : t.delta === 0 ? "—" : t.delta}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}

      </div>
    </div>
  );
}
