"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { Video, Loader2, CheckCircle2, HelpCircle, Zap, ChevronRight } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Project { id: string; name: string; }

interface ExtractedDecision  { text: string; reason?: string | null; owner?: string | null; }
interface ExtractedAction    { text: string; owner?: string | null; priority?: string | null; }
interface ExtractedQuestion  { text: string; owner?: string | null; }

interface ExtractionResult {
  summary:        string | null;
  decisions:      ExtractedDecision[];
  action_items:   ExtractedAction[];
  open_questions: ExtractedQuestion[];
  saved: {
    decisions:    number;
    action_items: number;
  };
}

// ─── Priority badge ───────────────────────────────────────────────────────────

const PRIORITY_CLS: Record<string, string> = {
  high:   "bg-red-50 text-red-600 border border-red-200",
  medium: "bg-amber-50 text-amber-700 border border-amber-200",
  low:    "bg-blue-50 text-blue-600 border border-blue-200",
};

function PriorityBadge({ priority }: { priority: string | null | undefined }) {
  const p = (priority ?? "medium").toLowerCase();
  const cls = PRIORITY_CLS[p] ?? PRIORITY_CLS.medium;
  return (
    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${cls}`}>
      {p}
    </span>
  );
}

// ─── Result Cards ─────────────────────────────────────────────────────────────

function SummaryCard({ summary }: { summary: string | null }) {
  if (!summary) return null;
  return (
    <div className="rounded-panel border border-border bg-surface p-4">
      <p className="text-[10px] font-bold uppercase tracking-widest text-muted mb-2">Meeting Summary</p>
      <p className="text-body text-ink leading-relaxed">{summary}</p>
    </div>
  );
}

function DecisionsCard({ decisions, saved }: { decisions: ExtractedDecision[]; saved: number }) {
  return (
    <div className="rounded-panel border-l-4 border-l-emerald-400 border border-border bg-paper p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-[10px] font-bold uppercase tracking-widest text-muted">
          Decisions ({decisions.length})
        </p>
        {saved > 0 && (
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-600 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded">
            <CheckCircle2 size={10} /> {saved} saved
          </span>
        )}
      </div>
      {decisions.length === 0 ? (
        <p className="text-caption text-muted">No decisions found</p>
      ) : (
        <div className="space-y-3">
          {decisions.map((d, i) => (
            <div key={i} className="space-y-0.5">
              <p className="text-body text-ink font-medium">{d.text}</p>
              {d.reason && <p className="text-caption text-muted italic">{d.reason}</p>}
              <div className="flex items-center gap-2 flex-wrap">
                {d.owner && <span className="text-caption text-muted">→ {d.owner}</span>}
                <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-600">
                  <CheckCircle2 size={10} /> Saved to Decisions
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ActionItemsCard({
  items, saved, hasProject,
}: { items: ExtractedAction[]; saved: number; hasProject: boolean }) {
  return (
    <div className="rounded-panel border-l-4 border-l-amber-400 border border-border bg-paper p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-[10px] font-bold uppercase tracking-widest text-muted">
          Action Items ({items.length})
        </p>
        {saved > 0 && hasProject && (
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded">
            {saved} created
          </span>
        )}
      </div>
      {!hasProject && items.length > 0 && (
        <p className="text-caption text-amber-600 bg-amber-50 border border-amber-200 rounded px-2 py-1.5 mb-3">
          Select a project above to save action items to the inbox
        </p>
      )}
      {items.length === 0 ? (
        <p className="text-caption text-muted">No action items found</p>
      ) : (
        <div className="space-y-3">
          {items.map((a, i) => (
            <div key={i} className="space-y-0.5">
              <p className="text-body text-ink font-medium">{a.text}</p>
              <div className="flex items-center gap-1.5 flex-wrap">
                {a.owner && <span className="text-caption text-muted">→ {a.owner}</span>}
                <PriorityBadge priority={a.priority} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function OpenQuestionsCard({ questions }: { questions: ExtractedQuestion[] }) {
  return (
    <div className="rounded-panel border-l-4 border-l-blue-400 border border-border bg-paper p-4">
      <p className="text-[10px] font-bold uppercase tracking-widest text-muted mb-3">
        Open Questions ({questions.length})
      </p>
      {questions.length === 0 ? (
        <p className="text-caption text-muted">No open questions</p>
      ) : (
        <div className="space-y-3">
          {questions.map((q, i) => (
            <div key={i} className="space-y-0.5">
              <div className="flex items-start gap-2">
                <HelpCircle size={13} className="text-blue-400 shrink-0 mt-0.5" />
                <p className="text-body text-ink">{q.text}</p>
              </div>
              {q.owner && <p className="text-caption text-muted pl-5">raised by {q.owner}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function MeetingsPage() {
  const [projects,     setProjects]     = useState<Project[]>([]);
  const [title,        setTitle]        = useState("");
  const [projectId,    setProjectId]    = useState("");
  const [transcript,   setTranscript]   = useState("");
  const [extracting,   setExtracting]   = useState(false);
  const [error,        setError]        = useState<string | null>(null);
  const [result,       setResult]       = useState<ExtractionResult | null>(null);

  // Load projects for selector
  useEffect(() => {
    fetch("/api/projects")
      .then(r => r.json())
      .then((d: { projects?: Project[] }) => setProjects(d.projects ?? []))
      .catch(() => {});
  }, []);

  async function extract() {
    if (!transcript.trim()) return;
    setExtracting(true);
    setError(null);
    setResult(null);

    const body: { transcript: string; meeting_title?: string; project_id?: string } = {
      transcript: transcript.trim(),
    };
    if (title.trim())     body.meeting_title = title.trim();
    if (projectId.trim()) body.project_id    = projectId;

    const res = await fetch("/api/meetings/extract", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(body),
    });

    const data = await res.json() as ExtractionResult & { error?: string };
    setExtracting(false);

    if (!res.ok) { setError(data.error ?? "Extraction failed. Try again."); return; }
    setResult(data);
  }

  const hasProject = !!projectId;

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-paper">

      {/* Header */}
      <div className="px-6 pt-6 pb-5 border-b border-border shrink-0">
        <div className="flex items-center gap-2.5 mb-1">
          <Video size={18} className="text-muted shrink-0" />
          <h1 className="text-title font-semibold text-ink">Meetings</h1>
        </div>
        <p className="text-body text-muted">Extract decisions and action items from any transcript</p>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">

        {/* ── Form ── */}
        <div className="rounded-panel border border-border bg-paper p-5 space-y-4">

          {/* Title + Project row */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-caption font-semibold text-muted mb-1.5">
                Meeting title <span className="font-normal opacity-60">(optional)</span>
              </label>
              <input
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="e.g. Design Review — June 8"
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-body text-ink placeholder:text-muted outline-none focus:border-ink/30 transition-colors"
              />
            </div>
            <div>
              <label className="block text-caption font-semibold text-muted mb-1.5">
                Project <span className="font-normal opacity-60">(required for action items)</span>
              </label>
              <select
                value={projectId}
                onChange={e => setProjectId(e.target.value)}
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-body text-ink outline-none focus:border-ink/30 transition-colors"
              >
                <option value="">No project (decisions only)</option>
                {projects.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Transcript */}
          <div>
            <label className="block text-caption font-semibold text-muted mb-1.5">
              Transcript
            </label>
            <textarea
              value={transcript}
              onChange={e => setTranscript(e.target.value)}
              placeholder="Paste your meeting transcript, notes, or captions here…"
              className="w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-body text-ink placeholder:text-muted outline-none focus:border-ink/30 transition-colors resize-y"
              style={{ minHeight: 200 }}
            />
          </div>

          {/* Error */}
          {error && (
            <p className="text-body text-red-500 flex items-center gap-1.5">
              <span className="text-red-400">⚠</span> {error}
            </p>
          )}

          {/* Submit */}
          <button
            onClick={extract}
            disabled={extracting || !transcript.trim()}
            className="flex items-center gap-2 px-5 py-2.5 rounded-panel bg-ink text-paper text-body font-semibold hover:bg-ink/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {extracting
              ? <><Loader2 size={14} className="animate-spin" /> Analyzing transcript…</>
              : <><Zap size={14} /> Extract &amp; Save</>
            }
          </button>
        </div>

        {/* ── Results ── */}
        {!result && !extracting && (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
            <Video size={36} className="text-wash" />
            <p className="text-lead font-medium text-ink">Paste a transcript to get started</p>
            <p className="text-body text-muted max-w-xs">
              Decisions, action items, and open questions will be extracted automatically.
            </p>
          </div>
        )}

        {result && (
          <div className="space-y-4 fade-in">
            {/* Summary (full width) */}
            <SummaryCard summary={result.summary} />

            {/* 2×2 grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <DecisionsCard    decisions={result.decisions}      saved={result.saved.decisions}    />
              <ActionItemsCard  items={result.action_items}       saved={result.saved.action_items} hasProject={hasProject} />
              <OpenQuestionsCard questions={result.open_questions} />
            </div>

            {/* Save summary line */}
            <div className="flex items-center gap-2 text-body text-muted px-1">
              <CheckCircle2 size={14} className="text-emerald-500 shrink-0" />
              <span>
                <span className="font-semibold text-ink">{result.saved.decisions}</span> decision{result.saved.decisions !== 1 ? "s" : ""} saved
                {hasProject && (
                  <>
                    {" · "}
                    <span className="font-semibold text-ink">{result.saved.action_items}</span> action item{result.saved.action_items !== 1 ? "s" : ""} created
                  </>
                )}
              </span>
              <Link href="/decisions" className="ml-auto flex items-center gap-0.5 text-muted hover:text-ink transition-colors">
                View Decisions <ChevronRight size={13} />
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
