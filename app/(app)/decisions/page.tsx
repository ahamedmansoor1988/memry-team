"use client";
import { useState, useEffect, useMemo } from "react";
import { CheckCircle2, ExternalLink, Search, ChevronDown, Plus, X } from "lucide-react";
import Link from "next/link";

// ─── Types ────────────────────────────────────────────────────────────────────

interface DecisionItem {
  id:               string;
  decision_text:    string;
  reason:           string | null;
  owner_name:       string | null;
  source:           string;
  decided_at:       string;
  feedback_item_id: string | null;
  project_id:       string | null;
  project_name:     string | null;
  ai_key_question:  string | null;
  outcome:          string | null;
  alternatives:     string[] | null;
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

// ─── Constants ────────────────────────────────────────────────────────────────

const SOURCE_BADGE: Record<string, { label: string; cls: string }> = {
  slack:  { label: "via Slack",  cls: "bg-zinc-100 text-zinc-700 border border-zinc-200" },
  manual: { label: "Manual",     cls: "bg-surface text-muted border border-border" },
  ai:     { label: "AI",         cls: "bg-zinc-100 text-zinc-600 border border-zinc-200" },
};

const SOURCE_DOT: Record<string, string> = {
  slack:  "bg-zinc-100",
  manual: "bg-zinc-100",
  ai:     "bg-zinc-100",
};

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

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function TimelineSkeleton() {
  return (
    <div className="space-y-8">
      {[0, 1, 2].map(g => (
        <div key={g} className="flex gap-6">
          {/* Left date column */}
          <div className="w-24 shrink-0">
            <div className="skeleton h-4 w-16 rounded ml-auto" />
          </div>
          {/* Right cards */}
          <div className="flex-1 space-y-3">
            {[0, 1].map(c => (
              <div key={c} className="rounded-panel border border-border bg-paper p-4">
                <div className="flex gap-3">
                  <div className="skeleton w-2 h-2 rounded-full shrink-0 mt-1.5" />
                  <div className="flex-1 space-y-2">
                    <div className="skeleton h-4 w-3/4 rounded" />
                    <div className="skeleton h-3 w-1/2 rounded" />
                    <div className="flex gap-2 mt-2">
                      <div className="skeleton h-4 w-12 rounded-full" />
                      <div className="skeleton h-4 w-16 rounded-full" />
                      <div className="skeleton h-4 w-20 rounded-full" />
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Outcome form ─────────────────────────────────────────────────────────────

interface OutcomeFormProps {
  decisionId: string;
  onSave: (outcome: string, alternatives: string[]) => void;
  onCancel: () => void;
}

function OutcomeForm({ decisionId, onSave, onCancel }: OutcomeFormProps) {
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

  return (
    <div className="mt-3 pt-3 border-t border-border space-y-2">
      <textarea
        value={outcomeText}
        onChange={e => setOutcomeText(e.target.value)}
        placeholder="What actually happened? How did this play out?"
        rows={3}
        className="w-full px-3 py-2 text-body rounded-lg border border-border bg-surface text-ink placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-ink/20 focus:border-ink/30 transition-colors resize-none"
      />
      <input
        type="text"
        value={altsText}
        onChange={e => setAltsText(e.target.value)}
        placeholder="Option A, Option B, Option C"
        className="w-full px-3 py-2 text-body rounded-lg border border-border bg-surface text-ink placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-ink/20 focus:border-ink/30 transition-colors"
      />
      <div className="flex items-center justify-end gap-2">
        <button
          onClick={onCancel}
          className="text-caption text-muted hover:text-ink transition-colors px-2 py-1"
        >
          Cancel
        </button>
        <button
          onClick={handleSave}
          disabled={saving || !outcomeText.trim()}
          className="text-caption font-medium px-3 py-1 rounded-lg bg-ink text-paper hover:bg-ink/80 transition-colors disabled:opacity-40"
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}

// ─── Decision card ────────────────────────────────────────────────────────────

interface DecisionCardProps {
  decision:  DecisionItem;
  onUpdate:  (id: string, patch: Partial<DecisionItem>) => void;
}

function DecisionCard({ decision, onUpdate }: DecisionCardProps) {
  const [showForm, setShowForm] = useState(false);
  const sb          = SOURCE_BADGE[decision.source] ?? SOURCE_BADGE.manual;
  const dotCls      = SOURCE_DOT[decision.source] ?? SOURCE_DOT.manual;
  const feedbackLink = decision.project_id && decision.feedback_item_id
    ? `/inbox/${decision.project_id}/${decision.feedback_item_id}`
    : null;

  return (
    <div className="relative flex gap-3 group">
      {/* Timeline dot */}
      <div className={`w-2 h-2 rounded-full shrink-0 mt-2 z-10 ring-2 ring-paper ${dotCls}`} />

      {/* Card */}
      <div className="flex-1 rounded-panel border border-border bg-paper p-4 mb-3 hover:border-ink/15 transition-colors">
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

        {/* Outcome */}
        {decision.outcome && (
          <div className="mt-2 mb-2 rounded-lg bg-zinc-100 border border-zinc-200 px-3 py-2">
            <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-700 mb-0.5">Outcome</p>
            <p className="text-body text-zinc-700 leading-relaxed">{decision.outcome}</p>
          </div>
        )}

        {/* Alternatives */}
        {decision.alternatives && decision.alternatives.length > 0 && (
          <div className="mt-2 mb-2">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted mb-1">Alternatives considered</p>
            <ul className="space-y-0.5">
              {decision.alternatives.map((alt, i) => (
                <li key={i} className="text-caption text-muted flex items-start gap-1.5">
                  <span className="opacity-40 shrink-0">·</span>
                  {alt}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Meta row */}
        <div className="flex items-center gap-2.5 flex-wrap mt-2">
          {decision.owner_name && (
            <span className="inline-flex items-center gap-1.5 text-caption text-muted">
              <span className="w-4 h-4 rounded-full bg-surface border border-border flex items-center justify-center text-[8px] font-bold text-muted shrink-0">
                {ownerInitials(decision.owner_name)}
              </span>
              {decision.owner_name}
            </span>
          )}

          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${sb.cls}`}>
            {sb.label}
          </span>

          {decision.project_name && (
            <span className="text-caption text-muted">{decision.project_name}</span>
          )}

          <span className="text-caption text-muted ml-auto shrink-0">
            {timeAgo(decision.decided_at)}
          </span>
        </div>

        {/* Footer: view link + add outcome */}
        <div className="flex items-center justify-between mt-2.5 flex-wrap gap-2">
          {feedbackLink ? (
            <Link
              href={feedbackLink}
              className="inline-flex items-center gap-1 text-[10px] text-muted hover:text-ink transition-colors"
            >
              <ExternalLink size={9} />
              View context →
            </Link>
          ) : <span />}

          {!decision.outcome && !showForm && (
            <button
              onClick={() => setShowForm(true)}
              className="inline-flex items-center gap-1 text-[10px] text-muted hover:text-ink transition-colors"
            >
              <Plus size={9} />
              Add outcome
            </button>
          )}
          {showForm && (
            <button
              onClick={() => setShowForm(false)}
              className="inline-flex items-center gap-1 text-[10px] text-muted hover:text-ink transition-colors"
            >
              <X size={9} />
              Cancel
            </button>
          )}
        </div>

        {/* Inline outcome form */}
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
    </div>
  );
}

// ─── Date group ───────────────────────────────────────────────────────────────

interface DateGroupProps {
  group:    TimelineGroup & { decisions: DecisionItem[] };
  onUpdate: (id: string, patch: Partial<DecisionItem>) => void;
}

function DateGroup({ group, onUpdate }: DateGroupProps) {
  if (group.decisions.length === 0) return null;

  return (
    <div className="flex gap-0 sm:gap-6">
      {/* Left: date label */}
      <div className="hidden sm:flex w-24 shrink-0 flex-col items-end pt-1.5 select-none">
        <span className="text-[11px] font-bold text-ink leading-none">{group.label}</span>
        <span className="text-[10px] text-muted mt-0.5">
          {group.decisions.length} decision{group.decisions.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Right: cards with vertical timeline line */}
      <div className="flex-1 relative">
        {/* Mobile date label */}
        <div className="flex sm:hidden items-center gap-2 mb-3">
          <span className="text-[11px] font-bold text-ink">{group.label}</span>
          <span className="text-[10px] text-muted">
            · {group.decisions.length} decision{group.decisions.length !== 1 ? "s" : ""}
          </span>
        </div>

        {/* Vertical line */}
        <div className="absolute left-0.5 top-2 bottom-3 w-px bg-border" aria-hidden="true" />

        {/* Cards */}
        <div className="pl-5">
          {group.decisions.map(d => (
            <DecisionCard key={d.id} decision={d} onUpdate={onUpdate} />
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function DecisionsPage() {
  const [data,    setData]    = useState<TimelineData | null>(null);
  const [loading, setLoading] = useState(true);
  const [search,  setSearch]  = useState("");

  // Patch a single decision in the local timeline state (outcome/alternatives)
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
  const [projectFilter, setProjectFilter] = useState<string>("all");
  const [showProjectMenu, setShowProjectMenu] = useState(false);

  useEffect(() => {
    fetch("/api/decisions/timeline")
      .then(r => r.json())
      .then((d: TimelineData) => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  // Close project dropdown on outside click
  useEffect(() => {
    if (!showProjectMenu) return;
    const handler = () => setShowProjectMenu(false);
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [showProjectMenu]);

  // ── Client-side filtering ─────────────────────────────────────────────────
  const filteredTimeline = useMemo<TimelineGroup[]>(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();

    return data.timeline
      .map(group => ({
        ...group,
        decisions: group.decisions.filter(d => {
          const matchesProject =
            projectFilter === "all" || d.project_id === projectFilter;
          const matchesSearch =
            !q ||
            d.decision_text.toLowerCase().includes(q) ||
            (d.reason ?? "").toLowerCase().includes(q);
          return matchesProject && matchesSearch;
        }),
      }))
      .filter(group => group.decisions.length > 0);
  }, [data, projectFilter, search]);

  const filteredTotal = useMemo(
    () => filteredTimeline.reduce((sum, g) => sum + g.decisions.length, 0),
    [filteredTimeline],
  );

  const selectedProjectName =
    projectFilter === "all"
      ? "All Projects"
      : (data?.projects.find(p => p.id === projectFilter)?.name ?? "All Projects");

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-paper">

      {/* ── Header ── */}
      <div className="px-6 pt-6 pb-4 border-b border-border shrink-0">
        <div className="flex items-center gap-2.5 mb-1">
          <CheckCircle2 size={18} className="text-zinc-700 shrink-0" />
          <h1 className="text-title font-semibold text-ink">Decisions</h1>
          {!loading && data && data.total > 0 && (
            <span className="px-2 py-0.5 rounded-full bg-zinc-100 text-zinc-700 text-[11px] font-bold border border-zinc-200">
              {filteredTotal !== data.total ? `${filteredTotal} of ${data.total}` : data.total}
            </span>
          )}
        </div>
        <p className="text-body text-muted mb-4">Decisions extracted from resolved feedback</p>

        {/* ── Filters ── */}
        {!loading && data && data.total > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            {/* Search */}
            <div className="relative flex-1 min-w-[160px] max-w-sm">
              <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
              <input
                type="text"
                placeholder="Search decisions…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full pl-7 pr-3 py-1.5 text-body rounded-lg border border-border bg-paper text-ink placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-ink/20 focus:border-ink/30 transition-colors"
              />
            </div>

            {/* Project filter */}
            {data.projects.length > 0 && (
              <div className="relative">
                <button
                  onClick={e => { e.stopPropagation(); setShowProjectMenu(v => !v); }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-paper text-body text-ink hover:border-ink/30 transition-colors"
                >
                  <span className="max-w-[120px] truncate">{selectedProjectName}</span>
                  <ChevronDown size={12} className="text-muted shrink-0" />
                </button>
                {showProjectMenu && (
                  <div className="absolute right-0 top-full mt-1 w-48 rounded-lg border border-border bg-paper shadow-lg z-20 py-1">
                    <button
                      onClick={() => { setProjectFilter("all"); setShowProjectMenu(false); }}
                      className={`w-full text-left px-3 py-1.5 text-body hover:bg-surface transition-colors ${projectFilter === "all" ? "font-semibold text-ink" : "text-muted"}`}
                    >
                      All Projects
                    </button>
                    {data.projects.map(p => (
                      <button
                        key={p.id}
                        onClick={() => { setProjectFilter(p.id); setShowProjectMenu(false); }}
                        className={`w-full text-left px-3 py-1.5 text-body hover:bg-surface transition-colors truncate ${projectFilter === p.id ? "font-semibold text-ink" : "text-muted"}`}
                      >
                        {p.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Content ── */}
      <div className="flex-1 overflow-y-auto px-6 py-6">
        {loading ? (
          <TimelineSkeleton />
        ) : !data || data.total === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 gap-3 text-center">
            <CheckCircle2 size={32} className="text-wash" />
            <p className="text-lead font-medium text-ink">No decisions yet</p>
            <p className="text-body text-muted max-w-xs">
              Decisions are recorded when feedback is resolved via Slack or Memry.
            </p>
          </div>
        ) : filteredTimeline.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 gap-2 text-center">
            <Search size={24} className="text-wash" />
            <p className="text-body text-muted">No decisions match your filters</p>
            <button
              onClick={() => { setSearch(""); setProjectFilter("all"); }}
              className="text-body text-muted underline underline-offset-2 hover:text-ink transition-colors mt-1"
            >
              Clear filters
            </button>
          </div>
        ) : (
          <div className="space-y-8 fade-in max-w-2xl">
            {filteredTimeline.map(group => (
              <DateGroup key={group.date} group={group} onUpdate={handleUpdate} />
            ))}
          </div>
        )}
      </div>

      {/* Legend — shown when data is loaded */}
      {!loading && data && data.total > 0 && (
        <div className="px-6 py-3 border-t border-border shrink-0 flex items-center gap-4 flex-wrap">
          {(["slack", "manual", "ai"] as const).map(src => (
            <span key={src} className="inline-flex items-center gap-1.5 text-caption text-muted">
              <span className={`w-1.5 h-1.5 rounded-full ${SOURCE_DOT[src]}`} />
              {SOURCE_BADGE[src].label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
