"use client";
import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { LayoutDashboard, RefreshCw, ExternalLink, Columns, Clock, ShieldAlert, AlertTriangle, MessageSquare, CheckCircle2, ChevronRight } from "lucide-react";

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
  "Needs Decision": "bg-amber-50 text-amber-700 border border-amber-200",
  "Blocked":        "bg-red-50 text-red-600 border border-red-200",
  "Risk":           "bg-orange-50 text-orange-600 border border-orange-200",
  "Approved":       "bg-emerald-50 text-emerald-700 border border-emerald-200",
  "Info":           "bg-blue-50 text-blue-600 border border-blue-200",
};

const SOURCE_CLS: Record<string, string> = {
  figma:   "bg-purple-50 text-purple-600 border border-purple-200",
  manual:  "bg-slate-50 text-slate-500 border border-slate-200",
  ai:      "bg-violet-50 text-violet-600 border border-violet-200",
};

// ─── Skeleton atoms ───────────────────────────────────────────────────────────

function SkeletonLine({ w = "w-full", h = "h-3" }: { w?: string; h?: string }) {
  return <div className={`skeleton ${h} ${w} rounded`} />;
}

// ─── Health Score Card ────────────────────────────────────────────────────────

function HealthCard({ pulse }: { pulse: PulseData }) {
  const { score, label } = pulse.health;
  const scoreColor = score >= 80 ? "text-emerald-500" : score >= 60 ? "text-amber-500" : "text-red-500";
  const labelCls   = score >= 80
    ? "bg-emerald-50 text-emerald-700 border-emerald-200"
    : score >= 60
    ? "bg-amber-50 text-amber-700 border-amber-200"
    : "bg-red-50 text-red-600 border-red-200";

  const stats = [
    { icon: <Clock size={12} />,         label: "Stalled",        value: pulse.stalledDecisions?.count  ?? 0, cls: "text-orange-500 bg-orange-50 border-orange-200" },
    { icon: <ShieldAlert size={12} />,   label: "Blocked",        value: pulse.unresolvedBlocks?.count  ?? 0, cls: "text-red-500 bg-red-50 border-red-200" },
    { icon: <AlertTriangle size={12} />, label: "Risks",          value: pulse.riskFlags?.count         ?? 0, cls: "text-amber-600 bg-amber-50 border-amber-200" },
    { icon: <MessageSquare size={12} />, label: "Needs Clarity",  value: pulse.vagueComments?.count     ?? 0, cls: "text-yellow-600 bg-yellow-50 border-yellow-200" },
  ];

  return (
    <div className="rounded-panel border border-border bg-paper p-5 flex flex-col sm:flex-row sm:items-center gap-5">
      {/* Score */}
      <div className="flex items-baseline gap-3 shrink-0">
        <span className={`text-[52px] font-bold leading-none tabular-nums ${scoreColor}`}>{score}</span>
        <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider border ${labelCls}`}>
          {label}
        </span>
      </div>

      {/* Divider */}
      <div className="hidden sm:block w-px h-10 bg-border shrink-0" />

      {/* Stat pills */}
      <div className="flex flex-wrap gap-2">
        {stats.map(s => (
          <span key={s.label} className={`inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full border ${s.cls}`}>
            {s.icon}
            <span className="font-bold">{s.value}</span>
            <span className="font-normal opacity-70">{s.label}</span>
          </span>
        ))}
      </div>

      {/* Link */}
      <Link href="/pulse" className="sm:ml-auto flex items-center gap-1 text-caption text-muted hover:text-ink transition-colors shrink-0">
        Full Pulse <ChevronRight size={12} />
      </Link>
    </div>
  );
}

function HealthCardSkeleton() {
  return (
    <div className="rounded-panel border border-border bg-paper p-5 flex items-center gap-5">
      <div className="skeleton h-14 w-20 rounded" />
      <div className="skeleton h-7 w-28 rounded-full" />
      <div className="flex gap-2 ml-4">
        {[1,2,3,4].map(n => <div key={n} className="skeleton h-7 w-24 rounded-full" />)}
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
  const syncCls   = syncing === "done" ? "border-emerald-300 text-emerald-600" : syncing === "error" ? "border-red-300 text-red-500" : "";

  return (
    <div className="flex gap-3">
      <button
        onClick={syncFigma}
        disabled={syncing === "syncing"}
        className={`flex items-center gap-2 px-4 py-2.5 rounded-panel border border-border bg-paper text-body text-ink hover:border-ink/30 transition-colors disabled:opacity-50 ${syncCls}`}
      >
        <RefreshCw size={14} className={syncing === "syncing" ? "animate-spin" : ""} />
        {syncLabel}
      </button>
      <Link
        href="/pulse"
        className="flex items-center gap-2 px-4 py-2.5 rounded-panel border border-border bg-paper text-body text-ink hover:border-ink/30 transition-colors"
      >
        <ExternalLink size={14} />
        Generate Brief
      </Link>
      <Link
        href="/board"
        className="flex items-center gap-2 px-4 py-2.5 rounded-panel border border-border bg-paper text-body text-ink hover:border-ink/30 transition-colors"
      >
        <Columns size={14} />
        View Board
      </Link>
    </div>
  );
}

// ─── Needs Attention ─────────────────────────────────────────────────────────

function NeedsAttentionCard({ items, loading }: { items: FeedbackItem[]; loading: boolean }) {
  return (
    <div className="rounded-panel border border-border bg-paper flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <span className="text-body font-semibold text-ink">Needs Attention</span>
        <Link href="/inbox" className="text-caption text-muted hover:text-ink transition-colors">
          View all →
        </Link>
      </div>
      <div className="flex-1 divide-y divide-border">
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
            <CheckCircle2 size={24} className="text-emerald-400 mx-auto mb-2" />
            <p className="text-body text-muted">All clear!</p>
          </div>
        ) : (
          items.map(item => {
            const title = item.ai_key_question && item.ai_key_question !== "None"
              ? item.ai_key_question
              : item.ai_summary ?? "Feedback item";
            const href = item.project?.id ? `/inbox/${item.project.id}/${item.id}` : "/inbox";
            const classCls = item.ai_classification ? (CLASS_CLS[item.ai_classification] ?? null) : null;

            return (
              <Link key={item.id} href={href} className="flex flex-col gap-1 px-4 py-3 hover:bg-surface transition-colors">
                {classCls && (
                  <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded self-start ${classCls}`}>
                    {item.ai_classification}
                  </span>
                )}
                <p className="text-body text-ink line-clamp-1">{title}</p>
                <div className="flex items-center gap-1.5 text-caption text-muted">
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
    <div className="rounded-panel border border-border bg-paper flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <span className="text-body font-semibold text-ink">Recent Decisions</span>
        <Link href="/decisions" className="text-caption text-muted hover:text-ink transition-colors">
          View all →
        </Link>
      </div>
      <div className="flex-1 divide-y divide-border">
        {loading ? (
          [1,2,3,4,5].map(n => (
            <div key={n} className="px-4 py-3 space-y-1.5">
              <SkeletonLine w="w-full" h="h-3" />
              <SkeletonLine w="w-1/3" h="h-2.5" />
            </div>
          ))
        ) : decisions.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <p className="text-body text-muted">No decisions yet</p>
          </div>
        ) : (
          decisions.map(d => {
            const srcCls = SOURCE_CLS[d.source] ?? SOURCE_CLS.manual;
            return (
              <div key={d.id} className="flex flex-col gap-1 px-4 py-3">
                <p className="text-body text-ink line-clamp-1">{d.decision_text}</p>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${srcCls}`}>
                    {d.source}
                  </span>
                  {d.owner_name && (
                    <span className="text-caption text-muted">{d.owner_name}</span>
                  )}
                  <span className="text-caption text-muted ml-auto">{timeAgo(d.decided_at)}</span>
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
    <div className="rounded-panel border border-border bg-paper px-4 py-3 flex items-center gap-2 flex-wrap">
      <span className="text-caption text-muted shrink-0">Waiting on:</span>
      {entries.map(e => (
        <span key={e.owner_name} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-surface border border-border text-body text-ink">
          <span className="w-5 h-5 rounded-full bg-ink/10 flex items-center justify-center text-[9px] font-bold text-ink/50 shrink-0">
            {e.owner_name.slice(0, 2).toUpperCase()}
          </span>
          {e.owner_name}
          <span className="text-[10px] font-bold text-muted">{e.count}</span>
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

  const loadAll = useCallback(() => {
    // Pulse
    fetch("/api/pulse")
      .then(r => r.json())
      .then((d: PulseData) => { setPulse(d); setPulseLoading(false); })
      .catch(() => setPulseLoading(false));

    // Feedback
    fetch("/api/feedback")
      .then(r => r.json())
      .then((d: { items?: FeedbackItem[] }) => { setFeedbackItems(d.items ?? []); setFeedbackLoading(false); })
      .catch(() => setFeedbackLoading(false));

    // Decisions timeline
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

  // Derive needs-attention list
  const needsAttention = feedbackItems
    .filter(i => i.status === "open" || i.status === "needs_decision")
    .slice(0, 5);

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-paper">

      {/* Header */}
      <div className="px-6 pt-6 pb-5 border-b border-border shrink-0">
        <div className="flex items-center gap-2.5 mb-1">
          <LayoutDashboard size={18} className="text-muted shrink-0" />
          <h1 className="text-title font-semibold text-ink">Dashboard</h1>
        </div>
        <p className="text-body text-muted">Overview of your workspace health and recent activity</p>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">

        {/* Section 1 — Health */}
        {pulseLoading ? <HealthCardSkeleton /> : pulse ? <HealthCard pulse={pulse} /> : null}

        {/* Section 2 — Quick Actions */}
        <QuickActions />

        {/* Section 3 — Two columns */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <NeedsAttentionCard items={needsAttention} loading={feedbackLoading} />
          <RecentDecisionsCard decisions={decisions} loading={decisionsLoading} />
        </div>

        {/* Section 4 — Waiting On */}
        {pulse && <WaitingOnRow entries={pulse.topWaitingOn ?? []} />}

      </div>
    </div>
  );
}
