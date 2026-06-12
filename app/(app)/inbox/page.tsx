"use client";
import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw, Inbox as InboxIcon, SlidersHorizontal } from "lucide-react";
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
  owner_profile_id:    string | null;
  author_name:         string | null;
  project_id:          string | null;
  project_name:        string | null;
  created_at:          string;
  source:              string;
  topic_title:         string | null;
  topic_count:         number;
}

type FilterKey = "all" | "needs_review" | "suggested" | "mine";

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

function initials(name?: string | null): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

function isSuggested(item: InboxItem): boolean {
  return !!item.ai_suggested_action;
}

// Agent language: every badge says what Memry detected, not what data exists.
// blue = discussion, amber = decision needed, red = blocker/risk, green = decision detected
function statusBadge(item: InboxItem): { label: string; bg: string; color: string } {
  if (item.status === "blocked" || item.ai_classification === "Blocked")
    return { label: "Blocker detected", bg: "var(--red-soft)", color: "var(--red)" };
  if (item.ai_risk_flag)
    return { label: "Risk detected", bg: "var(--red-soft)", color: "var(--red)" };
  if (item.status === "needs_decision" || item.ai_classification === "Needs Decision")
    return { label: "Decision needed", bg: "var(--amber-soft)", color: "var(--amber)" };
  if (isSuggested(item))
    return { label: "Decision detected", bg: "var(--green-soft)", color: "var(--green)" };
  return { label: "Discussion detected", bg: "var(--blue-soft)", color: "var(--blue)" };
}

// ─── Source badge (brand colors, per kit) ─────────────────────────────────────

function FigmaMark() {
  return (
    <svg width="13" height="13" viewBox="0 0 38 57" fill="none">
      <path d="M19 28.5C19 23.8 22.8 20 27.5 20C32.2 20 36 23.8 36 28.5C36 33.2 32.2 37 27.5 37C22.8 37 19 33.2 19 28.5Z" fill="#1ABCFE"/>
      <path d="M2 46C2 41.3 5.8 37.5 10.5 37.5H19V46C19 50.7 15.2 54.5 10.5 54.5C5.8 54.5 2 50.7 2 46Z" fill="#0ACF83"/>
      <path d="M19 2V20H27.5C32.2 20 36 16.2 36 11.5C36 6.8 32.2 3 27.5 3H19V2Z" fill="#FF7262"/>
      <path d="M2 11.5C2 16.2 5.8 20 10.5 20H19V3H10.5C5.8 3 2 6.8 2 11.5Z" fill="#F24E1E"/>
      <path d="M2 28.5C2 33.2 5.8 37 10.5 37H19V20H10.5C5.8 20 2 23.8 2 28.5Z" fill="#A259FF"/>
    </svg>
  );
}

function SlackMark() {
  return (
    <svg width="13" height="13" viewBox="0 0 122.8 122.8">
      <path d="M25.8 77.6c0 7.1-5.8 12.9-12.9 12.9S0 84.7 0 77.6s5.8-12.9 12.9-12.9h12.9v12.9zm6.5 0c0-7.1 5.8-12.9 12.9-12.9s12.9 5.8 12.9 12.9v32.3c0 7.1-5.8 12.9-12.9 12.9s-12.9-5.8-12.9-12.9V77.6z" fill="#e01e5a"/>
      <path d="M45.2 25.8c-7.1 0-12.9-5.8-12.9-12.9S38.1 0 45.2 0s12.9 5.8 12.9 12.9v12.9H45.2zm0 6.5c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9H12.9C5.8 58.1 0 52.3 0 45.2s5.8-12.9 12.9-12.9h32.3z" fill="#36c5f0"/>
      <path d="M97 45.2c0-7.1 5.8-12.9 12.9-12.9s12.9 5.8 12.9 12.9-5.8 12.9-12.9 12.9H97V45.2zm-6.5 0c0 7.1-5.8 12.9-12.9 12.9s-12.9-5.8-12.9-12.9V12.9C64.7 5.8 70.5 0 77.6 0s12.9 5.8 12.9 12.9v32.3z" fill="#2eb67d"/>
      <path d="M77.6 97c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9-12.9-5.8-12.9-12.9V97h12.9zm0-6.5c-7.1 0-12.9-5.8-12.9-12.9s5.8-12.9 12.9-12.9h32.3c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9H77.6z" fill="#ecb22e"/>
    </svg>
  );
}

