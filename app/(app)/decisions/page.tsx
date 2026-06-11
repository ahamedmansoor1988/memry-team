"use client";
import { useState, useEffect, useMemo } from "react";
import {
  CheckCircle2, ExternalLink, Search, ChevronDown, ChevronRight,
  Plus, Hash, ListChecks,
} from "lucide-react";
import Link from "next/link";

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

function ownerInitials(name: string | null): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

const SOURCE_LABEL: Record<string, string> = {
  slack:  "Slack",
  ai:     "Feedback",
  manual: "Manual",
};

// ─── Outcome form ─────────────────────────────────────────────────────────────

function OutcomeForm({ decisionId, onSave, onCancel }: {
  decisionId: string;
  onSave: (outcome: string, alternatives: string[]) => void;
  onCancel: () => void;
}) {
  const [outcomeText, setOutcomeText] = useState("");
  const [altsText,    setAltsText]    = useState("");
  const [saving,      setSaving]      = useState(false);

  async function handleSave() {
    const outcome      = outcomeText.trim();
    const alternatives = altsText.split(",").map(s => s.trim()).filter(Boolean);
    if (!outcome) return;
    setSaving(true);
    try {
      await fetch(`/api/decisions/${decisionId}/outcome`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ outcome, alternatives }),
      });
      onSave(outcome, alternatives);
    } finally {
      setSaving(false);
    }
  }

  const inputStyle: React.CSSProperties = {
    width: "100%", padding: "8px 10px", fontSize: 12,
    borderRadius: 8, border: "1px solid var(--border)",
    background: "var(--bg)", color: "var(--text)", outline: "none",
  };

  return (
    <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--border-2)" }} className="space-y-2">
      <textarea
        value={outcomeText}
        onChange={e => setOutcomeText(e.target.value)}
        placeholder="What actually happened? How did this play out?"
        rows={3}
        style={{ ...inputStyle, resize: "none" }}
      />
      <input
        type="text"
        value={altsText}
        onChange={e => setAltsText(e.target.value)}
        placeholder="Alternatives considered: Option A, Option B"
        style={inputStyle}
      />
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <button onClick={onCancel} style={{ fontSize: 11, color: "var(--text-3)", background: "none", border: "none", cursor: "pointer", padding: "4px 8px" }}>
          Cancel
        </button>
        <button
          onClick={handleSave}
          disabled={saving || !outcomeText.trim()}
          style={{
            fontSize: 11, fontWeight: 500, padding: "5px 12px", borderRadius: 7,
            background: "var(--accent)", color: "var(--accent-ink)", border: "none",
            cursor: "pointer", opacity: saving || !outcomeText.trim() ? 0.4 : 1,
          }}
        >
          {saving ? "Saving…" : "Save outcome"}
        </button>
      </div>
    </div>
  );
}

// ─── Decision row ─────────────────────────────────────────────────────────────

