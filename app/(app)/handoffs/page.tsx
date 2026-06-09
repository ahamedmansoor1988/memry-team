"use client";
import { useState, useEffect } from "react";
import { ArrowRightLeft } from "lucide-react";
import Link from "next/link";

// ─── Types ────────────────────────────────────────────────────────────────────

interface HandoffItem {
  id:                string;
  status:            string;
  priority:          string | null;
  ai_classification: string | null;
  ai_key_question:   string | null;
  ai_summary:        string | null;
  owner_name:        string;
  waiting_days:      number;
  updated_at:        string;
  project_id:        string | null;
  project_name:      string | null;
  author_name:       string | null;
}

type AccountabilityUrgency = "critical" | "high" | "medium" | "low" | "none";

interface AccountabilityItem {
  id:                string;
  status:            string;
  ai_classification: string | null;
  ai_key_question:   string | null;
  ai_summary:        string | null;
  owner_name:        string | null;
  project_id:        string | null;
  project_name:      string | null;
  updated_at:        string;
  waiting_days:      number;
  blocked_days:      number;
  is_overdue:        boolean;
  urgency:           AccountabilityUrgency;
  label:             string;
  should_escalate:   boolean;
}

// ─── Shared constants ─────────────────────────────────────────────────────────

const STATUS_CLS: Record<string, string> = {
  open:           "bg-zinc-100 text-zinc-600 border border-zinc-200",
  needs_decision: "bg-zinc-100 text-zinc-600 border border-zinc-200",
};

const STATUS_LABEL: Record<string, string> = {
  open:           "Open",
  needs_decision: "Needs Decision",
};

const CLASS_CLS: Record<string, string> = {
  "Needs Decision": "bg-zinc-100 text-zinc-600 border border-zinc-200",
  "Blocked":        "bg-red-50 text-red-600 border border-red-200",
  "Approved":       "bg-zinc-100 text-zinc-700 border border-zinc-200",
  "Risk":           "bg-zinc-100 text-zinc-600 border border-zinc-200",
  "Info":           "bg-zinc-100 text-zinc-600 border border-zinc-200",
};

const URGENCY_BORDER: Record<AccountabilityUrgency, string> = {
  critical: "border-l-red-500",
  high:     "border-l-zinc-500",
  medium:   "border-l-zinc-400",
  low:      "border-l-gray-300",
  none:     "border-l-transparent",
};

const URGENCY_LABEL_CLS: Record<AccountabilityUrgency, string> = {
  critical: "bg-red-50 text-red-700",
  high:     "bg-zinc-100 text-zinc-600",
  medium:   "bg-zinc-100 text-zinc-600",
  low:      "bg-gray-100 text-gray-500",
  none:     "bg-gray-100 text-gray-400",
};

const URGENCY_HEADING: Record<AccountabilityUrgency, string> = {
  critical: "CRITICAL",
  high:     "HIGH",
  medium:   "MEDIUM",
  low:      "LOW",
  none:     "",
};

const URGENCY_HEADING_CLS: Record<AccountabilityUrgency, string> = {
  critical: "text-red-500",
  high:     "text-zinc-600",
  medium:   "text-zinc-600",
  low:      "text-gray-400",
  none:     "text-gray-300",
};

const URGENCY_ORDER: AccountabilityUrgency[] = ["critical", "high", "medium", "low"];

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

function handoffTitle(item: HandoffItem): string {
  if (item.ai_key_question && item.ai_key_question !== "None") return item.ai_key_question;
  if (item.ai_summary) return item.ai_summary;
  return "Feedback item";
}

function accountTitle(item: AccountabilityItem): string {
  if (item.ai_key_question && item.ai_key_question !== "None") return item.ai_key_question;
  if (item.ai_summary) return item.ai_summary;
  return "—";
}

// ─── By-Owner view ────────────────────────────────────────────────────────────

