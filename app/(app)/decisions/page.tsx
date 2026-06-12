"use client";
import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Search, ChevronDown, ListChecks } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface DecisionItem {
  id:                 string;
  decision_text:      string;
  reason:             string | null;
  owner_name:         string | null;
  source:             string;
  decided_at:         string;
  feedback_item_id:   string | null;
  project_id:         string | null;
  project_name:       string | null;
  ai_key_question:    string | null;
  outcome:            string | null;
  alternatives:       string[] | null;
  slack_channel_name: string | null;
  slack_thread_url:   string | null;
}

interface TimelineGroup {
  date:      string;
  label:     string;
  decisions: DecisionItem[];
}

interface TimelineData {
  timeline: TimelineGroup[];
  total:    number;
  projects: { id: string; name: string }[];
}

type SourceFilter = "all" | "slack" | "ai" | "manual";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function shortDate(date: string): string {
  return new Date(date).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function initials(name: string | null): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

const AVATAR_COLORS = ["#6366f1", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6"];
function colorFor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

// ─── Source marks ─────────────────────────────────────────────────────────────

function FigmaMark({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 38 57" fill="none">
      <path d="M19 28.5C19 23.8 22.8 20 27.5 20C32.2 20 36 23.8 36 28.5C36 33.2 32.2 37 27.5 37C22.8 37 19 33.2 19 28.5Z" fill="#1ABCFE"/>
      <path d="M2 46C2 41.3 5.8 37.5 10.5 37.5H19V46C19 50.7 15.2 54.5 10.5 54.5C5.8 54.5 2 50.7 2 46Z" fill="#0ACF83"/>
      <path d="M19 2V20H27.5C32.2 20 36 16.2 36 11.5C36 6.8 32.2 3 27.5 3H19V2Z" fill="#FF7262"/>
      <path d="M2 11.5C2 16.2 5.8 20 10.5 20H19V3H10.5C5.8 3 2 6.8 2 11.5Z" fill="#F24E1E"/>
      <path d="M2 28.5C2 33.2 5.8 37 10.5 37H19V20H10.5C5.8 20 2 23.8 2 28.5Z" fill="#A259FF"/>
    </svg>
  );
}

function SlackMark({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 122.8 122.8">
      <path d="M25.8 77.6c0 7.1-5.8 12.9-12.9 12.9S0 84.7 0 77.6s5.8-12.9 12.9-12.9h12.9v12.9zm6.5 0c0-7.1 5.8-12.9 12.9-12.9s12.9 5.8 12.9 12.9v32.3c0 7.1-5.8 12.9-12.9 12.9s-12.9-5.8-12.9-12.9V77.6z" fill="#e01e5a"/>
      <path d="M45.2 25.8c-7.1 0-12.9-5.8-12.9-12.9S38.1 0 45.2 0s12.9 5.8 12.9 12.9v12.9H45.2zm0 6.5c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9H12.9C5.8 58.1 0 52.3 0 45.2s5.8-12.9 12.9-12.9h32.3z" fill="#36c5f0"/>
      <path d="M97 45.2c0-7.1 5.8-12.9 12.9-12.9s12.9 5.8 12.9 12.9-5.8 12.9-12.9 12.9H97V45.2zm-6.5 0c0 7.1-5.8 12.9-12.9 12.9s-12.9-5.8-12.9-12.9V12.9C64.7 5.8 70.5 0 77.6 0s12.9 5.8 12.9 12.9v32.3z" fill="#2eb67d"/>
      <path d="M77.6 97c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9-12.9-5.8-12.9-12.9V97h12.9zm0-6.5c-7.1 0-12.9-5.8-12.9-12.9s5.8-12.9 12.9-12.9h32.3c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9H77.6z" fill="#ecb22e"/>
    </svg>
  );
}

function SourceIcons({ d }: { d: DecisionItem }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
      {d.source === "slack" && <SlackMark />}
      {(d.source === "ai" || d.feedback_item_id) && <FigmaMark />}
      {d.source === "manual" && !d.feedback_item_id && (
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--text-3)" }}>manual</span>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function DecisionsPage() {
  const router = useRouter();
  const [data,    setData]    = useState<TimelineData | null>(null);
  const [loading, setLoading] = useState(true);
  const [search,  setSearch]  = useState("");
  const [sourceFilter,  setSourceFilter]  = useState<SourceFilter>("all");
  const [projectFilter, setProjectFilter] = useState<string>("all");
  const [showProjectMenu, setShowProjectMenu] = useState(false);

  useEffect(() => {
    fetch("/api/decisions/timeline")
      .then(r => r.json())
      .then((d: TimelineData) => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!showProjectMenu) return;
    const handler = () => setShowProjectMenu(false);
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [showProjectMenu]);

  const allDecisions = useMemo<DecisionItem[]>(
    () => (data?.timeline ?? []).flatMap(g => g.decisions),
    [data],
  );

  const counts = useMemo(() => ({
    all:    allDecisions.length,
    slack:  allDecisions.filter(d => d.source === "slack").length,
    ai:     allDecisions.filter(d => d.source === "ai").length,
    manual: allDecisions.filter(d => d.source === "manual").length,
  }), [allDecisions]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allDecisions.filter(d => {
      const matchesSource  = sourceFilter === "all" || d.source === sourceFilter;
      const matchesProject = projectFilter === "all" || d.project_id === projectFilter;
      const matchesSearch  = !q
        || d.decision_text.toLowerCase().includes(q)
        || (d.reason ?? "").toLowerCase().includes(q);
      return matchesSource && matchesProject && matchesSearch;
    });
  }, [allDecisions, sourceFilter, projectFilter, search]);

  const selectedProjectName =
    projectFilter === "all"
      ? "All projects"
      : (data?.projects.find(p => p.id === projectFilter)?.name ?? "All projects");

  const tabs: { key: SourceFilter; label: string; count: number }[] = [
    { key: "all",    label: "All",      count: counts.all },
    { key: "slack",  label: "Slack",    count: counts.slack },
    { key: "ai",     label: "Feedback", count: counts.ai },
    { key: "manual", label: "Manual",   count: counts.manual },
  ];

  const colHeader: React.CSSProperties = {
    fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 600,
    letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-3)",
  };

  return (
    <div className="min-h-full" style={{ background: "var(--bg)" }}>
      <div className="px-7 pt-6 pb-10 max-w-5xl">

        {/* ── Header ── */}
        <div className="mb-5">
          <h1 style={{ fontSize: 20, fontWeight: 600, color: "var(--text)", letterSpacing: "-0.02em" }}>Decisions</h1>
          <p style={{ fontSize: 13, color: "var(--text-2)", marginTop: 2 }}>
            All decisions across your organization.
          </p>
        </div>

        {/* ── Filters ── */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
          <div style={{ display: "flex", gap: 4 }}>
            {tabs.map(t => {
              const active = sourceFilter === t.key;
              return (
                <button
                  key={t.key}
                  onClick={() => setSourceFilter(t.key)}
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
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: active ? "var(--accent-ink)" : "var(--text-3)", opacity: active ? 0.8 : 1 }}>
                    {t.count}
                  </span>
                </button>
              );
            })}
          </div>

          <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            <div style={{ position: "relative" }}>
              <Search style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)", width: 12, height: 12, color: "var(--text-3)", pointerEvents: "none" }} />
              <input
                type="text"
                placeholder="Search decisions…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                style={{
                  width: 180, padding: "6px 10px 6px 28px", fontSize: 12,
                  borderRadius: 8, border: "1px solid var(--border)",
                  background: "var(--surface)", color: "var(--text)", outline: "none",
                }}
              />
            </div>

            {(data?.projects.length ?? 0) > 0 && (
              <div style={{ position: "relative" }}>
                <button
                  onClick={e => { e.stopPropagation(); setShowProjectMenu(v => !v); }}
                  style={{
                    display: "flex", alignItems: "center", gap: 6,
                    padding: "6px 12px", borderRadius: 8,
                    border: "1px solid var(--border)", background: "var(--surface)",
                    fontSize: 12, color: "var(--text-2)", cursor: "pointer",
                  }}
                >
                  <span style={{ maxWidth: 120 }} className="truncate">{selectedProjectName}</span>
                  <ChevronDown style={{ width: 12, height: 12, color: "var(--text-3)", flexShrink: 0 }} />
                </button>
                {showProjectMenu && (
                  <div style={{
                    position: "absolute", right: 0, top: "100%", marginTop: 4, width: 192,
                    borderRadius: 10, border: "1px solid var(--border)", background: "var(--surface)",
                    boxShadow: "var(--shadow-2)", zIndex: 20, padding: "4px 0",
                  }}>
                    <button
                      onClick={() => { setProjectFilter("all"); setShowProjectMenu(false); }}
                      style={{
                        width: "100%", textAlign: "left", padding: "6px 12px", fontSize: 12,
                        background: "none", border: "none", cursor: "pointer",
                        fontWeight: projectFilter === "all" ? 600 : 400,
                        color: projectFilter === "all" ? "var(--text)" : "var(--text-2)",
                      }}
                      className="hover:bg-[var(--accent-softer)]"
                    >
                      All projects
                    </button>
                    {data?.projects.map(p => (
                      <button
                        key={p.id}
                        onClick={() => { setProjectFilter(p.id); setShowProjectMenu(false); }}
                        style={{
                          width: "100%", textAlign: "left", padding: "6px 12px", fontSize: 12,
                          background: "none", border: "none", cursor: "pointer",
                          fontWeight: projectFilter === p.id ? 600 : 400,
                          color: projectFilter === p.id ? "var(--text)" : "var(--text-2)",
                        }}
                        className="hover:bg-[var(--accent-softer)] truncate"
                      >
                        {p.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── Table ── */}
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden", boxShadow: "var(--shadow-1)" }}>

          {/* Column header */}
          <div style={{
            display: "flex", alignItems: "center", gap: 12,
            padding: "8px 16px", borderBottom: "1px solid var(--border-2)",
            background: "var(--bg)",
          }}>
            <span style={{ ...colHeader, flex: 1 }}>Decision + Memry&apos;s analysis</span>
            <span style={{ ...colHeader, width: 110 }} className="max-md:hidden">Project</span>
            <span style={{ ...colHeader, width: 60 }} className="max-sm:hidden">Date</span>
            <span style={{ ...colHeader, width: 70, textAlign: "center" }}>Status</span>
            <span style={{ ...colHeader, width: 56, textAlign: "center" }} className="max-md:hidden">Sources</span>
          </div>

          {loading ? (
            <div style={{ padding: 16 }} className="space-y-4">
              {[0, 1, 2, 3].map(i => (
                <div key={i} className="skeleton" style={{ height: 18, borderRadius: 4 }} />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div style={{ padding: "56px 0", textAlign: "center" }}>
              <ListChecks style={{ width: 28, height: 28, color: "var(--border)", margin: "0 auto 10px" }} />
              <p style={{ fontSize: 14, fontWeight: 500, color: "var(--text)" }}>
                {allDecisions.length === 0 ? "No decisions yet" : "Nothing matches"}
              </p>
              <p style={{ fontSize: 12, color: "var(--text-3)", marginTop: 4, maxWidth: 300, marginLeft: "auto", marginRight: "auto" }}>
                {allDecisions.length === 0
                  ? "Decisions are captured automatically from Slack and recorded when feedback is resolved."
                  : "Try adjusting your filters or search."}
              </p>
            </div>
          ) : (
            filtered.map(d => (
              <div
                key={d.id}
                onClick={() => router.push(`/decisions/${d.id}`)}
                style={{
                  display: "flex", alignItems: "center", gap: 12,
                  padding: "11px 16px",
                  borderBottom: "1px solid var(--border-2)",
                  cursor: "pointer",
                  transition: "background 0.1s",
                }}
                className="hover:bg-[var(--accent-softer)] last:border-0"
              >
                {/* Decision + rationale */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 13, fontWeight: 500, color: "var(--text)" }} className="truncate">
                    {d.decision_text}
                  </p>
                  {(d.reason || d.ai_key_question) && (
                    <p style={{ fontSize: 11, color: "var(--text-2)", marginTop: 2, display: "flex", alignItems: "center", gap: 4 }} className="truncate">
                      <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/></svg>
                      <span className="truncate">{d.reason ?? d.ai_key_question}</span>
                    </p>
                  )}
                  {!d.reason && !d.ai_key_question && (
                    <p style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2 }}>
                      No rationale captured
                    </p>
                  )}
                  {!d.owner_name && (
                    <p style={{ fontSize: 10.5, color: "var(--amber)", marginTop: 2, display: "flex", alignItems: "center", gap: 3 }}>
                      <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" style={{ flexShrink: 0 }}><circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/></svg>
                      No owner assigned
                    </p>
                  )}
                </div>

                {/* Project */}
                <span style={{ width: 110, fontSize: 11.5, color: "var(--text-2)" }} className="truncate max-md:hidden">
                  {d.project_name ?? (d.slack_channel_name ? `#${d.slack_channel_name}` : "—")}
                </span>

                {/* Date */}
                <span style={{ width: 60, fontFamily: "var(--font-mono)", fontSize: 10.5, color: "var(--text-3)" }} className="max-sm:hidden">
                  {shortDate(d.decided_at)}
                </span>

                {/* Status */}
                <span style={{ width: 70, display: "flex", justifyContent: "center" }}>
                  <span style={{
                    fontSize: 10.5, fontWeight: 500,
                    background: "var(--green-soft)", color: "var(--green)",
                    borderRadius: 99, padding: "2px 9px", whiteSpace: "nowrap",
                  }}>
                    Decided
                  </span>
                </span>

                {/* Sources */}
                <span style={{ width: 56, display: "flex", justifyContent: "center" }} className="max-md:hidden">
                  <SourceIcons d={d} />
                </span>
              </div>
            ))
          )}
        </div>

        {!loading && filtered.length > 0 && (
          <p style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-3)", marginTop: 10, textAlign: "right" }}>
            {filtered.length} of {allDecisions.length} decisions
          </p>
        )}

      </div>
    </div>
  );
}
