"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Search, CheckCircle2, Sparkles, Loader2 } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface SearchResult {
  id:                string;
  status:            string;
  ai_classification: string | null;
  ai_key_question:   string | null;
  ai_summary:        string | null;
  priority:          string | null;
  ai_risk_flag:      boolean | null;
  updated_at:        string;
  project_id:        string | null;
  project_name:      string | null;
  raw_content:       string | null;
  author_name:       string | null;
}

interface DecisionResult {
  id:                 string;
  decision_text:      string;
  reason:             string | null;
  owner_name:         string | null;
  source:             string;
  decided_at:         string;
  feedback_item_id:   string | null;
  project_id:         string | null;
  slack_channel_name: string | null;
  slack_thread_url:   string | null;
}

interface Answer {
  answer:     string | null;
  key_points: string[];
}

type Tab = "all" | "items" | "decisions";

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

function itemStatusBadge(r: SearchResult): { label: string; bg: string; color: string } {
  if (r.status === "blocked" || r.ai_classification === "Blocked")
    return { label: "Blocked", bg: "var(--red-soft)", color: "var(--red)" };
  if (r.ai_risk_flag)
    return { label: "High risk", bg: "var(--red-soft)", color: "var(--red)" };
  if (r.status === "resolved")
    return { label: "Resolved", bg: "var(--green-soft)", color: "var(--green)" };
  if (r.status === "archived")
    return { label: "Archived", bg: "var(--border-2)", color: "var(--text-3)" };
  if (r.status === "needs_decision" || r.ai_classification === "Needs Decision")
    return { label: "Needs decision", bg: "var(--amber-soft)", color: "var(--amber)" };
  return { label: "Open", bg: "var(--blue-soft)", color: "var(--blue)" };
}

const EXAMPLE_QUERIES = [
  "What did we decide about fonts?",
  "Why was the launch moved?",
  "What is still blocked?",
];

// ─── Main page ────────────────────────────────────────────────────────────────

