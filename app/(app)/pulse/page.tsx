"use client";
import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Clock, ShieldAlert, AlertTriangle, MessageCircle, Zap, Radio } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface SignalItem {
  id: string;
  ai_key_question: string | null;
  created_at: string;
  project_id: string | null;
  project_name: string | null;
}

interface SignalGroup {
  count: number;
  items: SignalItem[];
}

interface FeedbackSpike {
  projectName: string;
  count: number;
}

interface PulseData {
  health: { score: number; label: string };
  stalledDecisions: SignalGroup;
  unresolvedBlocks: SignalGroup;
  riskFlags: SignalGroup;
  vagueComments: SignalGroup;
  feedbackSpikes: FeedbackSpike[];
  generatedAt: string;
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
              <p className="text-body text-ink line-clamp-1 flex-1 min-w-0">
                {itemLabel(item)}
              </p>
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

// ─── Main page ────────────────────────────────────────────────────────────────

export default function PulsePage() {
  const router = useRouter();
  const [data, setData] = useState<PulseData | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchedAt, setFetchedAt] = useState<Date | null>(null);
  const [secondsAgo, setSecondsAgo] = useState(0);

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

  // Initial load + 60s auto-refresh
  useEffect(() => {
    loadData();
    const refresh = setInterval(loadData, 60_000);
    return () => clearInterval(refresh);
  }, [loadData]);

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
        <div className="flex items-center gap-2 mb-1">
          <Radio size={18} className="text-muted shrink-0" />
          <h1 className="text-title font-semibold text-ink">Workspace Pulse</h1>
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
                icon={<MessageCircle size={14} className="text-yellow-600" />}
                iconBg="bg-yellow-50"
                countBadgeCls="bg-yellow-100 text-yellow-700"
                group={data.vagueComments}
                onClickItem={handleClickItem}
              />
            </div>

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
