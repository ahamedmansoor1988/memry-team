"use client";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface FigmaComment {
  author_name:      string | null;
  raw_content:      string | null;
  figma_created_at: string | null;
}

interface BoardItem {
  id:                string;
  status:            string;
  priority:          string | null;
  ai_classification: string | null;
  ai_key_question:   string | null;
  ai_summary:        string | null;
  project_id:        string | null;
  project:           { id: string; name: string } | null;
  figma_comment:     FigmaComment | null;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const COLUMNS = [
  { key: "open",           label: "Open",           borderCls: "border-l-zinc-300",    badgeCls: "bg-zinc-100 text-zinc-600"           },
  { key: "needs_decision", label: "Needs Decision", borderCls: "border-l-zinc-400",   badgeCls: "bg-zinc-100 text-zinc-600"         },
  { key: "resolved",       label: "Resolved",       borderCls: "border-l-zinc-300", badgeCls: "bg-zinc-100 text-zinc-700"     },
] as const;

type ColKey = typeof COLUMNS[number]["key"];

const MOVES: Record<ColKey, ColKey[]> = {
  open:           ["needs_decision", "resolved"],
  needs_decision: ["open", "resolved"],
  resolved:       ["open"],
};

const MOVE_LABEL: Record<ColKey, string> = {
  open:           "Open",
  needs_decision: "Needs Decision",
  resolved:       "Resolved",
};

const PRIORITY_CLS: Record<string, string> = {
  high:   "bg-red-50 text-red-600 border border-red-200",
  medium: "bg-zinc-100 text-zinc-600 border border-zinc-200",
  low:    "bg-gray-100 text-gray-500 border border-gray-200",
};

const CLASS_CLS: Record<string, string> = {
  "Needs Decision": "bg-zinc-100 text-zinc-600 border border-zinc-200",
  "Blocked":        "bg-red-50 text-red-600 border border-red-200",
  "Approved":       "bg-zinc-100 text-zinc-700 border border-zinc-200",
  "Risk":           "bg-zinc-100 text-zinc-600 border border-zinc-200",
  "Vague":          "bg-zinc-100 text-zinc-600 border border-zinc-200",
  "Info":           "bg-zinc-100 text-zinc-600 border border-zinc-200",
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function timeAgo(date: string | null): string {
  if (!date) return "";
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

function cardTitle(item: BoardItem): string {
  if (item.ai_key_question && item.ai_key_question !== "None") return item.ai_key_question;
  if (item.ai_summary) return item.ai_summary;
  return item.figma_comment?.raw_content ?? "—";
}

// ─── Move dropdown ────────────────────────────────────────────────────────────

interface MoveDropdownProps {
  item:   BoardItem;
  onMove: (id: string, newStatus: ColKey) => void;
}

function MoveDropdown({ item, onMove }: MoveDropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const currentCol = item.status as ColKey;
  const targets = MOVES[currentCol] ?? [];

  useEffect(() => {
    if (!open) return;
    function close(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  if (targets.length === 0) return null;

  return (
    <div ref={ref} className="relative" onClick={e => e.stopPropagation()}>
      <button
        onClick={() => setOpen(v => !v)}
        className="inline-flex items-center gap-0.5 text-[10px] text-muted border border-border rounded px-1.5 py-0.5 hover:text-ink hover:border-ink/30 transition-colors bg-paper"
      >
        Move <ChevronDown size={9} />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-36 rounded-lg border border-border bg-paper shadow-lg z-30 py-1">
          {targets.map(t => (
            <button
              key={t}
              onClick={() => { onMove(item.id, t); setOpen(false); }}
              className="w-full text-left px-3 py-1.5 text-body text-muted hover:bg-surface hover:text-ink transition-colors"
            >
              {MOVE_LABEL[t]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Card ─────────────────────────────────────────────────────────────────────

interface CardProps {
  item:    BoardItem;
  onMove:  (id: string, newStatus: ColKey) => void;
  onClick: () => void;
}

function BoardCard({ item, onMove, onClick }: CardProps) {
  const title   = cardTitle(item);
  const classCls = item.ai_classification ? (CLASS_CLS[item.ai_classification] ?? null) : null;
  const priCls   = item.priority ? (PRIORITY_CLS[item.priority] ?? null) : null;
  const fc       = item.figma_comment;

  return (
    <div
      onClick={onClick}
      className="rounded-panel border border-border bg-paper p-3 cursor-pointer hover:border-ink/20 hover:shadow-sm transition-all select-none"
    >
      {/* Badges */}
      {(classCls || priCls) && (
        <div className="flex items-center gap-1.5 flex-wrap mb-2">
          {classCls && (
            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-wide ${classCls}`}>
              {item.ai_classification}
            </span>
          )}
          {priCls && (
            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-wide ${priCls}`}>
              {item.priority}
            </span>
          )}
        </div>
      )}

      {/* Title */}
      <p className="text-body font-medium text-ink line-clamp-2 leading-snug mb-2">{title}</p>

      {/* Project */}
      {item.project?.name && (
        <p className="text-caption text-muted mb-2 truncate">{item.project.name}</p>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between gap-2 mt-1">
        <div className="flex items-center gap-1.5 min-w-0">
          {fc?.author_name && (
            <span className="w-5 h-5 rounded-full bg-ink/10 flex items-center justify-center text-[8px] font-bold text-ink/50 shrink-0">
              {fc.author_name.slice(0, 2).toUpperCase()}
            </span>
          )}
          <span className="text-caption text-muted truncate">{fc?.author_name ?? "Unknown"}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {fc?.figma_created_at && (
            <span className="text-caption text-muted">{timeAgo(fc.figma_created_at)}</span>
          )}
          <MoveDropdown item={item} onMove={onMove} />
        </div>
      </div>
    </div>
  );
}

// ─── Skeleton ────────────────────────────────────────────────────────────────

function ColSkeleton() {
  return (
    <div className="space-y-2 p-3">
      {[1, 2, 3].map(n => (
        <div key={n} className="rounded-panel border border-border bg-paper p-3 space-y-2">
          <div className="flex gap-1.5">
            <div className="skeleton h-3.5 w-12 rounded-full" />
            <div className="skeleton h-3.5 w-10 rounded-full" />
          </div>
          <div className="skeleton h-4 w-full rounded" />
          <div className="skeleton h-3.5 w-3/4 rounded" />
          <div className="skeleton h-3 w-1/3 rounded" />
        </div>
      ))}
    </div>
  );
}

// ─── Column ───────────────────────────────────────────────────────────────────

interface ColumnProps {
  col:         typeof COLUMNS[number];
  items:       BoardItem[];
  loading:     boolean;
  onMove:      (id: string, newStatus: ColKey) => void;
  onClickItem: (item: BoardItem) => void;
}

function BoardColumn({ col, items, loading, onMove, onClickItem }: ColumnProps) {
  return (
    <div className={`flex flex-col h-full rounded-panel border border-border border-l-4 ${col.borderCls} bg-surface overflow-hidden`}>
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-3 border-b border-border shrink-0 bg-paper">
        <span className="text-body font-semibold text-ink">{col.label}</span>
        {!loading && (
          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${col.badgeCls}`}>
            {items.length}
          </span>
        )}
      </div>

      {/* Cards */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <ColSkeleton />
        ) : items.length === 0 ? (
          <div className="flex items-center justify-center h-24 text-caption text-muted">
            No items
          </div>
        ) : (
          <div className="p-3 space-y-2">
            {items.map(item => (
              <BoardCard
                key={item.id}
                item={item}
                onMove={onMove}
                onClick={() => onClickItem(item)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function BoardPage() {
  const router  = useRouter();
  const [items,   setItems]   = useState<BoardItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/feedback")
      .then(r => r.json())
      .then((d: { items?: BoardItem[] }) => {
        const raw = (d.items ?? []).map(item => ({
          ...item,
          // Normalise Supabase FK join — may be array or object
          project: Array.isArray(item.project) ? (item.project[0] ?? null) : item.project,
        }));
        setItems(raw);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  function handleMove(id: string, newStatus: ColKey) {
    // Optimistic update
    setItems(prev => prev.map(item => item.id === id ? { ...item, status: newStatus } : item));

    fetch(`/api/feedback/${id}/status`, {
      method:  "PATCH",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ status: newStatus }),
    }).catch(() => {
      // Revert: refetch on error
      fetch("/api/feedback")
        .then(r => r.json())
        .then((d: { items?: BoardItem[] }) => setItems(d.items ?? []))
        .catch(() => {});
    });
  }

  function handleClickItem(item: BoardItem) {
    const pid = item.project?.id ?? item.project_id;
    if (pid) router.push(`/inbox/${pid}/${item.id}`);
  }

  // Bucket items into columns; ignore archived/deleted
  const colItems: Record<ColKey, BoardItem[]> = { open: [], needs_decision: [], resolved: [] };
  for (const item of items) {
    const s = item.status as ColKey;
    if (s === "open" || s === "needs_decision" || s === "resolved") {
      colItems[s].push(item);
    }
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-paper">

      {/* Header */}
      <div className="px-6 pt-6 pb-5 border-b border-border shrink-0">
        <h1 className="text-title font-semibold text-ink mb-1">Board</h1>
        <p className="text-body text-muted">All feedback items by status</p>
      </div>

      {/* Board */}
      <div className="flex-1 overflow-hidden px-6 py-4">
        <div className="grid grid-cols-3 gap-4 h-full">
          {COLUMNS.map(col => (
            <BoardColumn
              key={col.key}
              col={col}
              items={colItems[col.key]}
              loading={loading}
              onMove={handleMove}
              onClickItem={handleClickItem}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