function DecisionRow({ decision, onUpdate }: {
  decision: DecisionItem;
  onUpdate: (id: string, patch: Partial<DecisionItem>) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [showForm, setShowForm] = useState(false);

  const feedbackLink = decision.project_id && decision.feedback_item_id
    ? `/inbox/${decision.project_id}/${decision.feedback_item_id}`
    : null;

  const hasDetail = !!(decision.reason || decision.outcome
    || (decision.alternatives?.length) || feedbackLink || decision.slack_thread_url);

  return (
    <div style={{ borderBottom: "1px solid var(--border-2)" }} className="last:border-0">
      {/* Main row */}
      <div
        onClick={() => hasDetail && setExpanded(e => !e)}
        style={{
          display: "flex", alignItems: "center", gap: 12,
          padding: "12px 16px",
          cursor: hasDetail ? "pointer" : "default",
          background: "var(--surface)",
          transition: "background 0.1s",
        }}
        className="hover:!bg-[var(--accent-softer)] group"
      >
        {/* Decided disc — green = success */}
        <div style={{
          width: 32, height: 32, borderRadius: 8, flexShrink: 0,
          background: "var(--green-soft)",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <CheckCircle2 style={{ width: 15, height: 15, color: "var(--green)" }} />
        </div>

        {/* Text */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: 13, fontWeight: 500, color: "var(--text)" }} className="truncate">
            {decision.decision_text}
          </p>
          <p style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2, display: "flex", alignItems: "center", gap: 5 }} className="truncate">
            {decision.owner_name && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                <span style={{
                  width: 14, height: 14, borderRadius: 99, background: "var(--border)",
                  fontSize: 7, fontWeight: 700, color: "var(--text-2)",
                  display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                }}>
                  {ownerInitials(decision.owner_name)}
                </span>
                {decision.owner_name}
              </span>
            )}
            {decision.source === "slack" && decision.slack_channel_name ? (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 2 }}>
                <Hash style={{ width: 10, height: 10 }} />{decision.slack_channel_name}
              </span>
            ) : decision.project_name ? (
              <span>{decision.project_name}</span>
            ) : null}
            <span>· {timeAgo(decision.decided_at)}</span>
          </p>
        </div>

        {/* Source pill */}
        <span style={{
          fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 500,
          color: "var(--text-2)", background: "var(--bg)",
          border: "1px solid var(--border)", borderRadius: 99,
          padding: "2px 8px", whiteSpace: "nowrap", flexShrink: 0,
        }}>
          {SOURCE_LABEL[decision.source] ?? decision.source}
        </span>

        {/* Status pill — decided = green */}
        <span style={{
          fontSize: 11, fontWeight: 500, whiteSpace: "nowrap", flexShrink: 0,
          background: "var(--green-soft)", color: "var(--green)",
          borderRadius: 99, padding: "3px 10px",
        }}>
          Decided
        </span>

        {hasDetail && (
          <ChevronRight
            style={{
              width: 14, height: 14, color: "var(--text-3)", flexShrink: 0,
              transform: expanded ? "rotate(90deg)" : "none",
              transition: "transform 0.15s",
            }}
          />
        )}
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div style={{ padding: "0 16px 14px 60px", background: "var(--surface)" }} className="fade-in">
          {decision.reason && (
            <div style={{ marginBottom: 10 }}>
              <p style={{ fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-3)", marginBottom: 3 }}>
                Rationale
              </p>
              <p style={{ fontSize: 12, color: "var(--text-2)", lineHeight: 1.6 }}>{decision.reason}</p>
            </div>
          )}

          {decision.outcome && (
            <div style={{
              background: "var(--green-soft)", border: "1px solid color-mix(in oklab, var(--green) 20%, #ffffff)",
              borderRadius: 8, padding: "8px 12px", marginBottom: 10,
            }}>
              <p style={{ fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--green)", marginBottom: 3 }}>
                Outcome
              </p>
              <p style={{ fontSize: 12, color: "var(--text)", lineHeight: 1.6 }}>{decision.outcome}</p>
            </div>
          )}

          {decision.alternatives && decision.alternatives.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              <p style={{ fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-3)", marginBottom: 3 }}>
                Alternatives considered
              </p>
              <ul>
                {decision.alternatives.map((alt, i) => (
                  <li key={i} style={{ fontSize: 12, color: "var(--text-2)", display: "flex", gap: 6, lineHeight: 1.6 }}>
                    <span style={{ opacity: 0.4 }}>·</span>{alt}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Actions */}
          <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
            {feedbackLink && (
              <Link
                href={feedbackLink}
                onClick={e => e.stopPropagation()}
                style={{ fontSize: 11, color: "var(--blue)", display: "inline-flex", alignItems: "center", gap: 4, textDecoration: "none" }}
                className="hover:underline"
              >
                <ExternalLink style={{ width: 10, height: 10 }} />
                View context
              </Link>
            )}
            {decision.slack_thread_url && (
              <a
                href={decision.slack_thread_url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={e => e.stopPropagation()}
                style={{ fontSize: 11, color: "var(--blue)", display: "inline-flex", alignItems: "center", gap: 4, textDecoration: "none" }}
                className="hover:underline"
              >
                <ExternalLink style={{ width: 10, height: 10 }} />
                Open Slack thread
              </a>
            )}
            {!decision.outcome && !showForm && (
              <button
                onClick={e => { e.stopPropagation(); setShowForm(true); }}
                style={{ fontSize: 11, color: "var(--text-3)", background: "none", border: "none", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4, padding: 0 }}
                className="hover:text-[var(--text-2)]"
              >
                <Plus style={{ width: 10, height: 10 }} />
                Add outcome
              </button>
            )}
          </div>

          {showForm && (
            <OutcomeForm
              decisionId={decision.id}
              onSave={(outcome, alternatives) => {
                onUpdate(decision.id, { outcome, alternatives });
                setShowForm(false);
              }}
              onCancel={() => setShowForm(false)}
            />
          )}
        </div>
      )}
    </div>
  );
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function RowSkeleton() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", borderBottom: "1px solid var(--border-2)" }}>
      <div className="skeleton" style={{ width: 32, height: 32, borderRadius: 8, flexShrink: 0 }} />
      <div style={{ flex: 1 }}>
        <div className="skeleton" style={{ height: 13, width: "45%", borderRadius: 4, marginBottom: 6 }} />
        <div className="skeleton" style={{ height: 11, width: "30%", borderRadius: 4 }} />
      </div>
      <div className="skeleton" style={{ height: 22, width: 70, borderRadius: 99 }} />
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function DecisionsPage() {
  const [data,    setData]    = useState<TimelineData | null>(null);
  const [loading, setLoading] = useState(true);
  const [search,  setSearch]  = useState("");
  const [sourceFilter,  setSourceFilter]  = useState<SourceFilter>("all");
  const [projectFilter, setProjectFilter] = useState<string>("all");
  const [showProjectMenu, setShowProjectMenu] = useState(false);

  function handleUpdate(id: string, patch: Partial<DecisionItem>) {
    setData(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        timeline: prev.timeline.map(group => ({
          ...group,
          decisions: group.decisions.map(d => d.id === id ? { ...d, ...patch } : d),
        })),
      };
    });
  }

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

  // Flatten timeline groups into one chronological list
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
    { key: "all",    label: "All",    count: counts.all },
    { key: "slack",  label: "Slack",  count: counts.slack },
    { key: "ai",     label: "Feedback", count: counts.ai },
    { key: "manual", label: "Manual", count: counts.manual },
  ];

  return (
    <div className="min-h-full" style={{ background: "var(--bg)" }}>
      <div className="px-7 pt-6 pb-10 max-w-4xl">

        {/* ── Header ── */}
        <div className="mb-5">
          <h1 style={{ fontSize: 20, fontWeight: 600, color: "var(--text)", letterSpacing: "-0.02em" }}>Decisions</h1>
          <p style={{ fontSize: 13, color: "var(--text-2)", marginTop: 2 }}>
            Every decision captured across Figma and Slack — your organizational record.
          </p>
        </div>

        {/* ── Filters ── */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
          {/* Source tabs */}
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
            {/* Search */}
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

            {/* Project filter */}
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

        {/* ── List ── */}
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden", boxShadow: "var(--shadow-1)" }}>
          {loading ? (
            <>
              <RowSkeleton /><RowSkeleton /><RowSkeleton /><RowSkeleton />
            </>
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
              {allDecisions.length > 0 && (
                <button
                  onClick={() => { setSearch(""); setSourceFilter("all"); setProjectFilter("all"); }}
                  style={{ marginTop: 10, fontSize: 12, color: "var(--text-2)", textDecoration: "underline", textUnderlineOffset: 2, background: "none", border: "none", cursor: "pointer" }}
                >
                  Clear filters
                </button>
              )}
            </div>
          ) : (
            filtered.map(d => <DecisionRow key={d.id} decision={d} onUpdate={handleUpdate} />)
          )}
        </div>

        {/* Count footer */}
        {!loading && filtered.length > 0 && (
          <p style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-3)", marginTop: 10, textAlign: "right" }}>
            {filtered.length} of {allDecisions.length} decisions
          </p>
        )}

      </div>
    </div>
  );
}