function HandoffCard({ item }: { item: HandoffItem }) {
  const href       = item.project_id ? `/inbox/${item.project_id}/${item.id}` : "#";
  const statusCls  = STATUS_CLS[item.status] ?? STATUS_CLS.open;
  const classCls   = item.ai_classification ? (CLASS_CLS[item.ai_classification] ?? null) : null;
  const waitingCls = item.waiting_days > 7
    ? "text-red-600 bg-red-50 border border-red-200"
    : item.waiting_days > 3
    ? "text-zinc-600 bg-zinc-100 border border-zinc-200"
    : "text-muted bg-surface border border-border";

  return (
    <Link
      href={href}
      className="block rounded-panel border border-border bg-paper p-4 hover:border-ink/20 transition-colors mb-2"
    >
      <p className="text-body font-medium text-ink line-clamp-2 leading-snug mb-2">
        {handoffTitle(item)}
      </p>
      <div className="flex items-center gap-1.5 flex-wrap mb-2">
        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${statusCls}`}>
          {STATUS_LABEL[item.status] ?? item.status}
        </span>
        {classCls && (
          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${classCls}`}>
            {item.ai_classification}
          </span>
        )}
        {item.waiting_days > 0 && (
          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${waitingCls}`}>
            Waiting {item.waiting_days}d
          </span>
        )}
      </div>
      <div className="flex items-center gap-2 text-caption text-muted flex-wrap">
        {item.project_name && <span>{item.project_name}</span>}
        {item.author_name && (
          <>
            <span className="opacity-40">·</span>
            <span>{item.author_name}</span>
          </>
        )}
        <span className="ml-auto">{timeAgo(item.updated_at)}</span>
      </div>
    </Link>
  );
}

function ByOwnerView({ handoffs, loading }: { handoffs: HandoffItem[]; loading: boolean }) {
  const groups = new Map<string, HandoffItem[]>();
  for (const h of handoffs) {
    if (!groups.has(h.owner_name)) groups.set(h.owner_name, []);
    groups.get(h.owner_name)!.push(h);
  }

  if (loading) return <HandoffSkeleton />;
  if (handoffs.length === 0) return <EmptyState />;

  return (
    <div className="space-y-6 fade-in">
      {Array.from(groups.entries()).map(([owner, items]) => (
        <div key={owner}>
          <div className="flex items-center gap-2 mb-3">
            <span className="w-5 h-5 rounded-full bg-ink/10 flex items-center justify-center text-[9px] font-bold text-ink/50 shrink-0">
              {owner.slice(0, 2).toUpperCase()}
            </span>
            <span className="text-body font-semibold text-ink">{owner}</span>
            <span className="text-caption text-muted">
              · {items.length} item{items.length !== 1 ? "s" : ""}
            </span>
          </div>
          {items.map(item => <HandoffCard key={item.id} item={item} />)}
        </div>
      ))}
    </div>
  );
}

// ─── By-Urgency view ──────────────────────────────────────────────────────────

function AccountabilityRow({ item }: { item: AccountabilityItem }) {
  const title = accountTitle(item);
  const href  = item.project_id ? `/inbox/${item.project_id}/${item.id}` : "#";

  return (
    <Link
      href={href}
      className={`block border border-border bg-paper rounded-panel mb-2 border-l-4 ${URGENCY_BORDER[item.urgency]} hover:bg-surface transition-colors p-4`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-body font-medium text-ink line-clamp-2">{title}</p>
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            {item.project_name && <span className="text-caption text-muted">{item.project_name}</span>}
            {item.owner_name && (
              <span className="text-caption text-muted">
                <span className="opacity-40">·</span> {item.owner_name}
              </span>
            )}
            {item.ai_classification && (
              <span className="text-caption text-muted">
                <span className="opacity-40">·</span> {item.ai_classification}
              </span>
            )}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1.5 shrink-0">
          {item.label && (
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${URGENCY_LABEL_CLS[item.urgency]}`}>
              {item.label}
            </span>
          )}
          <span className="text-caption text-muted">{timeAgo(item.updated_at)}</span>
        </div>
      </div>
    </Link>
  );
}

function ByUrgencyView({ items, loading }: { items: AccountabilityItem[]; loading: boolean }) {
  const groups: Record<AccountabilityUrgency, AccountabilityItem[]> = {
    critical: [], high: [], medium: [], low: [], none: [],
  };
  for (const item of items) {
    const u = item.urgency in groups ? item.urgency : "low";
    groups[u].push(item);
  }

  if (loading) return <HandoffSkeleton />;
  if (items.length === 0) return <EmptyState />;

  return (
    <div className="space-y-6 fade-in">
      {URGENCY_ORDER.filter(u => groups[u].length > 0).map(urgency => (
        <div key={urgency}>
          <div className="flex items-center gap-2 mb-3">
            <span className={`text-[10px] font-bold uppercase tracking-widest ${URGENCY_HEADING_CLS[urgency]}`}>
              {URGENCY_HEADING[urgency]}
            </span>
            <span className="text-caption text-muted">
              {groups[urgency].length} item{groups[urgency].length !== 1 ? "s" : ""}
            </span>
          </div>
          {groups[urgency].map(item => <AccountabilityRow key={item.id} item={item} />)}
        </div>
      ))}
    </div>
  );
}

