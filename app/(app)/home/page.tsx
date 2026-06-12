"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle, ShieldAlert, RefreshCw,
  CheckCircle2, Search, ChevronRight,
} from "lucide-react";

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

interface HomeData {
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
    return { label: "High risk", bg: "var(--red-soft)", color: "var(--red)" };
  if (item.status === "needs_decision" || item.classification === "Needs Decision")
    return { label: "Needs decision", bg: "var(--amber-soft)", color: "var(--amber)" };
  return { label: "Needs review", bg: "var(--blue-soft)", color: "var(--blue)" };
}

// ─── Stat card ────────────────────────────────────────────────────────────────

function StatCard({ icon, iconBg, iconColor, value, label }: {
  icon: React.ReactNode; iconBg: string; iconColor: string;
  value: number; label: string;
}) {
  return (
    <div style={{
      background: "var(--surface)", border: "1px solid var(--border)",
      borderRadius: 12, padding: "14px 16px", boxShadow: "var(--shadow-1)",
      display: "flex", alignItems: "center", gap: 12, flex: 1, minWidth: 0,
    }}>
      <div style={{
        width: 34, height: 34, borderRadius: 9, flexShrink: 0,
        background: iconBg, color: iconColor,
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        {icon}
      </div>
      <div style={{ minWidth: 0 }}>
        <p style={{ fontSize: 18, fontWeight: 600, color: "var(--text)", lineHeight: 1.1, fontFamily: "var(--font-mono)" }}>{value}</p>
        <p style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2 }} className="truncate">{label}</p>
      </div>
    </div>
  );
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
        <div className="mb-5">
          <h1 style={{ fontSize: 20, fontWeight: 600, color: "var(--text)", letterSpacing: "-0.02em" }}>
            {greeting()}, {data?.name ?? "…"} 👋
          </h1>
          <p style={{ fontSize: 13, color: "var(--text-2)", marginTop: 2 }}>
            Here&apos;s what Memry found while watching your tools.
          </p>
          {data && (
            <p style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "var(--text-3)", marginTop: 6 }}>
              Analyzed {data.analyzed.comments.toLocaleString()} Figma comments
              {" · "}{data.analyzed.slack_messages.toLocaleString()} Slack messages
              {data.analyzed.meetings > 0 && <>{" · "}{data.analyzed.meetings.toLocaleString()} meetings</>}
            </p>
          )}
        </div>

        {/* ── Stat cards ── */}
        <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
          {loading || !data ? (
            <>
              {[0, 1, 2, 3].map(i => (
                <div key={i} className="skeleton" style={{ height: 64, borderRadius: 12, flex: 1, minWidth: 140 }} />
              ))}
            </>
          ) : (
            <>
              <StatCard
                icon={<CheckCircle2 style={{ width: 15, height: 15 }} />}
                iconBg="var(--green-soft)" iconColor="var(--green)"
                value={data.stats.decisions_captured}
                label="Decisions captured"
              />
              <StatCard
                icon={<ShieldAlert style={{ width: 15, height: 15 }} />}
                iconBg="var(--red-soft)" iconColor="var(--red)"
                value={data.stats.risks}
                label="Risks detected"
              />
              <StatCard
                icon={<AlertTriangle style={{ width: 15, height: 15 }} />}
                iconBg="var(--amber-soft)" iconColor="var(--amber)"
                value={data.stats.needs_review + data.stats.decisions_pending}
                label="Discussions awaiting review"
              />
              <StatCard
                icon={<RefreshCw style={{ width: 15, height: 15 }} />}
                iconBg="var(--blue-soft)" iconColor="var(--blue)"
                value={data.stats.updates_week}
                label="New findings this week"
              />
            </>
          )}
        </div>

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

        {/* ── Ask Memry bar ── */}
        <button
          onClick={() => router.push("/search")}
          style={{
            width: "100%", display: "flex", alignItems: "center", gap: 10,
            background: "var(--surface)", border: "1px solid var(--border)",
            borderRadius: 12, padding: "13px 16px", cursor: "pointer",
            boxShadow: "var(--shadow-1)", fontSize: 13, color: "var(--text-3)",
          }}
          className="hover:border-[var(--accent-border)] transition-colors"
        >
          <Search style={{ width: 14, height: 14, flexShrink: 0 }} />
          <span style={{ flex: 1, textAlign: "left" }}>Ask Memry anything about your work…</span>
          <kbd style={{ fontFamily: "var(--font-mono)", fontSize: 10, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 4, padding: "2px 6px" }}>⌘K</kbd>
          <ChevronRight style={{ width: 13, height: 13, flexShrink: 0 }} />
        </button>

      </div>
    </div>
  );
}
