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

// ─── Row ──────────────────────────────────────────────────────────────────────

function ArchiveRow({ item, onRestore }: {
  item:      ArchivedItem;
  onRestore: (id: string) => void;
}) {
  const fc = item.figma_comment;
  const [restoring, setRestoring]       = useState(false);
  const [restoreError, setRestoreError] = useState(false);

  async function handleRestore() {
    setRestoring(true);
    setRestoreError(false);
    try {
      const res = await fetch(`/api/archive/${item.id}/restore`, { method: "POST" });
      if (res.ok) onRestore(item.id);
      else setRestoreError(true);
    } catch {
      setRestoreError(true);
    } finally {
      setRestoring(false);
    }
  }

  return (
    <div
      style={{
        display: "flex", alignItems: "center", gap: 12,
        padding: "12px 16px",
        borderBottom: "1px solid var(--border-2)",
        background: "var(--surface)",
      }}
      className="last:border-0 hover:bg-[var(--accent-softer)] transition-colors"
    >
      {/* Avatar */}
      <div style={{
        width: 32, height: 32, borderRadius: 99, flexShrink: 0,
        background: "var(--border-2)", color: "var(--text-3)",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 10, fontWeight: 700,
      }}>
        {initials(fc?.author_name)}
      </div>

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: 13, color: "var(--text-2)" }} className="truncate">
          {fc?.raw_content ?? <span style={{ fontStyle: "italic", color: "var(--text-3)" }}>No comment text</span>}
        </p>
        <p style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2 }} className="truncate">
          {fc?.author_name ?? "Unknown"}
          {item.project?.name && <> · {item.project.name}</>}
          {fc?.figma_file?.name && <> / {fc.figma_file.name}</>}
          <> · deleted {timeAgo(item.deleted_at)}</>
        </p>
      </div>

      {/* Classification pill */}
      {item.ai_classification && (
        <span style={{
          fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 500,
          color: "var(--text-2)", background: "var(--bg)",
          border: "1px solid var(--border)", borderRadius: 99,
          padding: "2px 8px", whiteSpace: "nowrap", flexShrink: 0,
        }}>
          {item.ai_classification}
        </span>
      )}

      {/* Restore */}
      <button
        onClick={handleRestore}
        disabled={restoring}
        style={{
          display: "inline-flex", alignItems: "center", gap: 5,
          fontSize: 11, fontWeight: 500, padding: "5px 10px", borderRadius: 7,
          border: `1px solid ${restoreError ? "color-mix(in oklab, var(--red) 30%, #ffffff)" : "var(--border)"}`,
          background: restoreError ? "var(--red-soft)" : "var(--surface)",
          color: restoreError ? "var(--red)" : "var(--text-2)",
          cursor: "pointer", flexShrink: 0,
          opacity: restoring ? 0.5 : 1,
        }}
        className="hover:border-[var(--accent-border)] transition-colors"
      >
        <RotateCcw style={{ width: 11, height: 11 }} className={restoring ? "animate-spin" : ""} />
        {restoring ? "Restoring…" : restoreError ? "Failed — retry" : "Restore"}
      </button>
    </div>
  );
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function RowSkeleton() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", borderBottom: "1px solid var(--border-2)" }}>
      <div className="skeleton" style={{ width: 32, height: 32, borderRadius: 99, flexShrink: 0 }} />
      <div style={{ flex: 1 }}>
        <div className="skeleton" style={{ height: 13, width: "55%", borderRadius: 4, marginBottom: 6 }} />
        <div className="skeleton" style={{ height: 11, width: "35%", borderRadius: 4 }} />
      </div>
      <div className="skeleton" style={{ height: 26, width: 70, borderRadius: 7 }} />
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function ArchivePage() {
  const [items, setItems]     = useState<ArchivedItem[]>([]);
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
      const pid   = item.project?.id ?? "unknown";
      const pname = item.project?.name ?? "Unknown project";
      if (!acc.has(pid)) acc.set(pid, { projectName: pname, items: [] });
      acc.get(pid)!.items.push(item);
      return acc;
    },
    new Map(),
  );

  return (
    <div className="min-h-full" style={{ background: "var(--bg)" }}>
      <div className="px-7 pt-6 pb-10 max-w-4xl">

        {/* ── Header ── */}
        <div className="mb-5">
          <h1 style={{ fontSize: 20, fontWeight: 600, color: "var(--text)", letterSpacing: "-0.02em" }}>Archive</h1>
          <p style={{ fontSize: 13, color: "var(--text-2)", marginTop: 2 }}>
            Comments deleted in Figma are preserved here — nothing is ever lost.
          </p>
        </div>

        {/* ── Content ── */}
        {loading ? (
          <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden", boxShadow: "var(--shadow-1)" }}>
            <RowSkeleton /><RowSkeleton /><RowSkeleton />
          </div>
        ) : items.length === 0 ? (
          <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, boxShadow: "var(--shadow-1)", padding: "56px 0", textAlign: "center" }}>
            <Archive style={{ width: 28, height: 28, color: "var(--border)", margin: "0 auto 10px" }} />
            <p style={{ fontSize: 14, fontWeight: 500, color: "var(--text)" }}>No deleted comments yet</p>
            <p style={{ fontSize: 12, color: "var(--text-3)", marginTop: 4, maxWidth: 280, marginLeft: "auto", marginRight: "auto" }}>
              When comments are removed in Figma, they&apos;ll be preserved here.
            </p>
          </div>
        ) : (
          <div className="space-y-6 fade-in">
            {Array.from(grouped.entries()).map(([pid, group]) => (
              <div key={pid}>
                <p style={{ fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-3)", marginBottom: 6, paddingLeft: 2 }}>
                  {group.projectName}
                  <span style={{ opacity: 0.6, marginLeft: 6 }}>{group.items.length}</span>
                </p>
                <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden", boxShadow: "var(--shadow-1)" }}>
                  {group.items.map(item => (
                    <ArchiveRow key={item.id} item={item} onRestore={handleRestore} />
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
