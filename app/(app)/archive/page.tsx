"use client";
import { useState, useEffect, useCallback } from "react";
import { Archive, RotateCcw } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface FigmaFile { name: string; }
interface FigmaComment {
  author_name: string | null;
  raw_content: string | null;
  figma_created_at: string | null;
  figma_file: FigmaFile | null;
}
interface ArchivedItem {
  id: string;
  deleted_at: string;
  ai_classification: string | null;
  status: string;
  created_at: string;
  figma_comment: FigmaComment | null;
  project: { id: string; name: string } | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function timeAgo(date: string | null): string {
  if (!date) return "—";
  const diff = Date.now() - new Date(date).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function initials(name?: string | null): string {
  if (!name) return "?";
  return name.split(/\s+/).map(w => w[0]?.toUpperCase() ?? "").slice(0, 2).join("");
}

const CLASSIFICATION_CLS: Record<string, string> = {
  "Needs Decision": "text-red-500 bg-red-50 border-red-200",
  "Blocked":        "text-red-500 bg-red-50 border-red-200",
  "Approved":       "text-emerald-600 bg-emerald-50 border-emerald-200",
  "Risk":           "text-orange-500 bg-orange-50 border-orange-200",
  "Vague":          "text-yellow-600 bg-yellow-50 border-yellow-200",
  "Info":           "text-blue-500 bg-blue-50 border-blue-200",
};

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function ItemSkeleton() {
  return (
    <div className="rounded-panel border border-border bg-paper p-4 space-y-3">
      <div className="flex items-start gap-3">
        <div className="skeleton w-8 h-8 rounded-full shrink-0" />
        <div className="flex-1 space-y-2 pt-0.5">
          <div className="skeleton h-3.5 w-2/5 rounded" />
          <div className="skeleton h-3 w-4/5 rounded" />
          <div className="skeleton h-3 w-3/5 rounded" />
        </div>
      </div>
    </div>
  );
}

// ─── Item Card ────────────────────────────────────────────────────────────────

interface ArchiveItemCardProps {
  item:      ArchivedItem;
  onRestore: (id: string) => void;
}

function ArchiveItemCard({ item, onRestore }: ArchiveItemCardProps) {
  const fc = item.figma_comment;
  const classCls = item.ai_classification
    ? CLASSIFICATION_CLS[item.ai_classification] ?? "text-muted bg-wash border-border"
    : null;

  const [restoring, setRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState(false);

  async function handleRestore() {
    setRestoring(true);
    setRestoreError(false);
    try {
      const res = await fetch(`/api/archive/${item.id}/restore`, { method: "POST" });
      if (res.ok) {
        onRestore(item.id);
      } else {
        setRestoreError(true);
      }
    } catch {
      setRestoreError(true);
    } finally {
      setRestoring(false);
    }
  }

  return (
    <div className="rounded-panel border border-border bg-paper p-4 hover:border-ink/15 transition-colors">
      <div className="flex items-start justify-between gap-3">
        {/* Left: avatar + content */}
        <div className="flex items-start gap-3 flex-1 min-w-0">
          {/* Avatar */}
          <span className="w-8 h-8 rounded-full bg-ink/10 text-ink/50 flex items-center justify-center text-[10px] font-bold shrink-0 select-none">
            {initials(fc?.author_name)}
          </span>

          <div className="flex-1 min-w-0">
            {/* Author + deleted time */}
            <div className="flex items-center gap-2 mb-1">
              <span className="text-body font-semibold text-ink">
                {fc?.author_name ?? "Unknown"}
              </span>
              <span className="text-caption text-muted">
                deleted {timeAgo(item.deleted_at)}
              </span>
            </div>

            {/* Comment text */}
            <p className="text-body text-ink/80 leading-relaxed line-clamp-2 mb-2">
              {fc?.raw_content ?? <span className="italic text-muted">No comment text</span>}
            </p>

            {/* Breadcrumb */}
            <div className="flex items-center gap-1 text-caption text-muted">
              <svg width="8" height="11" viewBox="0 0 38 57" fill="none" className="shrink-0 opacity-40">
                <path d="M19 28.5C19 23.8 22.8 20 27.5 20C32.2 20 36 23.8 36 28.5C36 33.2 32.2 37 27.5 37C22.8 37 19 33.2 19 28.5Z" fill="#1ABCFE"/>
                <path d="M2 46C2 41.3 5.8 37.5 10.5 37.5H19V46C19 50.7 15.2 54.5 10.5 54.5C5.8 54.5 2 50.7 2 46Z" fill="#0ACF83"/>
                <path d="M19 2V20H27.5C32.2 20 36 16.2 36 11.5C36 6.8 32.2 3 27.5 3H19V2Z" fill="#FF7262"/>
                <path d="M2 11.5C2 16.2 5.8 20 10.5 20H19V3H10.5C5.8 3 2 6.8 2 11.5Z" fill="#F24E1E"/>
                <path d="M2 28.5C2 33.2 5.8 37 10.5 37H19V20H10.5C5.8 20 2 23.8 2 28.5Z" fill="#FF7262"/>
              </svg>
              {item.project?.name && <span>{item.project.name}</span>}
              {fc?.figma_file?.name && (
                <><span className="opacity-40">/</span><span>{fc.figma_file.name}</span></>
              )}
            </div>
          </div>
        </div>

        {/* Right: AI badge + restore */}
        <div className="flex flex-col items-end gap-2 shrink-0">
          {classCls && item.ai_classification && (
            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${classCls}`}>
              {item.ai_classification}
            </span>
          )}
          <button
            onClick={handleRestore}
            disabled={restoring}
            className={`inline-flex items-center gap-1 text-caption border border-border rounded px-2 py-1 transition-colors disabled:opacity-40
              ${restoreError
                ? "text-red-500 border-red-200 hover:bg-red-50"
                : "text-muted hover:text-ink hover:bg-surface"
              }`}
          >
            <RotateCcw size={10} className={restoring ? "animate-spin" : ""} />
            {restoring ? "Restoring…" : restoreError ? "Failed — retry" : "Restore"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function ArchivePage() {
  const [items, setItems] = useState<ArchivedItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/archive")
      .then(r => r.json())
      .then((d: { items?: ArchivedItem[] }) => {
        setItems(d.items ?? []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const handleRestore = useCallback((id: string) => {
    setItems(prev => prev.filter(item => item.id !== id));
  }, []);

  // Group by project
  const grouped = items.reduce<Map<string, { projectName: string; items: ArchivedItem[] }>>(
    (acc, item) => {
      const pid = item.project?.id ?? "unknown";
      const pname = item.project?.name ?? "Unknown Project";
      if (!acc.has(pid)) acc.set(pid, { projectName: pname, items: [] });
      acc.get(pid)!.items.push(item);
      return acc;
    },
    new Map(),
  );

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-paper">

      {/* ── Header ── */}
      <div className="px-6 pt-6 pb-5 border-b border-border shrink-0">
        <h1 className="text-title font-semibold text-ink mb-1">Archive</h1>
        <p className="text-body text-muted">
          Comments deleted in Figma are preserved here.
        </p>
      </div>

      {/* ── Content ── */}
      <div className="flex-1 overflow-y-auto px-6 py-5">
        {loading ? (
          <div className="space-y-2">
            <ItemSkeleton /><ItemSkeleton /><ItemSkeleton />
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 gap-3 text-center">
            <Archive size={32} className="text-wash" />
            <p className="text-lead font-medium text-ink">No deleted comments yet</p>
            <p className="text-body text-muted max-w-xs">
              When comments are removed in Figma, they&apos;ll be preserved here.
            </p>
          </div>
        ) : (
          <div className="space-y-8 fade-in">
            {Array.from(grouped.entries()).map(([pid, group]) => (
              <div key={pid}>
                {/* Project header */}
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-muted">
                    {group.projectName}
                  </span>
                  <span className="text-caption text-muted/60">
                    · {group.items.length} {group.items.length === 1 ? "comment" : "comments"}
                  </span>
                </div>

                {/* Item cards */}
                <div className="space-y-2">
                  {group.items.map(item => (
                    <ArchiveItemCard key={item.id} item={item} onRestore={handleRestore} />
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