function SourceBadge({ source }: { source: string }) {
  return (
    <div
      title={source === "figma" ? "Figma comment" : source === "slack" ? "Slack message" : source}
      style={{
        width: 32, height: 32, borderRadius: 8, flexShrink: 0,
        background: "var(--surface)", border: "1px solid var(--border)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
    >
      {source === "slack" ? <SlackMark /> : <FigmaMark />}
    </div>
  );
}

// ─── Avatar stack ─────────────────────────────────────────────────────────────

const AVATAR_COLORS = ["#6366f1", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6"];

function colorFor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

function AvatarStack({ names }: { names: (string | null)[] }) {
  const valid = Array.from(new Set(names.filter((n): n is string => !!n))).slice(0, 3);
  if (valid.length === 0) return null;
  return (
    <div style={{ display: "flex", flexShrink: 0 }}>
      {valid.map((n, i) => (
        <div
          key={n}
          title={n}
          style={{
            width: 22, height: 22, borderRadius: 99,
            background: colorFor(n), color: "#fff",
            fontSize: 8, fontWeight: 700,
            display: "flex", alignItems: "center", justifyContent: "center",
            border: "2px solid var(--surface)",
            marginLeft: i === 0 ? 0 : -6,
          }}
        >
          {initials(n)}
        </div>
      ))}
    </div>
  );
}

// ─── Row ──────────────────────────────────────────────────────────────────────

function ItemRow({ item, checked, onCheck }: {
  item: InboxItem;
  checked: boolean;
  onCheck: (id: string, on: boolean) => void;
}) {
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
      <input
        type="checkbox"
        checked={checked}
        onClick={e => e.stopPropagation()}
        onChange={e => onCheck(item.id, e.target.checked)}
        style={{ width: 14, height: 14, accentColor: "var(--accent)", cursor: "pointer", flexShrink: 0 }}
      />

      <SourceBadge source={item.source} />

      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: 13, fontWeight: 500, color: "var(--text)" }} className="truncate">
          {itemTitle(item)}
        </p>
        <p style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2 }} className="truncate">
          {item.project_name ?? "No project"}
          <> · {item.source === "slack" ? "Slack" : "Figma"}</>
          <> · {timeAgo(item.created_at)}</>
        </p>
        {item.topic_title && (
          <span style={{
            display: "inline-flex", alignItems: "center", gap: 4, marginTop: 3,
            fontSize: 10, fontWeight: 500, color: "var(--blue)",
            background: "var(--blue-soft)", borderRadius: 99, padding: "1px 8px",
            maxWidth: "100%",
          }}>
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
            <span className="truncate">Linked discussion · {item.topic_title}</span>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, opacity: 0.8 }}>{item.topic_count}</span>
          </span>
        )}
      </div>

      <AvatarStack names={[item.author_name, item.owner_name]} />

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
      <div className="skeleton" style={{ width: 14, height: 14, borderRadius: 4, flexShrink: 0 }} />
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
  const [me, setMe]           = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [filter, setFilter]   = useState<FilterKey>("all");
  const [checked, setChecked] = useState<Set<string>>(new Set());

  useAmbientSync(() => { void loadItems(); });

  async function loadItems() {
    try {
      const res  = await fetch("/api/inbox");
      const data = await res.json() as { items?: InboxItem[]; me?: string | null };
      setItems(data.items ?? []);
      setMe(data.me ?? null);
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

  function handleCheck(id: string, on: boolean) {
    setChecked(prev => {
      const next = new Set(prev);
      if (on) next.add(id); else next.delete(id);
      return next;
    });
  }

  const counts = useMemo(() => ({
    all:          items.length,
    needs_review: items.filter(i => i.status === "open" && !isSuggested(i)).length,
    suggested:    items.filter(isSuggested).length,
    mine:         me ? items.filter(i => i.owner_profile_id === me).length : 0,
  }), [items, me]);

  const filtered = useMemo(() => {
    switch (filter) {
      case "needs_review": return items.filter(i => i.status === "open" && !isSuggested(i));
      case "suggested":    return items.filter(isSuggested);
      case "mine":         return me ? items.filter(i => i.owner_profile_id === me) : [];
      default:             return items;
    }
  }, [items, filter, me]);

  const tabs: { key: FilterKey; label: string; count: number }[] = [
    { key: "all",          label: "All",                 count: counts.all },
    { key: "needs_review", label: "Needs review",        count: counts.needs_review },
    { key: "suggested",    label: "Suggested decisions", count: counts.suggested },
    { key: "mine",         label: "Assigned to me",      count: counts.mine },
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
          <div style={{ display: "flex", gap: 8 }}>
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
            <button
              style={{
                display: "flex", alignItems: "center", gap: 7,
                background: "var(--surface)", border: "1px solid var(--border)",
                borderRadius: 8, padding: "7px 14px",
                fontSize: 12, fontWeight: 500, color: "var(--text-2)",
                cursor: "pointer", boxShadow: "var(--shadow-1)",
              }}
              className="hover:border-[var(--accent-border)] transition-colors"
            >
              <SlidersHorizontal style={{ width: 12, height: 12 }} />
              Filters
            </button>
          </div>
        </div>

        {/* ── Filter tabs ── */}
        <div style={{ display: "flex", gap: 4, marginBottom: 12, flexWrap: "wrap" }}>
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

        {/* ── Selection bar ── */}
        {checked.size > 0 && (
          <div style={{
            display: "flex", alignItems: "center", gap: 10, marginBottom: 8,
            fontSize: 12, color: "var(--text-2)",
          }} className="fade-in">
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>{checked.size} selected</span>
            <button
              onClick={() => setChecked(new Set())}
              style={{ fontSize: 11, color: "var(--text-3)", background: "none", border: "none", cursor: "pointer", textDecoration: "underline", textUnderlineOffset: 2 }}
            >
              Clear
            </button>
          </div>
        )}

        {/* ── List ── */}
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden", boxShadow: "var(--shadow-1)" }}>
          {loading ? (
            <>
              <RowSkeleton /><RowSkeleton /><RowSkeleton /><RowSkeleton />
            </>
          ) : filtered.length === 0 ? (
            <div style={{ padding: "56px 0", textAlign: "center" }}>
              <InboxIcon style={{ width: 28, height: 28, color: "var(--border)", margin: "0 auto 10px" }} />
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
            filtered.map(item => (
              <ItemRow key={item.id} item={item} checked={checked.has(item.id)} onCheck={handleCheck} />
            ))
          )}
        </div>

      </div>
    </div>
  );
}
