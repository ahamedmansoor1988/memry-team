"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft, CheckCircle2, ExternalLink, MessageSquare, Hash, FileText,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface DecisionDetail {
  id: string;
  decision_text: string;
  reason: string | null;
  owner_name: string | null;
  source: string;
  decided_at: string;
  outcome: string | null;
  alternatives: string[] | null;
  slack_channel_name: string | null;
  slack_thread_url: string | null;
  project: { id: string; name: string } | null;
  file_name: string | null;
  item_title: string | null;
  participants: string[];
  evidence: {
    figma_comments: number;
    slack_thread: string | null;
    slack_channel: string | null;
    feedback_item_id: string | null;
    project_id: string | null;
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function initials(name: string): string {
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

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit",
  });
}

const SOURCE_METHOD: Record<string, string> = {
  slack:  "Captured from Slack",
  ai:     "Extracted from resolved feedback",
  manual: "Recorded manually",
};

// ─── Main page ────────────────────────────────────────────────────────────────

export default function DecisionDetailPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const router = useRouter();
  const [decision, setDecision] = useState<DecisionDetail | null>(null);
  const [loading, setLoading]   = useState(true);

  useEffect(() => {
    fetch(`/api/decisions/${id}`)
      .then(r => r.json())
      .then((d: { decision?: DecisionDetail }) => {
        setDecision(d.decision ?? null);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <div className="min-h-full" style={{ background: "var(--bg)" }}>
        <div className="px-7 pt-6 max-w-4xl space-y-4">
          <div className="skeleton" style={{ height: 14, width: 200, borderRadius: 4 }} />
          <div className="skeleton" style={{ height: 26, width: "55%", borderRadius: 6 }} />
          <div className="skeleton" style={{ height: 180, borderRadius: 12 }} />
        </div>
      </div>
    );
  }

  if (!decision) {
    return (
      <div className="min-h-full flex flex-col items-center justify-center gap-3" style={{ background: "var(--bg)" }}>
        <p style={{ fontSize: 14, fontWeight: 500, color: "var(--text)" }}>Decision not found</p>
        <button
          onClick={() => router.push("/decisions")}
          style={{ fontSize: 12, color: "var(--text-2)", background: "none", border: "none", cursor: "pointer" }}
          className="hover:underline"
        >
          ← Back to decisions
        </button>
      </div>
    );
  }

  const contextHref = decision.evidence.project_id && decision.evidence.feedback_item_id
    ? `/inbox/${decision.evidence.project_id}/${decision.evidence.feedback_item_id}`
    : null;

  return (
    <div className="min-h-full" style={{ background: "var(--bg)" }}>
      <div className="px-7 pt-5 pb-10 max-w-4xl">

        {/* ── Breadcrumb ── */}
        <button
          onClick={() => router.push("/decisions")}
          style={{
            display: "flex", alignItems: "center", gap: 6,
            fontSize: 12, color: "var(--text-3)", background: "none",
            border: "none", cursor: "pointer", padding: 0, marginBottom: 14,
          }}
          className="hover:text-[var(--text-2)] transition-colors"
        >
          <ArrowLeft style={{ width: 13, height: 13 }} />
          Decisions
        </button>

        {/* ── Title ── */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, marginBottom: 4 }}>
          <h1 style={{ fontSize: 22, fontWeight: 600, color: "var(--text)", letterSpacing: "-0.02em", lineHeight: 1.25 }}>
            {decision.decision_text}
          </h1>
          <span style={{
            fontSize: 11, fontWeight: 500, whiteSpace: "nowrap", flexShrink: 0,
            background: "var(--green-soft)", color: "var(--green)",
            borderRadius: 99, padding: "4px 12px", marginTop: 4,
          }}>
            Decided
          </span>
        </div>

        {/* Meta line */}
        <p style={{ fontSize: 12, color: "var(--text-3)", marginBottom: 20 }}>
          {decision.project && <>{decision.project.name}</>}
          {decision.file_name && <> · {decision.file_name}</>}
          {decision.owner_name && <> · Decided by {decision.owner_name}</>}
          <> · {formatDate(decision.decided_at)}</>
        </p>

        {/* ── Two-column layout ── */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 280px", gap: 16 }} className="max-lg:!grid-cols-1">

          {/* LEFT — decision + rationale + outcome */}
          <div className="space-y-4">

            {/* Decision panel */}
            <div style={{
              background: "var(--green-soft)",
              border: "1px solid color-mix(in oklab, var(--green) 18%, #ffffff)",
              borderRadius: 12, padding: 18,
            }}>
              <p style={{ fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 600, letterSpacing: "0.07em", textTransform: "uppercase", color: "var(--green)", marginBottom: 6 }}>
                Decision
              </p>
              <p style={{ fontSize: 14, color: "var(--text)", lineHeight: 1.6, fontWeight: 500 }}>
                {decision.decision_text}
              </p>

              {decision.reason && (
                <>
                  <p style={{ fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 600, letterSpacing: "0.07em", textTransform: "uppercase", color: "var(--green)", margin: "14px 0 6px" }}>
                    Rationale
                  </p>
                  <p style={{ fontSize: 13, color: "var(--text-2)", lineHeight: 1.65 }}>
                    {decision.reason}
                  </p>
                </>
              )}
            </div>

            {/* Outcome */}
            {decision.outcome && (
              <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: 18, boxShadow: "var(--shadow-1)" }}>
                <p style={{ fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 600, letterSpacing: "0.07em", textTransform: "uppercase", color: "var(--text-3)", marginBottom: 6 }}>
                  Outcome
                </p>
                <p style={{ fontSize: 13, color: "var(--text)", lineHeight: 1.65 }}>{decision.outcome}</p>
              </div>
            )}

            {/* Alternatives */}
            {decision.alternatives && decision.alternatives.length > 0 && (
              <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: 18, boxShadow: "var(--shadow-1)" }}>
                <p style={{ fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 600, letterSpacing: "0.07em", textTransform: "uppercase", color: "var(--text-3)", marginBottom: 8 }}>
                  Alternatives considered
                </p>
                <ul className="space-y-1">
                  {decision.alternatives.map((alt, i) => (
                    <li key={i} style={{ fontSize: 13, color: "var(--text-2)", display: "flex", gap: 8, lineHeight: 1.6 }}>
                      <span style={{ opacity: 0.4 }}>·</span>{alt}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Evidence */}
            <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: 18, boxShadow: "var(--shadow-1)" }}>
              <p style={{ fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 600, letterSpacing: "0.07em", textTransform: "uppercase", color: "var(--text-3)", marginBottom: 10 }}>
                Evidence
              </p>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                {decision.evidence.figma_comments > 0 && contextHref && (
                  <Link href={contextHref} style={{
                    display: "flex", alignItems: "center", gap: 8, textDecoration: "none",
                    background: "var(--bg)", border: "1px solid var(--border)",
                    borderRadius: 10, padding: "10px 14px", minWidth: 150,
                  }} className="hover:border-[var(--accent-border)] transition-colors">
                    <MessageSquare style={{ width: 14, height: 14, color: "var(--blue)" }} />
                    <div>
                      <p style={{ fontSize: 12, fontWeight: 500, color: "var(--text)" }}>Figma comments</p>
                      <p style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-3)" }}>
                        {decision.evidence.figma_comments} comment{decision.evidence.figma_comments !== 1 ? "s" : ""}
                      </p>
                    </div>
                  </Link>
                )}
                {decision.slack_thread_url && (
                  <a href={decision.slack_thread_url} target="_blank" rel="noopener noreferrer" style={{
                    display: "flex", alignItems: "center", gap: 8, textDecoration: "none",
                    background: "var(--bg)", border: "1px solid var(--border)",
                    borderRadius: 10, padding: "10px 14px", minWidth: 150,
                  }} className="hover:border-[var(--accent-border)] transition-colors">
                    <Hash style={{ width: 14, height: 14, color: "var(--green)" }} />
                    <div>
                      <p style={{ fontSize: 12, fontWeight: 500, color: "var(--text)" }}>Slack thread</p>
                      <p style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-3)" }}>
                        {decision.slack_channel_name ? `#${decision.slack_channel_name}` : "Open thread"}
                      </p>
                    </div>
                  </a>
                )}
                {contextHref && (
                  <Link href={contextHref} style={{
                    display: "flex", alignItems: "center", gap: 8, textDecoration: "none",
                    background: "var(--bg)", border: "1px solid var(--border)",
                    borderRadius: 10, padding: "10px 14px", minWidth: 150,
                  }} className="hover:border-[var(--accent-border)] transition-colors">
                    <FileText style={{ width: 14, height: 14, color: "var(--text-2)" }} />
                    <div>
                      <p style={{ fontSize: 12, fontWeight: 500, color: "var(--text)" }}>Full discussion</p>
                      <p style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-3)" }}>View context</p>
                    </div>
                  </Link>
                )}
                {decision.evidence.figma_comments === 0 && !decision.slack_thread_url && !contextHref && (
                  <p style={{ fontSize: 12, color: "var(--text-3)" }}>No linked evidence for this decision.</p>
                )}
              </div>
            </div>
          </div>

          {/* RIGHT — approval sidebar */}
          <div className="space-y-4">

            {/* Approval */}
            <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: 16, boxShadow: "var(--shadow-1)" }}>
              <p style={{ fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 600, letterSpacing: "0.07em", textTransform: "uppercase", color: "var(--text-3)", marginBottom: 12 }}>
                Approval
              </p>

              {decision.owner_name ? (
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                  <div style={{
                    width: 34, height: 34, borderRadius: 99, flexShrink: 0,
                    background: colorFor(decision.owner_name), color: "#fff",
                    fontSize: 11, fontWeight: 700,
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}>
                    {initials(decision.owner_name)}
                  </div>
                  <div>
                    <p style={{ fontSize: 13, fontWeight: 500, color: "var(--text)" }}>{decision.owner_name}</p>
                    <p style={{ fontSize: 11, color: "var(--text-3)" }}>Decision owner</p>
                  </div>
                </div>
              ) : (
                <p style={{ fontSize: 12, color: "var(--text-3)", marginBottom: 12 }}>No owner recorded</p>
              )}

              <div className="space-y-2">
                <div>
                  <p style={{ fontSize: 10.5, color: "var(--text-3)" }}>Date</p>
                  <p style={{ fontSize: 12.5, color: "var(--text)" }}>{formatDate(decision.decided_at)}</p>
                </div>
                <div>
                  <p style={{ fontSize: 10.5, color: "var(--text-3)" }}>Method</p>
                  <p style={{ fontSize: 12.5, color: "var(--text)" }}>{SOURCE_METHOD[decision.source] ?? decision.source}</p>
                </div>
              </div>
            </div>

            {/* Participants */}
            {decision.participants.length > 0 && (
              <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: 16, boxShadow: "var(--shadow-1)" }}>
                <p style={{ fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 600, letterSpacing: "0.07em", textTransform: "uppercase", color: "var(--text-3)", marginBottom: 12 }}>
                  Participants
                </p>
                <div className="space-y-2">
                  {decision.participants.map(name => (
                    <div key={name} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{
                        width: 24, height: 24, borderRadius: 99, flexShrink: 0,
                        background: colorFor(name), color: "#fff",
                        fontSize: 8, fontWeight: 700,
                        display: "flex", alignItems: "center", justifyContent: "center",
                      }}>
                        {initials(name)}
                      </div>
                      <p style={{ fontSize: 12.5, color: "var(--text)" }}>{name}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Linked to */}
            {(decision.project || decision.file_name) && (
              <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: 16, boxShadow: "var(--shadow-1)" }}>
                <p style={{ fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 600, letterSpacing: "0.07em", textTransform: "uppercase", color: "var(--text-3)", marginBottom: 12 }}>
                  Linked to
                </p>
                <div className="space-y-2">
                  {decision.project && (
                    <div>
                      <p style={{ fontSize: 10.5, color: "var(--text-3)" }}>Project</p>
                      <Link href={`/projects/${decision.project.id}`} style={{ fontSize: 12.5, color: "var(--blue)", textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4 }} className="hover:underline">
                        {decision.project.name}
                        <ExternalLink style={{ width: 10, height: 10 }} />
                      </Link>
                    </div>
                  )}
                  {decision.file_name && (
                    <div>
                      <p style={{ fontSize: 10.5, color: "var(--text-3)" }}>File</p>
                      <p style={{ fontSize: 12.5, color: "var(--text)" }}>{decision.file_name}</p>
                    </div>
                  )}
                  {decision.item_title && (
                    <div>
                      <p style={{ fontSize: 10.5, color: "var(--text-3)" }}>Discussion</p>
                      {contextHref ? (
                        <Link href={contextHref} style={{ fontSize: 12.5, color: "var(--blue)", textDecoration: "none" }} className="hover:underline">
                          {decision.item_title}
                        </Link>
                      ) : (
                        <p style={{ fontSize: 12.5, color: "var(--text)" }}>{decision.item_title}</p>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

          </div>
        </div>
      </div>
    </div>
  );
}