// ─── Shared UI ────────────────────────────────────────────────────────────────

function HandoffSkeleton() {
  return (
    <div className="space-y-2">
      {[1, 2, 3, 4].map(n => (
        <div key={n} className="rounded-panel border border-border bg-paper p-4 space-y-2">
          <div className="skeleton h-4 w-2/3 rounded mb-2" />
          <div className="flex gap-1.5">
            <div className="skeleton h-4 w-20 rounded" />
            <div className="skeleton h-4 w-16 rounded" />
          </div>
          <div className="skeleton h-3 w-1/3 rounded" />
        </div>
      ))}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-24 gap-3 text-center">
      <ArrowRightLeft size={32} className="text-wash" />
      <p className="text-lead font-medium text-ink">Nothing pending</p>
      <p className="text-body text-muted max-w-xs">
        Items requiring follow-up will appear here.
      </p>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

type TabView = "owner" | "urgency";

export default function HandoffsPage() {
  const [view, setView] = useState<TabView>("owner");

  const [handoffs,         setHandoffs]         = useState<HandoffItem[]>([]);
  const [handoffsLoading,  setHandoffsLoading]  = useState(true);

  const [urgencyItems,     setUrgencyItems]     = useState<AccountabilityItem[]>([]);
  const [urgencyLoading,   setUrgencyLoading]   = useState(false); // lazy — fetch on first switch

  // Load handoffs on mount
  useEffect(() => {
    fetch("/api/handoffs")
      .then(r => r.json())
      .then((d: { handoffs?: HandoffItem[] }) => {
        setHandoffs(d.handoffs ?? []);
        setHandoffsLoading(false);
      })
      .catch(() => setHandoffsLoading(false));
  }, []);

  // Load accountability data when switching to urgency view
  useEffect(() => {
    if (view !== "urgency" || urgencyItems.length > 0) return;
    setUrgencyLoading(true);
    fetch("/api/accountability")
      .then(r => r.json())
      .then((d: { items?: AccountabilityItem[] }) => {
        setUrgencyItems(d.items ?? []);
        setUrgencyLoading(false);
      })
      .catch(() => setUrgencyLoading(false));
  }, [view, urgencyItems.length]);

  const totalCount = view === "owner" ? handoffs.length : urgencyItems.length;

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-paper">

      {/* Header */}
      <div className="px-6 pt-6 pb-5 border-b border-border shrink-0">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2.5">
            <ArrowRightLeft size={18} className="text-muted shrink-0" />
            <h1 className="text-title font-semibold text-ink">Handoffs</h1>
            {!handoffsLoading && totalCount > 0 && (
              <span className="px-2 py-0.5 rounded-full bg-zinc-100 text-zinc-600 text-[11px] font-bold border border-zinc-200">
                {totalCount}
              </span>
            )}
          </div>

          {/* Toggle */}
          <div className="flex items-center rounded-lg border border-border overflow-hidden">
            {(["owner", "urgency"] as TabView[]).map(t => (
              <button
                key={t}
                onClick={() => setView(t)}
                className={`px-3 py-1.5 text-caption font-medium transition-colors ${
                  view === t
                    ? "bg-surface text-ink"
                    : "text-muted hover:text-ink"
                }`}
              >
                {t === "owner" ? "By Owner" : "By Urgency"}
              </button>
            ))}
          </div>
        </div>
        <p className="text-body text-muted">
          {view === "owner"
            ? "Items waiting on a named owner"
            : "Items grouped by follow-up urgency"}
        </p>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 py-5">
        {view === "owner"
          ? <ByOwnerView   handoffs={handoffs}     loading={handoffsLoading} />
          : <ByUrgencyView items={urgencyItems}    loading={urgencyLoading}  />
        }
      </div>
    </div>
  );
}
