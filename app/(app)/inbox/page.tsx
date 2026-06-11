"use client";
import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw, Inbox as InboxIcon, AlertTriangle } from "lucide-react";
import { useAmbientSync } from "@/lib/hooks/useAmbientSync";

// ─── Types ────────────────────────────────────────────────────────────────────

interface InboxItem {
  id:                  string;
  status:              string;
  priority:            string;
  ai_classification:   string | null;
  ai_key_question:     string | null;
  ai_summary:          string | null;
  ai_risk_flag:        boolean | null;
  ai_suggested_action: string | null;
  owner_name:          string | null;
  project_id:          string | null;
  project_name:        string | null;
  created_at:          string;
  source:              string;
}

type FilterKey = "all" | "needs_decision" | "risks" | "open";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function timeAgo(date: string | null | undefined): string {
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

function itemTitle(item: InboxItem): string {
  if (item.ai_key_question && item.ai_key_question !== "None") return item.ai_key_question;
  return item.ai_summary ?? "Untitled signal";
}

// Status badge: blue = needs review (info), amber = needs decision (warning),
// red = blocked/high risk (error)
function statusBadge(item: InboxItem): { label: string; bg: string; color: string } {
  if (item.status === "blocked" || item.ai_classification === "Blocked")
    return { label: "Blocked", bg: "var(--red-soft)", color: "var(--red)" };
  if (item.ai_risk_flag)
    return { label: "High risk", bg: "var(--red-soft)", color: "var(--red)" };
  if (item.status === "needs_decision" || item.ai_classification === "Needs Decision")
    return { label: "Needs decision", bg: "var(--amber-soft)", color: "var(--amber)" };
  return { label: "Needs review", bg: "var(--blue-soft)", color: "var(--blue)" };
}

// ─── Source badge ─────────────────────────────────────────────────────────────

function SourceBadge({ source }: { source: string }) {
  // Figma is the only signal source today; Slack/Meet/Notion will slot in here.
  return (
    <div
      title={source === "figma" ? "Figma comment" : source}
      style={{
        width: 32, height: 32, borderRadius: 8, flexShrink: 0,
        background: "var(--surface)", border: "1px solid var(--border)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-2)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 5.5A3.5 3.5 0 0 1 8.5 2H12v7H8.5A3.5 3.5 0 0 1 5 5.5z" />
        <path d="M12 2h3.5a3.5 3.5 0 1 1 0 7H12V2z" />
        <path d="M12 12.5a3.5 3.5 0 1 1 7 0 3.5 3.5 0 1 1-7 0z" />
        <path d="M5 19.5A3.5 3.5 0 0 1 8.5 16H12v3.5a3.5 3.5 0 1 1-7 0z" />
        <path d="M5 12.5A3.5 3.5 0 0 1 8.5 9H12v7H8.5A3.5 3.5 0 0 1 5 12.5z" />
      </svg>
    </div>
  );
}

// ─── Row ──────────────────────────────────────────────────────────────────────

function ItemRow({ item }: { item: InboxItem }) {
  const router = useRouter();
  const badge  = statusBadge(item);
  const href   = item.project_id ? `/inbox/${item.project_id}/${item.id}` : "#";

  return (
    <div
      onClick={() => router.push(href)}
      style={{
        display: "flex", alignItems: "center", gap: 12,
        padding: "12px 16px",
        borderBottom: "1px solid var(--border-2)",
        cursor: "pointer",
        background: "var(--surface)",
        transition: "background 0.1s",
      }}
      className="hover:!bg-[var(--accent-softer)] last:border-0 group"
    >
      <SourceBadge source={item.source} />

      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: 13, fontWeight: 500, color: "var(--text)" }} className="truncate">
          {itemTitle(item)}
        </p>
        <p style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2 }} className="truncate">
          {item.project_name ?? "No project"}
          {item.owner_name && <> · {item.owner_name}</>}
          <> · {timeAgo(item.created_at)}</>
        </p>
      </div>

      <span style={{
        fontSize: 11, fontWeight: 500, whiteSpace: "nowrap", flexShrink: 0,
        background: badge.bg, color: badge.color,
        borderRadius: 99, padding: "3px 10px",
      }}>
        {badge.label}
      </span>
    </div>
  );
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function RowSkeleton() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", borderBottom: "1px solid var(--border-2)" }}>
      <div className="skeleton" style={{ width: 32, height: 32, borderRadius: 8, flexShrink: 0 }} />
      <div style={{ flex: 1 }}>
        <div className="skeleton" style={{ height: 13, width: "40%", borderRadius: 4, marginBottom: 6 }} />
        <div className="skeleton" style={{ height: 11, width: "25%", borderRadius: 4 }} />
      </div>
      <div className="skeleton" style={{ height: 22, width: 90, borderRadius: 99 }} />
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function InboxPage() {
  const [items, setItems]     = useState<InboxItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [filter, setFilter]   = useState<FilterKey>("all");

  useAmbientSync(() => { void loadItems(); });

  async function loadItems() {
    try {
      const res  = await fetch("/api/inbox");
      const data = await res.json() as { items?: InboxItem[] };
      setItems(data.items ?? []);
    } catch { /* keep current */ }
    finally { setLoading(false); }
  }

  useEffect(() => { void loadItems(); }, []);

  async function syncNow() {
    setSyncing(true); setSyncMsg(null);
    try {
      const res  = await fetch("/api/figma/pull", { method: "POST" });
      const data = await res.json() as { ok?: boolean; filesQueued?: number; skipped?: boolean; error?: string };
      if (data.error)        { setSyncMsg(data.error); }
      else if (data.skipped) { setSyncMsg("Sync already in progress"); }
      else {
        const n = data.filesQueued ?? 0;
        setSyncMsg(n > 0 ? `Syncing ${n} file${n !== 1 ? "s" : ""}…` : "Up to date");
        if (n > 0) setTimeout(() => void loadItems(), 12000);
      }
    } catch { setSyncMsg("Sync failed"); }
    finally  { setSyncing(false); }
  }

  const counts = useMemo(() => ({
    all:            items.length,
    needs_decision: items.filter(i => i.status === "needs_decision" || i.ai_classification === "Needs Decision").length,
    risks:          items.filter(i => i.ai_risk_flag || i.status === "blocked" || i.ai_classification === "Blocked").length,
    open:           items.filter(i => i.status === "open" && !i.ai_risk_flag && i.ai_classification !== "Needs Decision" && i.ai_classification !== "Blocked").length,
  }), [items]);

  const filtered = useMemo(() => {
    switch (filter) {
      case "needs_decision":
        return items.filter(i => i.status === "needs_decision" || i.ai_classification === "Needs Decision");
      case "risks":
        return items.filter(i => i.ai_risk_flag || i.status === "blocked" || i.ai_classification === "Blocked");
      case "open":
        return items.filter(i => i.status === "open" && !i.ai_risk_flag && i.ai_classification !== "Needs Decision" && i.ai_classification !== "Blocked");
      default:
        return items;
    }
  }, [items, filter]);

  const tabs: { key: FilterKey; label: string; count: number }[] = [
    { key: "all",            label: "All",            count: counts.all },
    { key: "open",           label: "Needs review",   count: counts.open },
    { key: "needs_decision", label: "Needs decision", count: counts.needs_decision },
    { key: "risks",          label: "Risks",          count: counts.risks },
  ];

  return (
    <div className="min-h-full" style={{ background: "var(--bg)" }}>
      <div className="px-7 pt-6 pb-10 max-w-4xl">

        {/* ── Header ── */}
        <div className="flex items-start justify-between mb-5">
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 600, color: "var(--text)", letterSpacing: "-0.02em" }}>Inbox</h1>
            <p style={{ fontSize: 13, color: "var(--text-2)", marginTop: 2 }}>
              Items captured from your connected tools that need your review.
              {syncMsg && <span style={{ color: "var(--text-3)" }}> · {syncMsg}</span>}
            </p>
          </div>
          <button
            onClick={syncNow}
            disabled={syncing}
            style={{
              display: "flex", alignItems: "center", gap: 8,
              background: "var(--surface)", border: "1px solid var(--border)",
              borderRadius: 8, padding: "7px 14px",
              fontSize: 12, fontWeight: 500, color: "var(--text-2)",
              cursor: "pointer", boxShadow: "var(--shadow-1)",
              opacity: syncing ? 0.6 : 1,
            }}
            className="hover:border-[var(--accent-border)] transition-colors"
          >
            <RefreshCw style={{ width: 13, height: 13 }} className={syncing ? "animate-spin" : ""} />
            {syncing ? "Syncing…" : "Sync now"}
          </button>
        </div>

        {/* ── Filter tabs ── */}
        <div style={{ display: "flex", gap: 4, marginBottom: 12 }}>
          {tabs.map(t => {
            const active = filter === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setFilter(t.key)}
                style={{
                  display: "flex", alignItems: "center", gap: 6,
                  padding: "5px 12px", borderRadius: 99,
                  fontSize: 12, fontWeight: active ? 600 : 400,
                  background: active ? "var(--accent)" : "transparent",
                  color: active ? "var(--accent-ink)" : "var(--text-2)",
                  border: active ? "1px solid var(--accent)" : "1px solid var(--border)",
                  cursor: "pointer", transition: "all 0.1s",
                }}
              >
                {t.label}
                <span style={{
                  fontFamily: "var(--font-mono)", fontSize: 10,
                  color: active ? "var(--accent-ink)" : "var(--text-3)",
                  opacity: active ? 0.8 : 1,
                }}>
                  {t.count}
                </span>
              </button>
            );
          })}
        </div>

        {/* ── List ── */}
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden", boxShadow: "var(--shadow-1)" }}>
          {loading ? (
            <>
              <RowSkeleton /><RowSkeleton /><RowSkeleton /><RowSkeleton />
            </>
          ) : filtered.length === 0 ? (
            <div style={{ padding: "56px 0", textAlign: "center" }}>
              {filter === "risks" ? (
                <AlertTriangle style={{ width: 28, height: 28, color: "var(--border)", margin: "0 auto 10px" }} />
              ) : (
                <InboxIcon style={{ width: 28, height: 28, color: "var(--border)", margin: "0 auto 10px" }} />
              )}
              <p style={{ fontSize: 14, fontWeight: 500, color: "var(--text)" }}>
                {items.length === 0 ? "Inbox zero" : "Nothing here"}
              </p>
              <p style={{ fontSize: 12, color: "var(--text-3)", marginTop: 4, maxWidth: 280, marginLeft: "auto", marginRight: "auto" }}>
                {items.length === 0
                  ? "New signals from Figma and Slack will appear here when they need your review."
                  : "No items match this filter."}
              </p>
              {items.length === 0 && (
                <button
                  onClick={syncNow}
                  disabled={syncing}
                  style={{
                    marginTop: 14, display: "inline-flex", alignItems: "center", gap: 8,
                    background: "var(--accent)", color: "var(--accent-ink)",
                    borderRadius: 8, padding: "8px 16px",
                    fontSize: 12, fontWeight: 500, border: "none", cursor: "pointer",
                    opacity: syncing ? 0.6 : 1,
                  }}
                >
                  {syncing ? <Loader2 style={{ width: 13, height: 13 }} className="animate-spin" /> : <RefreshCw style={{ width: 13, height: 13 }} />}
                  {syncing ? "Syncing…" : "Sync from Figma"}
                </button>
              )}
            </div>
          ) : (
            filtered.map(item => <ItemRow key={item.id} item={item} />)
          )}
        </div>

      </div>
    </div>
  );
}
