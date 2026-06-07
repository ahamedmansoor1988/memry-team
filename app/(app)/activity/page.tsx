"use client";
import { useState, useEffect } from "react";
import { Activity } from "lucide-react";
import Link from "next/link";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ActivityEvent {
  id:                string;
  from_status:       string;
  to_status:         string;
  reason:            string | null;
  changed_by:        string | null;
  created_at:        string;
  item_id:           string | null;
  ai_key_question:   string | null;
  ai_summary:        string | null;
  ai_classification: string | null;
  project_id:        string | null;
  project_name:      string | null;
}

interface DateGroup {
  label:  string;
  events: ActivityEvent[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_CLS: Record<string, string> = {
  open:           "bg-blue-50 text-blue-600 border border-blue-200",
  needs_decision: "bg-amber-50 text-amber-700 border border-amber-200",
  resolved:       "bg-emerald-50 text-emerald-700 border border-emerald-200",
  archived:       "bg-gray-100 text-gray-500 border border-gray-200",
  deleted:        "bg-gray-100 text-gray-400 border border-gray-200",
};

const STATUS_LABEL: Record<string, string> = {
  open:           "Open",
  needs_decision: "Needs Decision",
  resolved:       "Resolved",
  archived:       "Archived",
  deleted:        "Deleted",
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

function toDateKey(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA");
}

function toDateLabel(key: string): string {
  const today     = new Date().toLocaleDateString("en-CA");
  const yesterday = new Date(Date.now() - 86400000).toLocaleDateString("en-CA");
  if (key === today)     return "Today";
  if (key === yesterday) return "Yesterday";
  return new Date(key + "T12:00:00").toLocaleDateString("en-US", { month: "long", day: "numeric" });
}

function groupByDate(events: ActivityEvent[]): DateGroup[] {
  const map = new Map<string, ActivityEvent[]>();
  for (const e of events) {
    const key = toDateKey(e.created_at);
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(e);
  }
  return Array.from(map.entries()).map(([key, evts]) => ({
    label:  toDateLabel(key),
    events: evts,
  }));
}

function itemTitle(e: ActivityEvent): string {
  if (e.ai_key_question && e.ai_key_question !== "None") return e.ai_key_question;
  if (e.ai_summary) return e.ai_summary;
  return "Feedback item";
}

// ─── Status badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const cls   = STATUS_CLS[status]   ?? STATUS_CLS.open;
  const label = STATUS_LABEL[status] ?? status;
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold ${cls}`}>
      {label}
    </span>
  );
}

// ─── Event card ───────────────────────────────────────────────────────────────

function EventCard({ event }: { event: ActivityEvent }) {
  const href = event.project_id && event.item_id
    ? `/inbox/${event.project_id}/${event.item_id}`
    : null;

  const inner = (
    <div className="rounded-panel border border-border bg-paper p-4 hover:border-ink/15 transition-colors">
      {/* Title */}
      <p className="text-body font-medium text-ink line-clamp-2 mb-2">
        {itemTitle(event)}
      </p>

      {/* Status transition */}
      <div className="flex items-center gap-1.5 flex-wrap mb-2">
        <StatusBadge status={event.from_status} />
        <span className="text-caption text-muted">→</span>
        <StatusBadge status={event.to_status} />
      </div>

      {/* Reason */}
      {event.reason && (
        <p className="text-caption text-muted italic mb-2 leading-relaxed">{event.reason}</p>
      )}

      {/* Footer */}
      <div className="flex items-center gap-2 flex-wrap">
        {event.project_name && (
          <span className="text-caption text-muted">{event.project_name}</span>
        )}
        <span className="text-caption text-muted ml-auto shrink-0">
          {timeAgo(event.created_at)}
        </span>
      </div>
    </div>
  );

  return href
    ? <Link href={href} className="block">{inner}</Link>
    : inner;
}

// ─── Skeleton ────────────────────────────────────────────────────────────────

function ActivitySkeleton() {
  return (
    <div className="space-y-2">
      {[1, 2, 3, 4, 5].map(n => (
        <div key={n} className="rounded-panel border border-border bg-paper p-4 space-y-2">
          <div className="skeleton h-4 w-2/3 rounded" />
          <div className="flex items-center gap-2">
            <div className="skeleton h-4 w-20 rounded" />
            <div className="skeleton h-3 w-3 rounded" />
            <div className="skeleton h-4 w-16 rounded" />
          </div>
          <div className="skeleton h-3 w-1/3 rounded" />
        </div>
      ))}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function ActivityPage() {
  const [events,  setEvents]  = useState<ActivityEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/activity?limit=100")
      .then(r => r.json())
      .then((d: { events?: ActivityEvent[] }) => {
        setEvents(d.events ?? []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const groups = groupByDate(events);

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-paper">

      {/* ── Header ── */}
      <div className="px-6 pt-6 pb-5 border-b border-border shrink-0">
        <div className="flex items-center gap-2.5 mb-1">
          <Activity size={18} className="text-muted shrink-0" />
          <h1 className="text-title font-semibold text-ink">Activity</h1>
          {!loading && events.length > 0 && (
            <span className="px-2 py-0.5 rounded-full bg-surface text-muted text-[11px] font-bold border border-border">
              {events.length}
            </span>
          )}
        </div>
        <p className="text-body text-muted">Status changes across your workspace</p>
      </div>

      {/* ── Content ── */}
      <div className="flex-1 overflow-y-auto px-6 py-5">
        {loading ? (
          <ActivitySkeleton />
        ) : events.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 gap-3 text-center">
            <Activity size={32} className="text-wash" />
            <p className="text-lead font-medium text-ink">No activity yet</p>
            <p className="text-body text-muted max-w-xs">
              Status changes will appear here as your team reviews feedback.
            </p>
          </div>
        ) : (
          <div className="space-y-8 fade-in">
            {groups.map(group => (
              <div key={group.label}>
                {/* Date heading */}
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-muted">
                    {group.label}
                  </span>
                  <span className="text-caption text-muted/60">
                    · {group.events.length} {group.events.length === 1 ? "event" : "events"}
                  </span>
                </div>

                {/* Event cards */}
                <div className="space-y-2">
                  {group.events.map(event => (
                    <EventCard key={event.id} event={event} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
