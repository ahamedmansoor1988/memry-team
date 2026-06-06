"use client";
import { useState, useEffect } from "react";
import { CheckCircle2, User, Loader2, ExternalLink } from "lucide-react";
import Link from "next/link";

// ─── Types ────────────────────────────────────────────────────────────────────

interface DecisionItem {
  id: string;
  decision_text: string;
  reason: string | null;
  owner_name: string | null;
  source: string;
  decided_at: string;
  feedback_item_id: string | null;
  feedback_item: {
    id: string;
    project_id: string | null;
    ai_key_question: string | null;
    project: { id: string; name: string } | null;
  } | null;
  owner_profile: {
    display_name: string;
    figma_handle: string | null;
  } | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

const SOURCE_BADGE: Record<string, { label: string; cls: string }> = {
  slack:  { label: "via Slack",  cls: "bg-violet-50 text-violet-600 border border-violet-200" },
  manual: { label: "Manual",     cls: "bg-surface text-muted border border-border" },
  ai:     { label: "AI",         cls: "bg-blue-50 text-blue-600 border border-blue-200" },
};

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function DecisionSkeleton() {
  return (
    <div className="rounded-panel border border-border bg-paper p-4">
      <div className="flex gap-3">
        <div className="skeleton w-4 h-4 rounded-full shrink-0 mt-0.5" />
        <div className="flex-1 space-y-2">
          <div className="skeleton h-4 w-3/4 rounded" />
          <div className="skeleton h-3 w-1/2 rounded" />
          <div className="flex gap-2 mt-1">
            <div className="skeleton h-4 w-16 rounded-full" />
            <div className="skeleton h-4 w-20 rounded-full" />
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function DecisionsPage() {
  const [decisions, setDecisions] = useState<DecisionItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/decisions")
      .then(r => r.json())
      .then((d: { decisions?: DecisionItem[] }) => {
        setDecisions(d.decisions ?? []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-paper">

      {/* ── Header ── */}
      <div className="px-6 pt-6 pb-5 border-b border-border shrink-0">
        <div className="flex items-center gap-2.5 mb-1">
          <CheckCircle2 size={18} className="text-emerald-500 shrink-0" />
          <h1 className="text-title font-semibold text-ink">Decisions</h1>
          {!loading && decisions.length > 0 && (
            <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 text-[11px] font-bold border border-emerald-100">
              {decisions.length}
            </span>
          )}
        </div>
        <p className="text-body text-muted">Decisions extracted from resolved feedback</p>
      </div>

      {/* ── Content ── */}
      <div className="flex-1 overflow-y-auto px-6 py-5">
        {loading ? (
          <div className="space-y-3">
            <DecisionSkeleton /><DecisionSkeleton /><DecisionSkeleton />
          </div>
        ) : decisions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 gap-3 text-center">
            <CheckCircle2 size={32} className="text-wash" />
            <p className="text-lead font-medium text-ink">No decisions yet</p>
            <p className="text-body text-muted max-w-xs">
              Decisions are extracted automatically when feedback is resolved via Slack or Memry.
            </p>
          </div>
        ) : (
          <div className="space-y-3 fade-in">
            {decisions.map(decision => {
              const fi   = Array.isArray(decision.feedback_item)
                ? decision.feedback_item[0]
                : decision.feedback_item;
              const op   = Array.isArray(decision.owner_profile)
                ? decision.owner_profile[0]
                : decision.owner_profile;

              const sb          = SOURCE_BADGE[decision.source] ?? SOURCE_BADGE.manual;
              const ownerLabel  = op?.display_name ?? decision.owner_name;
              const projectName = fi?.project
                ? (Array.isArray(fi.project) ? fi.project[0] : fi.project)?.name
                : null;
              const feedbackLink = fi?.project_id && decision.feedback_item_id
                ? `/inbox/${fi.project_id}/${decision.feedback_item_id}`
                : null;

              return (
                <div
                  key={decision.id}
                  className="rounded-panel border border-border bg-paper p-4 hover:border-ink/15 transition-colors"
                >
                  <div className="flex gap-3">
                    {/* Check icon */}
                    <CheckCircle2 size={15} className="text-emerald-500 shrink-0 mt-0.5" />

                    {/* Body */}
                    <div className="flex-1 min-w-0">
                      {/* Decision text */}
                      <p className="text-body font-semibold text-ink leading-snug mb-1">
                        {decision.decision_text}
                      </p>

                      {/* Reason */}
                      {decision.reason && (
                        <p className="text-caption text-muted mb-3 leading-relaxed">
                          {decision.reason}
                        </p>
                      )}

                      {/* Meta row */}
                      <div className="flex items-center gap-3 flex-wrap mt-2">
                        {ownerLabel && (
                          <span className="inline-flex items-center gap-1 text-caption text-muted">
                            <User size={10} className="shrink-0" />
                            {ownerLabel}
                          </span>
                        )}

                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${sb.cls}`}>
                          {sb.label}
                        </span>

                        {projectName && (
                          <span className="text-caption text-muted">{projectName}</span>
                        )}

                        <span className="text-caption text-muted ml-auto">
                          {timeAgo(decision.decided_at)}
                        </span>
                      </div>

                      {/* Link to original feedback item */}
                      {feedbackLink && (
                        <Link
                          href={feedbackLink}
                          className="inline-flex items-center gap-1 mt-2.5 text-[10px] text-muted hover:text-ink transition-colors"
                        >
                          <ExternalLink size={9} />
                          View original comment
                        </Link>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
