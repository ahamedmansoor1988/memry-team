"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, Search } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface AttentionItem {
  id: string;
  title: string;
  project_id: string | null;
  project_name: string | null;
  status: string;
  classification: string | null;
  risk: boolean;
}

interface RecentDecision {
  id: string;
  decision_text: string;
  owner_name: string | null;
  source: string;
  decided_at: string;
}

interface LinkedDiscussion {
  id: string;
  title: string;
  members: number;
  cross_source: boolean;
  href: string | null;
}

interface HomeData {
  linked_discussions?: LinkedDiscussion[];
  name: string;
  stats: {
    needs_review: number;
    risks: number;
    decisions_pending: number;
    updates_week: number;
    decisions_captured: number;
  };
  analyzed: {
    comments: number;
    slack_messages: number;
    meetings: number;
    files: number;
    risks_total: number;
    reconstructing: boolean;
  };
  attention: AttentionItem[];
  recent_decisions: RecentDecision[];
}

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

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

function attentionBadge(item: AttentionItem): { label: string; bg: string; color: string } {
  if (item.risk)
    return { label: "Risk detected", bg: "var(--red-soft)", color: "var(--red)" };
  if (item.status === "needs_decision" || item.classification === "Needs Decision")
    return { label: "Decision needed", bg: "var(--amber-soft)", color: "var(--amber)" };
  return { label: "Discussion detected", bg: "var(--blue-soft)", color: "var(--blue)" };
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function HomePage() {
  const router = useRouter();
  const [data, setData]       = useState<HomeData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/home")
      .then(r => r.json())
      .then((d: HomeData) => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const panelStyle: React.CSSProperties = {
    background: "var(--surface)", border: "1px solid var(--border)",
    borderRadius: 12, boxShadow: "var(--shadow-1)", overflow: "hidden",
  };

  return (
    <div className="min-h-full" style={{ background: "var(--bg)" }}>
      <div className="px-7 pt-6 pb-10 max-w-5xl">

        {/* ── Greeting ── */}
        <div className="mb-4">
          <h1 style={{ fontSize: 20, fontWeight: 600, color: "var(--text)", letterSpacing: "-0.02em" }}>
            {greeting()}, {data?.name ?? "…"} 👋
          </h1>
          <p style={{ fontSize: 13, color: "var(--text-2)", marginTop: 2 }}>
            Here&apos;s what Memry found while watching your tools.
          </p>
        </div>

        {/* ── Ask Memry — the front door to organizational memory ── */}
        <div style={{ marginBottom: 16 }}>
          <button
            onClick={() => router.push("/search")}
            style={{
              width: "100%", display: "flex", alignItems: "center", gap: 10,
              background: "var(--surface)", border: "1px solid var(--border)",
              borderRadius: 12, padding: "13px 16px", cursor: "pointer",
              boxShadow: "var(--shadow-2)", fontSize: 13, color: "var(--text-3)",
            }}
            className="hover:border-[var(--accent-border)] transition-colors"
          >
            <Search style={{ width: 14, height: 14, flexShrink: 0 }} />
            <span style={{ flex: 1, textAlign: "left" }}>Ask Memry anything about your work…</span>
            <kbd style={{ fontFamily: "var(--font-mono)", fontSize: 10, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 4, padding: "2px 6px" }}>⌘K</kbd>
          </button>
          <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
            {["What changed this week?", "What is still blocked?", "What did we decide about fonts?"].map(q => (
              <button
                key={q}
                onClick={() => router.push(`/search?q=${encodeURIComponent(q)}`)}
                style={{
                  fontSize: 11, color: "var(--text-2)", background: "var(--surface)",
                  border: "1px solid var(--border)", borderRadius: 99, padding: "4px 11px",
                  cursor: "pointer",
                }}
                className="hover:border-[var(--accent-border)] transition-colors"
              >
                {q}
              </button>
            ))}
          </div>
        </div>

        {/* ── Organizational memory band ── */}
        {loading || !data ? (
          <div className="skeleton" style={{ height: 76, borderRadius: 12, marginBottom: 20 }} />
        ) : (
          <div style={{
            background: "var(--accent)", color: "var(--accent-ink)",
            borderRadius: 12, padding: "16px 18px", marginBottom: 20,
            display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap",
          }}>
            <div style={{ flex: 1, minWidth: 220 }}>
              <p style={{ fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", opacity: 0.7, display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{
                  width: 7, height: 7, borderRadius: 99, flexShrink: 0,
                  background: data.analyzed.reconstructing ? "var(--amber)" : "#4ade80",
                }} className={data.analyzed.reconstructing ? "animate-pulse" : ""} />
                Organizational memory · {data.analyzed.reconstructing ? "reconstructing" : "live"}
              </p>
              <p style={{ fontSize: 13.5, marginTop: 6, lineHeight: 1.55 }}>
                {data.analyzed.reconstructing
                  ? <>Memry is analyzing your workspace — building memory from {data.analyzed.files.toLocaleString()} files and {data.analyzed.comments.toLocaleString()} comments…</>
                  : <>
                      Memry analyzed{" "}
                      <strong>{data.analyzed.files.toLocaleString()} files</strong>,{" "}
                      <strong>{data.analyzed.comments.toLocaleString()} Figma comments</strong>
                      {" "}and <strong>{data.analyzed.slack_messages.toLocaleString()} Slack messages</strong>
                      {data.analyzed.meetings > 0 && <> and <strong>{data.analyzed.meetings.toLocaleString()} meetings</strong></>}
                      {" "}— capturing <strong>{data.stats.decisions_captured} decisions</strong> and{" "}
                      <strong>{data.analyzed.risks_total} risks</strong> so far.
                    </>}
              </p>
            </div>
            {data.stats.updates_week > 0 && (
              <div style={{ textAlign: "right" }}>
                <p style={{ fontFamily: "var(--font-mono)", fontSize: 20, fontWeight: 600 }}>{data.stats.updates_week}</p>
                <p style={{ fontSize: 10.5, opacity: 0.7 }}>new findings this week</p>
              </div>
            )}
          </div>
        )}

        {/* ── Memry connected (Linker findings) ── */}
        {data && (data.linked_discussions?.length ?? 0) > 0 && (
          <div style={{ marginBottom: 20 }}>
            <p style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", marginBottom: 8 }}>
              Memry connected {data.linked_discussions!.filter(l => l.cross_source).length > 0
                ? "discussions across Figma and Slack"
                : "related discussions"}
            </p>
            <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, boxShadow: "var(--shadow-1)", overflow: "hidden" }}>
              {data.linked_discussions!.map(ld => (
                <div
                  key={ld.id}
                  onClick={() => ld.href && router.push(ld.href)}
                  style={{
                    display: "flex", alignItems: "center", gap: 10,
                    padding: "10px 14px", borderBottom: "1px solid var(--border-2)",
                    cursor: ld.href ? "pointer" : "default", transition: "background 0.1s",
                  }}
                  className="hover:bg-[var(--accent-softer)] last:border-0"
                >
                  <div style={{ width: 24, height: 24, borderRadius: 6, flexShrink: 0, background: "var(--blue-soft)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--blue)" strokeWidth="2.5" strokeLinecap="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
                  </div>
                  <p style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 500, color: "var(--text)" }} className="truncate">
                    {ld.title}
                  </p>
                  <span style={{
                    fontSize: 10.5, fontWeight: 500, flexShrink: 0,
                    background: ld.cross_source ? "var(--blue-soft)" : "var(--border-2)",
                    color: ld.cross_source ? "var(--blue)" : "var(--text-2)",
                    borderRadius: 99, padding: "2px 9px",
                  }}>
                    {ld.cross_source ? "Figma + Slack" : `${ld.members} linked`}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Two columns ── */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 20 }} className="max-md:!grid-cols-1">

          {/* Needs your attention */}
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <p style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>Memry needs your input</p>
              <Link href="/inbox" style={{ fontSize: 11, color: "var(--text-3)", textDecoration: "none" }} className="hover:text-[var(--text-2)]">
                View all →
              </Link>
            </div>
            <div style={panelStyle}>
              {loading || !data ? (
                <div style={{ padding: 16 }} className="space-y-3">
                  <div className="skeleton" style={{ height: 14, borderRadius: 4 }} />
                  <div className="skeleton" style={{ height: 14, borderRadius: 4, width: "80%" }} />
                  <div className="skeleton" style={{ height: 14, borderRadius: 4, width: "60%" }} />
                </div>
              ) : data.attention.length === 0 ? (
                <div style={{ padding: "32px 16px", textAlign: "center" }}>
                  <CheckCircle2 style={{ width: 22, height: 22, color: "var(--green)", margin: "0 auto 8px" }} />
                  <p style={{ fontSize: 12, color: "var(--text-2)" }}>All clear — nothing needs you right now.</p>
                </div>
              ) : (
                data.attention.map(item => {
                  const badge = attentionBadge(item);
                  const href = item.project_id ? `/inbox/${item.project_id}/${item.id}` : "/inbox";
                  return (
                    <div
                      key={item.id}
                      onClick={() => router.push(href)}
                      style={{
                        display: "flex", alignItems: "center", gap: 10,
                        padding: "10px 14px", borderBottom: "1px solid var(--border-2)",
                        cursor: "pointer", transition: "background 0.1s",
                      }}
                      className="hover:bg-[var(--accent-softer)] last:border-0"
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ fontSize: 12.5, fontWeight: 500, color: "var(--text)" }} className="truncate">{item.title}</p>
                        {item.project_name && (
                          <p style={{ fontSize: 11, color: "var(--text-3)", marginTop: 1 }} className="truncate">{item.project_name}</p>
                        )}
                      </div>
                      <span style={{
                        fontSize: 10.5, fontWeight: 500, whiteSpace: "nowrap", flexShrink: 0,
                        background: badge.bg, color: badge.color, borderRadius: 99, padding: "2px 9px",
                      }}>
                        {badge.label}
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Recent decisions */}
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <p style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>Decisions Memry captured</p>
              <Link href="/decisions" style={{ fontSize: 11, color: "var(--text-3)", textDecoration: "none" }} className="hover:text-[var(--text-2)]">
                View all →
              </Link>
            </div>
            <div style={panelStyle}>
              {loading || !data ? (
                <div style={{ padding: 16 }} className="space-y-3">
                  <div className="skeleton" style={{ height: 14, borderRadius: 4 }} />
                  <div className="skeleton" style={{ height: 14, borderRadius: 4, width: "75%" }} />
                </div>
              ) : data.recent_decisions.length === 0 ? (
                <div style={{ padding: "32px 16px", textAlign: "center" }}>
                  <p style={{ fontSize: 12, color: "var(--text-3)" }}>No decisions captured yet.</p>
                </div>
              ) : (
                data.recent_decisions.map(d => (
                  <div
                    key={d.id}
                    onClick={() => router.push("/decisions")}
                    style={{
                      display: "flex", alignItems: "center", gap: 10,
                      padding: "10px 14px", borderBottom: "1px solid var(--border-2)",
                      cursor: "pointer", transition: "background 0.1s",
                    }}
                    className="hover:bg-[var(--accent-softer)] last:border-0"
                  >
                    <div style={{ width: 24, height: 24, borderRadius: 6, flexShrink: 0, background: "var(--green-soft)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <CheckCircle2 style={{ width: 12, height: 12, color: "var(--green)" }} />
                    </div>
                    <p style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 500, color: "var(--text)" }} className="truncate">
                      {d.decision_text}
                    </p>
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-3)", flexShrink: 0 }}>
                      {timeAgo(d.decided_at)}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