export default function SearchPage() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  const [query, setQuery]         = useState("");
  const [results, setResults]     = useState<SearchResult[]>([]);
  const [decisions, setDecisions] = useState<DecisionResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched]   = useState(false);
  const [tab, setTab]             = useState<Tab>("all");

  const [answer, setAnswer]             = useState<Answer | null>(null);
  const [answerLoading, setAnswerLoading] = useState(false);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const runSearch = useCallback(async (q: string) => {
    const trimmed = q.trim();
    if (!trimmed) { setResults([]); setDecisions([]); setSearched(false); setAnswer(null); return; }

    setSearching(true);
    setAnswer(null);

    // Fire the AI answer in parallel for question-like queries
    const wantAnswer = trimmed.split(/\s+/).length >= 3;
    if (wantAnswer) {
      setAnswerLoading(true);
      fetch("/api/search/answer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ q: trimmed }),
      })
        .then(r => r.json())
        .then((d: Answer) => setAnswer(d.answer ? d : null))
        .catch(() => setAnswer(null))
        .finally(() => setAnswerLoading(false));
    }

    try {
      const res  = await fetch(`/api/search?q=${encodeURIComponent(trimmed)}`);
      const data = await res.json() as { results?: SearchResult[]; decisions?: DecisionResult[] };
      setResults(data.results ?? []);
      setDecisions(data.decisions ?? []);
      setSearched(true);
    } catch {
      setResults([]); setDecisions([]);
    } finally {
      setSearching(false);
    }
  }, []);

  // Debounced search-as-you-type
  useEffect(() => {
    const t = setTimeout(() => { void runSearch(query); }, 350);
    return () => clearTimeout(t);
  }, [query, runSearch]);

  const totalCount = results.length + decisions.length;

  const showItems     = tab === "all" || tab === "items";
  const showDecisions = tab === "all" || tab === "decisions";

  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: "all",       label: "All",       count: totalCount },
    { key: "decisions", label: "Decisions", count: decisions.length },
    { key: "items",     label: "Signals",   count: results.length },
  ];

  return (
    <div className="min-h-full" style={{ background: "var(--bg)" }}>
      <div className="px-7 pt-6 pb-10 max-w-3xl mx-auto">

        {/* ── Search input ── */}
        <div style={{ position: "relative", marginBottom: 16 }}>
          <Search style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", width: 16, height: 16, color: "var(--text-3)", pointerEvents: "none" }} />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Ask Memry anything about your work…"
            style={{
              width: "100%", padding: "13px 90px 13px 40px", fontSize: 14,
              borderRadius: 12, border: "1px solid var(--border)",
              background: "var(--surface)", color: "var(--text)",
              outline: "none", boxShadow: "var(--shadow-1)",
            }}
          />
          {searching && (
            <Loader2 style={{ position: "absolute", right: 56, top: "50%", transform: "translateY(-50%)", width: 14, height: 14, color: "var(--text-3)" }} className="animate-spin" />
          )}
          <kbd style={{
            position: "absolute", right: 14, top: "50%", transform: "translateY(-50%)",
            fontFamily: "var(--font-mono)", fontSize: 10, background: "var(--bg)",
            border: "1px solid var(--border)", borderRadius: 4, padding: "2px 6px", color: "var(--text-3)",
          }}>⌘K</kbd>
        </div>

        {/* ── Empty state with example queries ── */}
        {!searched && !searching && (
          <div style={{ textAlign: "center", paddingTop: 48 }}>
            <Search style={{ width: 28, height: 28, color: "var(--border)", margin: "0 auto 12px" }} />
            <p style={{ fontSize: 14, fontWeight: 500, color: "var(--text)" }}>Search your organizational memory</p>
            <p style={{ fontSize: 12, color: "var(--text-3)", marginTop: 4 }}>
              Decisions, signals, and discussions — across Figma and Slack.
            </p>
            <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 18, flexWrap: "wrap" }}>
              {EXAMPLE_QUERIES.map(ex => (
                <button
                  key={ex}
                  onClick={() => setQuery(ex)}
                  style={{
                    fontSize: 12, color: "var(--text-2)", background: "var(--surface)",
                    border: "1px solid var(--border)", borderRadius: 99, padding: "6px 14px",
                    cursor: "pointer", boxShadow: "var(--shadow-1)",
                  }}
                  className="hover:border-[var(--accent-border)] transition-colors"
                >
                  {ex}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── AI answer card (blue = information) ── */}
        {(answerLoading || answer) && searched && (
          <div style={{
            background: "var(--blue-soft)",
            border: "1px solid color-mix(in oklab, var(--blue) 20%, #ffffff)",
            borderRadius: 12, padding: "14px 16px", marginBottom: 16,
          }} className="fade-in">
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
              <Sparkles style={{ width: 12, height: 12, color: "var(--blue)" }} />
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--blue)" }}>
                Answer
              </span>
            </div>
            {answerLoading ? (
              <div className="space-y-2">
                <div className="skeleton" style={{ height: 13, width: "85%", borderRadius: 4 }} />
                <div className="skeleton" style={{ height: 13, width: "60%", borderRadius: 4 }} />
              </div>
            ) : answer && (
              <>
                <p style={{ fontSize: 13, color: "var(--text)", lineHeight: 1.6 }}>{answer.answer}</p>
                {answer.key_points.length > 0 && (
                  <ul style={{ marginTop: 8 }}>
                    {answer.key_points.map((p, i) => (
                      <li key={i} style={{ fontSize: 12, color: "var(--text-2)", display: "flex", gap: 6, lineHeight: 1.7 }}>
                        <span style={{ color: "var(--blue)", flexShrink: 0 }}>·</span>{p}
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>
        )}

        {/* ── Result tabs ── */}
        {searched && totalCount > 0 && (
          <div style={{ display: "flex", gap: 4, marginBottom: 12 }}>
            {tabs.map(t => {
              const active = tab === t.key;
              return (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
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
        )}

        {/* ── No results ── */}
        {searched && totalCount === 0 && !searching && (
          <div style={{ textAlign: "center", paddingTop: 40 }}>
            <p style={{ fontSize: 13, color: "var(--text-2)" }}>No results for &ldquo;{query}&rdquo;</p>
            <p style={{ fontSize: 12, color: "var(--text-3)", marginTop: 4 }}>Try different keywords or a broader question.</p>
          </div>
        )}

        {/* ── Decision results ── */}
        {showDecisions && decisions.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <p style={{ fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-3)", marginBottom: 6, paddingLeft: 2 }}>
              Decisions
            </p>
            <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden", boxShadow: "var(--shadow-1)" }}>
              {decisions.map(d => (
                <div
                  key={d.id}
                  onClick={() => router.push("/decisions")}
                  style={{
                    display: "flex", alignItems: "center", gap: 12,
                    padding: "11px 16px", borderBottom: "1px solid var(--border-2)",
                    cursor: "pointer", transition: "background 0.1s",
                  }}
                  className="hover:bg-[var(--accent-softer)] last:border-0"
                >
                  <div style={{ width: 28, height: 28, borderRadius: 7, flexShrink: 0, background: "var(--green-soft)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <CheckCircle2 style={{ width: 13, height: 13, color: "var(--green)" }} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 13, fontWeight: 500, color: "var(--text)" }} className="truncate">{d.decision_text}</p>
                    <p style={{ fontSize: 11, color: "var(--text-3)", marginTop: 1 }} className="truncate">
                      {d.owner_name && <>{d.owner_name} · </>}
                      {timeAgo(d.decided_at)}
                    </p>
                  </div>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-2)", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 99, padding: "2px 8px", flexShrink: 0 }}>
                    {d.source === "slack" ? "Slack" : d.source === "ai" ? "Feedback" : "Manual"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Signal results ── */}
        {showItems && results.length > 0 && (
          <div>
            <p style={{ fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-3)", marginBottom: 6, paddingLeft: 2 }}>
              Signals
            </p>
            <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden", boxShadow: "var(--shadow-1)" }}>
              {results.map(r => {
                const badge = itemStatusBadge(r);
                const title = r.ai_key_question && r.ai_key_question !== "None" ? r.ai_key_question : (r.ai_summary ?? r.raw_content ?? "Untitled");
                const href  = r.project_id ? `/inbox/${r.project_id}/${r.id}` : "#";
                return (
                  <div
                    key={r.id}
                    onClick={() => router.push(href)}
                    style={{
                      display: "flex", alignItems: "center", gap: 12,
                      padding: "11px 16px", borderBottom: "1px solid var(--border-2)",
                      cursor: "pointer", transition: "background 0.1s",
                    }}
                    className="hover:bg-[var(--accent-softer)] last:border-0"
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: 13, fontWeight: 500, color: "var(--text)" }} className="truncate">{title}</p>
                      <p style={{ fontSize: 11, color: "var(--text-3)", marginTop: 1 }} className="truncate">
                        {r.project_name ?? "No project"}
                        {r.author_name && <> · {r.author_name}</>}
                        <> · {timeAgo(r.updated_at)}</>
                      </p>
                    </div>
                    <span style={{ fontSize: 11, fontWeight: 500, background: badge.bg, color: badge.color, borderRadius: 99, padding: "3px 10px", whiteSpace: "nowrap", flexShrink: 0 }}>
                      {badge.label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
