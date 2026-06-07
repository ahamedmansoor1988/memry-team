"use client";
import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Clock, ShieldAlert, AlertTriangle, MessageSquare, Zap, Radio, Users, FileText, TrendingUp, TrendingDown, Minus, BarChart2 } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface SignalItem {
  id: string;
  ai_key_question: string | null;
  created_at: string;
  project_id: string | null;
  project_name: string | null;
  accountability_label: string | null;
}

interface SignalGroup {
  count: number;
  items: SignalItem[];
}

interface FeedbackSpike {
  projectName: string;
  count: number;
}

interface WaitingOnEntry {
  owner_name: string;
  count: number;
}

interface PulseData {
  health: { score: number; label: string };
  stalledDecisions: SignalGroup;
  unresolvedBlocks: SignalGroup;
  riskFlags: SignalGroup;
  vagueComments: SignalGroup;
  feedbackSpikes: FeedbackSpike[];
  topWaitingOn: WaitingOnEntry[];
  generatedAt: string;
}

interface MonitoringIssue {
  type: "stalled" | "blocker" | "risk" | "ownership_gap" | "vague_cluster";
  severity: "high" | "medium" | "low";
  title: string;
  description: string;
  feedback_item_ids: string[];
  owner_name: string | null;
}

interface MonitoringReport {
  issues: MonitoringIssue[];
  scanned_at: string;
  total_open: number;
  health_score: number;
}

interface TrendEntry {
  direction: "up" | "down" | "flat";
  delta: number;
}

interface TrendsData {
  current: {
    total: number; resolved: number; blocked: number;
    risk_flags: number; needs_decision: number;
  };
  trends: {
    total: TrendEntry; resolved: TrendEntry; blocked: TrendEntry;
    risk_flags: TrendEntry; needs_decision: TrendEntry;
  };
}

