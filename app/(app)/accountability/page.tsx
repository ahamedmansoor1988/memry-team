"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle } from "lucide-react";
import { AccountabilityUrgency } from "@/lib/accountability/tracker";

// ─── Types ────────────────────────────────────────────────────────────────────

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

interface AccountabilityData {
  items: AccountabilityItem[];
  total: number;
}

// ─── Styling maps ─────────────────────────────────────────────────────────────

const URGENCY_BORDER: Record<AccountabilityUrgency, string> = {
  critical: "border-l-red-500",
  high:     "border-l-orange-400",
  medium:   "border-l-amber-400",
  low:      "border-l-gray-300",
  none:     "border-l-transparent",
};

const URGENCY_LABEL_CLS: Record<AccountabilityUrgency, string> = {
  critical: "bg-red-50 text-red-700",
  high:     "bg-orange-50 text-orange-700",
  medium:   "bg-amber-50 text-amber-700",
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
  high:     "text-orange-500",
  medium:   "text-amber-500",
  low:      "text-gray-400",
  none:     "text-gray-300",
};

const GROUP_ORDER: AccountabilityUrgency[] = ["critical", "high", "medium", "low"];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function timeAgo(date: string): string {
  const diff = Date.now() - new Date(date).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)  return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ─── Item row ─────────────────────────────────────────────────────────────────

interface ItemRowProps {
  item: AccountabilityItem;
  onClick: () => void;
}

function ItemRow({ item, onClick }: ItemRowProps) {
  const question = item.ai_key_question && item.ai_key_question !== "None"
    ? item.ai_key_question
    : item.ai_summary ?? "—";

  return (
    <button
      onClick={onClick}
      className={`
        w-full text-left border border-border bg-paper rounded-panel mb-2
        border-l-4 ${URGENCY_BORDER[item.urgency]}
        hover:bg-surface transition-colors
        p-4
      `}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-body font-medium text-ink line-clamp-2">{question}</p>
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            {item.project_name && (
              <span className="text-caption text-muted">{item.project_name}</span>
            )}
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
    </button>
  );
}

// ─── Skeleton ────────────────────────────────────────────────────────────────

function Skeleton() {
  return (
    <div className="space-y-2">
      {[1, 2, 3, 4, 5].map(n => (
        <div key={n} className="rounded-panel border border-border bg-paper p-4 border-l-4 border-l-gray-200">
          <div className="skeleton h-4 w-3/4 rounded mb-2" />
          <div className="skeleton h-3 w-1/3 rounded" />
        </div>
      ))}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function AccountabilityPage() {
  const router = useRouter();
  const [data, setData] = useState<AccountabilityData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/accountability")
      .then(r => r.json())
      .then((d: AccountabilityData) => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  function handleClick(item: AccountabilityItem) {
    if (item.project_id) {
      router.push(`/inbox/${item.project_id}/${item.id}`);
    }
  }

  // Group items by urgency
  const groups: Record<AccountabilityUrgency, AccountabilityItem[]> = {
    critical: [], high: [], medium: [], low: [], none: [],
  };
  if (data) {
    for (const item of data.items) {
      groups[item.urgency].push(item);
    }
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-paper">

      {/* Header */}
      <div className="px-6 pt-6 pb-5 border-b border-border shrink-0">
        <div className="flex items-center gap-2 mb-1">
          <AlertCircle size={18} className="text-muted shrink-0" />
          <h1 className="text-title font-semibold text-ink">Accountability</h1>
          {data && data.total > 0 && (
            <span className="ml-1 text-[11px] font-bold px-2 py-0.5 rounded-full bg-red-50 text-red-600">
              {data.total}
            </span>
          )}
        </div>
        <p className="text-body text-muted">Items that need follow-up, grouped by urgency</p>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 py-5">
        {loading ? (
          <Skeleton />
        ) : !data || data.items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 gap-2">
            <span className="text-2xl">✓</span>
            <p className="text-body text-muted font-medium">All caught up</p>
            <p className="text-caption text-muted">No items require follow-up right now.</p>
          </div>
        ) : (
          <div className="space-y-6 fade-in">
            {GROUP_ORDER.filter(u => groups[u].length > 0).map(urgency => (
              <div key={urgency}>
                {/* Group heading */}
                <div className="flex items-center gap-2 mb-3">
                  <span className={`text-[10px] font-bold uppercase tracking-widest ${URGENCY_HEADING_CLS[urgency]}`}>
                    {URGENCY_HEADING[urgency]}
                  </span>
                  <span className="text-caption text-muted">
                    {groups[urgency].length} item{groups[urgency].length !== 1 ? "s" : ""}
                  </span>
                </div>

                {/* Item rows */}
                {groups[urgency].map(item => (
                  <ItemRow
                    key={item.id}
                    item={item}
                    onClick={() => handleClick(item)}
                  />
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
