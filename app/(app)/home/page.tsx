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
            Here&apos;s what Memry figured out while you were away.
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

        {/* ── Intelligence briefing ── */}
        {loading || !data ? (
          <div className="skeleton" style={{ height: 120, borderRadius: 12, marginBottom: 20 }} />
        ) : (
          <div style={{
            background: "var(--surface)", border: "1px solid var(--border)",
            borderRadius: 12, marginBottom: 20, overflow: "hidden",
            boxShadow: "var(--shadow-1)",
          }}>
            {/* Section header */}
            <div style={{
              display: "flex", alignItems: "center", gap: 7, justifyContent: "space-between",
              padding: "10px 14px", borderBottom: "1px solid var(--border-2)",
              background: "var(--bg)",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/></svg>
                <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--text-3)" }}>
                  What Memry discovered
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <span style={{ width: 6, height: 6, borderRadius: 99, background: data.analyzed.reconstructing ? "var(--amber)" : "#4ade80", flexShrink: 0 }} className={data.analyzed.reconstructing ? "animate-pulse" : ""} />
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-3)" }}>
                  {data.analyzed.reconstructing ? "reconstructing" : "live"}
                </span>
              </div>
            </div>

            {/* Findings list */}
            {(() => {
              const findings: { icon: React.ReactNode; text: React.ReactNode; sub?: string; href?: string; color?: string; bg?: string }[] = [];

              // Cross-source links (highest value finding)
              const crossLinks = (data.linked_discussions ?? []).filter(l => l.cross_source);
              const sameSourceLinks = (data.linked_discussions ?? []).filter(l => !l.cross_source);

              crossLinks.forEach(ld => {
                findings.push({
                  icon: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>,
                  text: ld.title,
                  sub: "Connected across Figma and Slack",
                  href: ld.href ?? undefined,
                  color: "var(--blue)",
                  bg: "var(--blue-soft)",
                });
              });

              sameSourceLinks.forEach(ld => {
                findings.push({
                  icon: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>,
                  text: ld.title,
                  sub: `${ld.members} related discussions`,
                  href: ld.href ?? undefined,
                  color: "var(--blue)",
                  bg: "var(--blue-soft)",
                });
              });

              // Risks / blockers from attention
              const risks = data.attention.filter(i => i.risk || i.classification === "Blocked");
              if (risks.length > 0) {
                findings.push({
                  icon: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>,
                  text: risks.length === 1
                    ? <>Unresolved risk in <strong>{risks[0].project_name ?? "your workspace"}</strong></>
                    : <>{risks.length} risks detected that need attention</>,
                  sub: risks.map(r => r.title).slice(0, 2).join(" · "),
                  color: "var(--red)",
                  bg: "var(--red-soft)",
                });
              }

              // Decisions captured
              if (data.stats.decisions_captured > 0) {
                findings.push({
                  icon: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="m9 11 3 3L22 4"/></svg>,
                  text: <>{data.stats.decisions_captured} decision{data.stats.decisions_captured !== 1 ? "s" : ""} captured across your workspace</>,
                  sub: `From ${data.analyzed.files} files, ${data.analyzed.comments} Figma comments, ${data.analyzed.slack_messages} Slack messages`,
                  color: "var(--green)",
                  bg: "var(--green-soft)",
                });
              }

              // Needs attention (unresolved decisions)
              const pendingDecisions = data.attention.filter(i => !i.risk && i.classification === "Needs Decision");
              if (pendingDecisions.length > 0) {
                findings.push({
                  icon: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/></svg>,
                  text: <>{pendingDecisions.length} open question{pendingDecisions.length !== 1 ? "s" : ""} waiting for a decision</>,
                  color: "var(--amber)",
                  bg: "var(--amber-soft)",
                });
              }

              if (findings.length === 0) {
                return (
                  <div style={{ padding: "20px 14px", display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ width: 28, height: 28, borderRadius: 8, background: "var(--green-soft)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      <CheckCircle2 style={{ width: 14, height: 14, color: "var(--green)" }} />
                    </div>
                    <div>
                      <p style={{ fontSize: 13, fontWeight: 500, color: "var(--text)" }}>Everything looks clear</p>
                      <p style={{ fontSize: 11.5, color: "var(--text-3)", marginTop: 1 }}>
                        Memry found no risks or unresolved questions.
                        {data.analyzed.files > 0 && ` Watching ${data.analyzed.files} files.`}
                      </p>
                    </div>
                  </div>
                );
              }

              return findings.map((f, i) => (
                <div
                  key={i}
                  onClick={() => f.href && router.push(f.href)}
                  style={{
                    display: "flex", alignItems: "flex-start", gap: 10,
                    padding: "10px 14px", borderBottom: "1px solid var(--border-2)",
                    cursor: f.href ? "pointer" : "default", transition: "background 0.1s",
                  }}
                  className={`last:border-0 ${f.href ? "hover:bg-[var(--accent-softer)]" : ""}`}
                >
                  <div style={{
                    width: 26, height: 26, borderRadius: 7, flexShrink: 0, marginTop: 1,
                    background: f.bg ?? "var(--border-2)",
                    color: f.color ?? "var(--text-2)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}>
                    {f.icon}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 12.5, fontWeight: 500, color: "var(--text)", lineHeight: 1.4 }}>{f.text}</p>
                    {f.sub && <p style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2 }}>{f.sub}</p>}
                  </div>
                </div>
              ));
            })()}
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