interface ProjectHealth {
  id: string; name: string;
  total: number; open: number; resolved: number;
  blocked: number; risk_flags: number;
  avg_wait_days: number; resolution_rate: number;
  health: number;
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

/** Returns the display label for an item — skips the literal string "None". */
function itemLabel(item: SignalItem): string {
  const q = item.ai_key_question;
  if (q && q !== "None" && q.trim() !== "") return q;
  return item.project_name ?? "—";
}

// ─── Health meta ──────────────────────────────────────────────────────────────

type HealthLabel = "Healthy" | "Needs Attention" | "At Risk" | "Critical";

const HEALTH_META: Record<HealthLabel, { scoreColor: string; labelCls: string; description: string }> = {
  "Healthy":         { scoreColor: "text-emerald-500", labelCls: "bg-emerald-50 text-emerald-700 border-emerald-200", description: "Your workspace is in good shape."     },
  "Needs Attention": { scoreColor: "text-yellow-500",  labelCls: "bg-yellow-50 text-yellow-700 border-yellow-200",   description: "A few items need your focus."       },
  "At Risk":         { scoreColor: "text-orange-500",  labelCls: "bg-orange-50 text-orange-700 border-orange-200",   description: "Several issues are building up."    },
  "Critical":        { scoreColor: "text-red-500",     labelCls: "bg-red-50 text-red-700 border-red-200",           description: "Immediate attention required."       },
};

function getHealthMeta(label: string) {
  return HEALTH_META[label as HealthLabel] ?? HEALTH_META["Needs Attention"];
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function PulseSkeleton() {
  return (
    <div className="space-y-4">
      <div className="rounded-panel border border-border bg-paper p-6">
        <div className="skeleton h-3 w-24 rounded mb-4" />
        <div className="flex items-baseline gap-4">
          <div className="skeleton h-14 w-20 rounded" />
          <div className="skeleton h-7 w-28 rounded-full" />
        </div>
        <div className="skeleton h-4 w-48 rounded mt-3" />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {[1, 2, 3, 4].map(n => (
          <div key={n} className="rounded-panel border border-border bg-paper p-4 space-y-3">
            <div className="flex items-center gap-2">
              <div className="skeleton w-7 h-7 rounded-lg" />
              <div className="skeleton h-4 w-32 rounded" />
            </div>
            <div className="skeleton h-3 w-full rounded" />
            <div className="skeleton h-3 w-4/5 rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Signal Card ─────────────────────────────────────────────────────────────

interface SignalCardProps {
  title: string;
  icon: React.ReactNode;
  iconBg: string;
  countBadgeCls: string;
  group: SignalGroup;
  onClickItem: (item: SignalItem) => void;
}

function SignalCard({ title, icon, iconBg, countBadgeCls, group, onClickItem }: SignalCardProps) {
  const isEmpty = group.count === 0;

  return (
    <div className="rounded-panel border border-border bg-paper p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${iconBg}`}>
            {icon}
          </div>
          <span className="text-body font-semibold text-ink">{title}</span>
        </div>
        {!isEmpty && (
          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${countBadgeCls}`}>
            {group.count}
          </span>
        )}
      </div>

      {/* Body */}
      {isEmpty ? (
        <p className="text-caption text-muted py-1.5 flex items-center gap-1.5">
          <span className="text-emerald-400">✓</span> All clear
        </p>
      ) : (
        <div className="space-y-1">
          {group.items.map(item => (
            <button
              key={item.id}
              onClick={() => onClickItem(item)}
              disabled={!item.project_id}
              className="w-full flex items-start justify-between gap-3 px-2 py-1.5 rounded-lg hover:bg-surface transition-colors text-left disabled:cursor-default"
            >
              <div className="flex-1 min-w-0">
                <p className="text-body text-ink line-clamp-1">{itemLabel(item)}</p>
                {item.accountability_label && (
                  <p className="text-[10px] text-orange-500 font-medium mt-0.5">{item.accountability_label}</p>
                )}
              </div>
              <span className="text-caption text-muted shrink-0">{timeAgo(item.created_at)}</span>
            </button>
          ))}
          {group.count > 3 && (
            <p className="text-caption text-muted px-2 pt-0.5">+{group.count - 3} more</p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Issue row ────────────────────────────────────────────────────────────────

const SEVERITY_DOT: Record<MonitoringIssue["severity"], string> = {
  high:   "bg-red-500",
  medium: "bg-amber-400",
  low:    "bg-gray-300",
};

const SEVERITY_BADGE: Record<MonitoringIssue["severity"], string> = {
  high:   "bg-red-50 text-red-600",
  medium: "bg-amber-50 text-amber-600",
  low:    "bg-gray-100 text-gray-500",
};

function IssueRow({ issue }: { issue: MonitoringIssue }) {
  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-border last:border-0">
      <div className={`w-2 h-2 rounded-full shrink-0 mt-1.5 ${SEVERITY_DOT[issue.severity]}`} />
      <div className="flex-1 min-w-0">
        <p className="text-body font-semibold text-ink">{issue.title}</p>
        <p className="text-caption text-muted mt-0.5">{issue.description}</p>
        {issue.owner_name && (
          <p className="text-caption text-muted mt-0.5">
            <span className="opacity-50">→</span> {issue.owner_name}
          </p>
        )}
      </div>
      <span className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full shrink-0 self-start mt-0.5 ${SEVERITY_BADGE[issue.severity]}`}>
        {issue.severity}
      </span>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function PulsePage() {
  const router = useRouter();
  const [data, setData] = useState<PulseData | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchedAt, setFetchedAt] = useState<Date | null>(null);
  const [secondsAgo, setSecondsAgo] = useState(0);

  const [monitoring, setMonitoring] = useState<MonitoringReport | null>(null);
  const [scanning, setScanning] = useState(false);

  // ── Trends ───────────────────────────────────────────────────────────────
  const [trends, setTrends] = useState<TrendsData | null>(null);

  // ── Project Health ────────────────────────────────────────────────────────
  const [projectHealth, setProjectHealth] = useState<ProjectHealth[]>([]);

  // ── Weekly Brief ──────────────────────────────────────────────────────────
  const [brief, setBrief] = useState<{
    headline: string;
    decisions_summary: string;
    attention_needed: string[];
    blockers_summary: string;
    momentum: "high" | "medium" | "low";
    momentum_reason: string;
  } | null>(null);
  const [briefLoading, setBriefLoading] = useState(false);
  const [briefError, setBriefError] = useState<string | null>(null);

  function generateBrief() {
    setBriefLoading(true);
    setBriefError(null);
    fetch("/api/brief")
      .then(r => r.json())
      .then(d => {
        setBrief(d);
        setBriefLoading(false);
      })
      .catch(() => {
        setBriefError("Failed to generate brief. Try again.");
        setBriefLoading(false);
      });
  }

  const loadData = useCallback(() => {
    fetch("/api/pulse")
      .then(r => r.json())
      .then((d: PulseData) => {
        setData(d);
        setFetchedAt(new Date());
        setSecondsAgo(0);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const loadMonitoring = useCallback((showSpinner = false) => {
    if (showSpinner) setScanning(true);
    fetch("/api/monitoring/report")
      .then(r => r.json())
      .then((r: MonitoringReport) => setMonitoring(r))
      .catch(() => {})
      .finally(() => { if (showSpinner) setScanning(false); });
  }, []);

  // Initial load + 60s auto-refresh for both data sources
  useEffect(() => {
    loadData();
    loadMonitoring();
    const refresh = setInterval(() => { loadData(); loadMonitoring(); }, 60_000);
    return () => clearInterval(refresh);
  }, [loadData, loadMonitoring]);

  // Load trends + project health once on mount
  useEffect(() => {
    fetch("/api/pulse/trends")
      .then(r => r.json())
      .then((d: TrendsData) => setTrends(d))
      .catch(() => {});
    fetch("/api/projects/intelligence")
      .then(r => r.json())
      .then((d: { projects?: ProjectHealth[] }) => setProjectHealth(d.projects ?? []))
      .catch(() => {});
  }, []);

  // Tick the "seconds ago" counter every second
  useEffect(() => {
    if (!fetchedAt) return;
    const tick = setInterval(() => {
      setSecondsAgo(Math.floor((Date.now() - fetchedAt.getTime()) / 1000));
    }, 1000);
    return () => clearInterval(tick);
  }, [fetchedAt]);

  function handleClickItem(item: SignalItem) {
    if (item.project_id) {
      router.push(`/inbox/${item.project_id}/${item.id}`);
    }
  }

  const health = data ? getHealthMeta(data.health.label) : null;

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-paper">

      {/* ── Header ── */}
      <div className="px-6 pt-6 pb-5 border-b border-border shrink-0">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <Radio size={18} className="text-muted shrink-0" />
            <h1 className="text-title font-semibold text-ink">Workspace Pulse</h1>
          </div>
          <button
            onClick={() => loadMonitoring(true)}
            disabled={scanning}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-body text-muted hover:text-ink hover:border-ink/30 transition-colors disabled:opacity-40"
          >
            {scanning ? (
              <span className="w-3 h-3 rounded-full border-2 border-muted/30 border-t-muted animate-spin" />
            ) : (
              <Radio size={12} className="shrink-0" />
            )}
            {scanning ? "Scanning…" : "Scan now"}
          </button>
        </div>
        <p className="text-body text-muted">Live view of what needs attention</p>
      </div>

      {/* ── Content ── */}
      <div className="flex-1 overflow-y-auto px-6 py-5">
        {loading ? (
          <PulseSkeleton />
        ) : !data ? (
          <div className="flex items-center justify-center py-24">
            <p className="text-body text-muted">Failed to load pulse data. Try again.</p>
          </div>
        ) : (
          <div className="space-y-4 fade-in">

            {/* ── Health Score Card ── */}
            <div className="rounded-panel border border-border bg-paper p-6">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted mb-3">
                Workspace Health
              </p>
              <div className="flex items-baseline gap-3 mb-2">
                <span className={`text-[52px] font-bold leading-none tabular-nums ${health!.scoreColor}`}>
                  {data.health.score}
                </span>
                <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider border ${health!.labelCls}`}>
                  {data.health.label}
                </span>
              </div>
              <p className="text-body text-muted">{health!.description}</p>
            </div>

            {/* ── Trends: This Week vs Last Week ── */}
            {trends && (() => {
              type MetricKey = "total" | "resolved" | "blocked" | "risk_flags" | "needs_decision";

              const metaCfg: {
                key: MetricKey;
                label: string;
                goodDir: "up" | "down" | "flat";
              }[] = [
                { key: "total",          label: "New Items",      goodDir: "flat" },
                { key: "resolved",       label: "Resolved",       goodDir: "up"   },
                { key: "blocked",        label: "Blocked",        goodDir: "down" },
                { key: "risk_flags",     label: "Risks",          goodDir: "down" },
                { key: "needs_decision", label: "Needs Decision", goodDir: "down" },
              ];

              return (
                <div className="rounded-panel border border-border bg-paper p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <BarChart2 size={14} className="text-muted shrink-0" />
                    <span className="text-[10px] font-bold uppercase tracking-widest text-muted">
                      This Week vs Last Week
                    </span>
                  </div>
                  <div className="grid grid-cols-5 gap-2">
                    {metaCfg.map(({ key, label, goodDir }) => {
                      const t = trends.trends[key];
                      const val = trends.current[key];

                      const isGood = t.direction === goodDir || (goodDir === "flat" && t.direction !== "up");
                      const isBad  = (goodDir === "up"   && t.direction === "down") ||
                                     (goodDir === "down" && t.direction === "up")   ||
                                     (goodDir === "flat" && t.direction === "up");
                      const isFlat = t.direction === "flat";

                      const numColor = isGood ? "text-emerald-600" : isBad ? "text-red-500" : "text-muted";
                      const deltaCls = isGood ? "text-emerald-600" : isBad ? "text-red-500" : "text-muted";
                      const ArrowIcon = t.direction === "up" ? TrendingUp : t.direction === "down" ? TrendingDown : Minus;

                      return (
                        <div key={key} className="flex flex-col items-center gap-0.5 rounded-lg bg-surface border border-border p-2.5 text-center">
                          <span className="text-caption text-muted leading-tight mb-1 text-[10px]">{label}</span>
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

            {/* ── Project Health ── */}
            {projectHealth.length >= 2 && (
              <div className="rounded-panel border border-border bg-paper">
                <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
                  <BarChart2 size={14} className="text-muted shrink-0" />
                  <span className="text-[10px] font-bold uppercase tracking-widest text-muted">
                    Project Health
                  </span>
                </div>
                <div className="divide-y divide-border">
                  {projectHealth.map(p => {
                    const barColor = p.health >= 80 ? "bg-emerald-500" : p.health >= 60 ? "bg-amber-400" : "bg-red-500";
                    const scoreColor = p.health >= 80 ? "text-emerald-600" : p.health >= 60 ? "text-amber-600" : "text-red-500";
                    return (
                      <div key={p.id} className="px-4 py-3 flex items-center gap-3">
                        {/* Name + bar */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-body font-medium text-ink truncate">{p.name}</span>
                            <span className={`text-[11px] font-bold tabular-nums ml-2 shrink-0 ${scoreColor}`}>{p.health}</span>
                          </div>
                          <div className="h-1.5 rounded-full bg-surface overflow-hidden">
                            <div className={`h-full rounded-full ${barColor} transition-all`} style={{ width: `${p.health}%` }} />
                          </div>
                        </div>
                        {/* Stats */}
                        <div className="flex items-center gap-3 shrink-0 text-caption">
                          <span className="text-muted">{p.open} open</span>
                          {p.blocked > 0
                            ? <span className="text-red-500 font-semibold">{p.blocked} blocked</span>
                            : <span className="text-muted">0 blocked</span>}
                          <span className={p.avg_wait_days > 5 ? "text-amber-600 font-semibold" : "text-muted"}>
                            {p.avg_wait_days}d wait
                          </span>
                          <span className="text-muted">{p.resolution_rate}% resolved</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ── Issues Detected ── */}
            {monitoring && (
              <div className="rounded-panel border border-border bg-paper">
                <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-muted">
                    Issues Detected
                  </span>
                  {monitoring.issues.length > 0 && (
                    <span className="text-caption text-muted">
                      {monitoring.total_open} open · scanned {timeAgo(monitoring.scanned_at)}
                    </span>
                  )}
                </div>
                <div className="px-4">
                  {monitoring.issues.length === 0 ? (
                    <p className="py-3 text-body text-emerald-600 flex items-center gap-1.5">
                      <span>✓</span> No issues detected
                    </p>
                  ) : (
                    monitoring.issues.map((issue, i) => (
                      <IssueRow key={`${issue.type}-${i}`} issue={issue} />
                    ))
                  )}
                  <div className="py-2.5 flex justify-end">
                    <Link
                      href="/accountability"
                      className="text-caption text-muted hover:text-ink transition-colors"
                    >
                      View all →
                    </Link>
                  </div>
                </div>
              </div>
            )}

            {/* ── Signal Cards ── */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <SignalCard
                title="Stalled Decisions"
                icon={<Clock size={14} className="text-orange-500" />}
                iconBg="bg-orange-50"
                countBadgeCls="bg-orange-100 text-orange-700"
                group={data.stalledDecisions}
                onClickItem={handleClickItem}
              />
              <SignalCard
                title="Blocked"
                icon={<ShieldAlert size={14} className="text-red-500" />}
                iconBg="bg-red-50"
                countBadgeCls="bg-red-100 text-red-700"
                group={data.unresolvedBlocks}
                onClickItem={handleClickItem}
              />
              <SignalCard
                title="Risks"
                icon={<AlertTriangle size={14} className="text-amber-500" />}
                iconBg="bg-amber-50"
                countBadgeCls="bg-amber-100 text-amber-700"
                group={data.riskFlags}
                onClickItem={handleClickItem}
              />
              <SignalCard
                title="Needs Clarification"
                icon={<MessageSquare size={14} className="text-yellow-600" />}
                iconBg="bg-yellow-50"
                countBadgeCls="bg-yellow-100 text-yellow-700"
                group={data.vagueComments}
                onClickItem={handleClickItem}
              />
            </div>

            {/* ── Waiting On ── */}
            {data.topWaitingOn?.length > 0 && (
              <div className="rounded-panel border border-border bg-paper p-4">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-7 h-7 rounded-lg bg-sky-50 flex items-center justify-center shrink-0">
                    <Users size={14} className="text-sky-600" />
                  </div>
                  <span className="text-body font-semibold text-ink">Waiting On</span>
                </div>
                <div className="space-y-1.5">
                  {data.topWaitingOn.map(entry => (
                    <div key={entry.owner_name} className="flex items-center justify-between text-body">
                      <span className="text-ink font-medium">{entry.owner_name}</span>
                      <span className="text-muted text-caption">
                        {entry.count} item{entry.count !== 1 ? "s" : ""} waiting
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── Feedback Spikes ── */}
            {data.feedbackSpikes.length > 0 && (
              <div className="rounded-panel border border-violet-200 bg-violet-50 p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Zap size={14} className="text-violet-600 shrink-0" />
                  <span className="text-body font-semibold text-violet-700">⚡ Feedback spike</span>
                </div>
                <div className="space-y-1.5">
                  {data.feedbackSpikes.map(spike => (
                    <p key={spike.projectName} className="text-body text-violet-600">
                      <span className="font-semibold">{spike.projectName}</span>
                      {" · "}
                      {spike.count} new comment{spike.count !== 1 ? "s" : ""} this week
                    </p>
                  ))}
                </div>
              </div>
            )}

            {/* ── Weekly Brief ── */}
            <div className="rounded-panel border border-border bg-paper">
              <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                <div className="flex items-center gap-2">
                  <FileText size={14} className="text-muted" />
                  <span className="text-[10px] font-bold uppercase tracking-widest text-muted">
                    Weekly Brief
                  </span>
                </div>
                <button
                  onClick={generateBrief}
                  disabled={briefLoading}
                  className="flex items-center gap-1.5 px-3 py-1 rounded-lg border border-border text-caption text-muted hover:text-ink hover:border-ink/30 transition-colors disabled:opacity-40"
                >
                  {briefLoading ? (
                    <span className="w-3 h-3 rounded-full border-2 border-muted/30 border-t-muted animate-spin" />
                  ) : (
                    <FileText size={11} />
                  )}
                  {briefLoading ? "Generating…" : "Generate Brief"}
                </button>
              </div>

              <div className="px-4 py-4">
                {!brief && !briefLoading && !briefError && (
                  <p className="text-body text-muted text-center py-4">
                    Click "Generate Brief" for an AI summary of the past 7 days.
                  </p>
                )}
                {briefError && (
                  <p className="text-body text-red-500 py-2">{briefError}</p>
                )}
                {briefLoading && (
                  <div className="space-y-3 py-2">
                    <div className="skeleton h-4 w-3/4 rounded" />
                    <div className="skeleton h-3 w-full rounded" />
                    <div className="skeleton h-3 w-5/6 rounded" />
                    <div className="skeleton h-3 w-2/3 rounded" />
                  </div>
                )}
                {brief && !briefLoading && (
                  <div className="space-y-4">
                    {/* Headline + momentum */}
                    <div className="flex items-start gap-3">
                      <p className="flex-1 text-body font-semibold text-ink leading-snug">
                        {brief.headline}
                      </p>
                      <span className={`shrink-0 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${
                        brief.momentum === "high"
                          ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                          : brief.momentum === "medium"
                          ? "bg-amber-50 text-amber-700 border-amber-200"
                          : "bg-red-50 text-red-600 border-red-200"
                      }`}>
                        {brief.momentum} momentum
                      </span>
                    </div>

                    {/* Decisions */}
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-muted mb-1">Decisions</p>
                      <p className="text-body text-ink leading-relaxed">{brief.decisions_summary}</p>
                    </div>

                    {/* Attention needed */}
                    {brief.attention_needed.length > 0 && (
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-widest text-muted mb-1.5">Attention Needed</p>
                        <ul className="space-y-1">
                          {brief.attention_needed.map((item, i) => (
                            <li key={i} className="flex items-start gap-2 text-body text-ink">
                              <span className="text-amber-500 shrink-0 mt-0.5">•</span>
                              {item}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Blockers */}
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-muted mb-1">Blockers</p>
                      <p className="text-body text-ink leading-relaxed">{brief.blockers_summary}</p>
                    </div>

                    {/* Momentum reason */}
                    <p className="text-caption text-muted italic">{brief.momentum_reason}</p>
                  </div>
                )}
              </div>
            </div>

            {/* ── Last updated ── */}
            <p className="text-caption text-muted text-center py-2">
              Last updated{" "}
              {secondsAgo < 5 ? "just now" : `${secondsAgo}s ago`}
              {" · "}
              auto-refreshes every 60s
            </p>

          </div>
        )}
      </div>
    </div>
  );
}
