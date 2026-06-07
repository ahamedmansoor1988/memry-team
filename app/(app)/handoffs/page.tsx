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

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_CLS: Record<string, string> = {
  open:           "bg-blue-50 text-blue-600 border border-blue-200",
  needs_decision: "bg-amber-50 text-amber-700 border border-amber-200",
};

const STATUS_LABEL: Record<string, string> = {
  open:           "Open",
  needs_decision: "Needs Decision",
};

const CLASS_CLS: Record<string, string> = {
  "Needs Decision": "bg-amber-50 text-amber-700 border border-amber-200",
  "Blocked":        "bg-red-50 text-red-600 border border-red-200",
  "Approved":       "bg-emerald-50 text-emerald-700 border border-emerald-200",
  "Risk":           "bg-orange-50 text-orange-600 border border-orange-200",
  "Info":           "bg-blue-50 text-blue-600 border border-blue-200",
};

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

function itemTitle(item: HandoffItem): string {
  if (item.ai_key_question && item.ai_key_question !== "None") return item.ai_key_question;
  if (item.ai_summary) return item.ai_summary;
  return "Feedback item";
}

// ─── Handoff card ─────────────────────────────────────────────────────────────

function HandoffCard({ item }: { item: HandoffItem }) {
  const href = item.project_id ? `/inbox/${item.project_id}/${item.id}` : "#";
  const statusCls  = STATUS_CLS[item.status] ?? STATUS_CLS.open;
  const classCls   = item.ai_classification ? (CLASS_CLS[item.ai_classification] ?? null) : null;

  const waitingCls = item.waiting_days > 7
    ? "text-red-600 bg-red-50 border border-red-200"
    : item.waiting_days > 3
    ? "text-amber-700 bg-amber-50 border border-amber-200"
    : "text-muted bg-surface border border-border";

  return (
    <Link
      href={href}
      className="block rounded-panel border border-border bg-paper p-4 hover:border-ink/20 transition-colors mb-2"
    >
      <p className="text-body font-medium text-ink line-clamp-2 leading-snug mb-2">
        {itemTitle(item)}
      </p>

      {/* Badges */}
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

      {/* Footer */}
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

// ─── Skeleton ────────────────────────────────────────────────────────────────

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

// ─── Main page ────────────────────────────────────────────────────────────────

export default function HandoffsPage() {
  const [handoffs, setHandoffs] = useState<HandoffItem[]>([]);
  const [loading,  setLoading]  = useState(true);

  useEffect(() => {
    fetch("/api/handoffs")
      .then(r => r.json())
      .then((d: { handoffs?: HandoffItem[] }) => {
        setHandoffs(d.handoffs ?? []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  // Group by owner_name
  const groups = new Map<string, HandoffItem[]>();
  for (const h of handoffs) {
    if (!groups.has(h.owner_name)) groups.set(h.owner_name, []);
    groups.get(h.owner_name)!.push(h);
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-paper">

      {/* Header */}
      <div className="px-6 pt-6 pb-5 border-b border-border shrink-0">
        <div className="flex items-center gap-2.5 mb-1">
          <ArrowRightLeft size={18} className="text-muted shrink-0" />
          <h1 className="text-title font-semibold text-ink">Handoffs</h1>
          {!loading && handoffs.length > 0 && (
            <span className="px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 text-[11px] font-bold border border-amber-100">
              {handoffs.length}
            </span>
          )}
        </div>
        <p className="text-body text-muted">Items waiting on a named owner</p>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 py-5">
        {loading ? (
          <HandoffSkeleton />
        ) : handoffs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 gap-3 text-center">
            <ArrowRightLeft size={32} className="text-wash" />
            <p className="text-lead font-medium text-ink">No handoffs pending</p>
            <p className="text-body text-muted max-w-xs">
              Items with assigned owners will appear here.
            </p>
          </div>
        ) : (
          <div className="space-y-6 fade-in">
            {Array.from(groups.entries()).map(([owner, items]) => (
              <div key={owner}>
                {/* Owner heading */}
                <div className="flex items-center gap-2 mb-3">
                  <span className="w-5 h-5 rounded-full bg-ink/10 flex items-center justify-center text-[9px] font-bold text-ink/50 shrink-0">
                    {owner.slice(0, 2).toUpperCase()}
                  </span>
                  <span className="text-body font-semibold text-ink">{owner}</span>
                  <span className="text-caption text-muted">
                    · {items.length} item{items.length !== 1 ? "s" : ""}
                  </span>
                </div>

                {/* Cards */}
                {items.map(item => <HandoffCard key={item.id} item={item} />)}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
