"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { Sparkles, BookOpen, Plus, X, Tag, ChevronDown } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface MemoryAnswer {
  answer:      string;
  confidence:  "high" | "medium" | "low";
  sources:     string[];
  suggestions: string[];
}

interface MemoryEntry {
  id:         string;
  type:       "decision" | "pattern" | "context";
  title:      string;
  content:    string;
  source_ids: string[];
  tags:       string[];
  created_at: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const CONFIDENCE_CLS: Record<MemoryAnswer["confidence"], string> = {
  high:   "bg-emerald-50 text-emerald-700 border border-emerald-200",
  medium: "bg-amber-50 text-amber-700 border border-amber-200",
  low:    "bg-gray-100 text-gray-500 border border-gray-200",
};

const CONFIDENCE_LABEL: Record<MemoryAnswer["confidence"], string> = {
  high:   "High confidence",
  medium: "Medium confidence",
  low:    "Low confidence",
};

const TYPE_BADGE: Record<MemoryEntry["type"], { label: string; cls: string }> = {
  decision: { label: "Decision", cls: "bg-emerald-50 text-emerald-700" },
  pattern:  { label: "Pattern",  cls: "bg-violet-50 text-violet-700"  },
  context:  { label: "Context",  cls: "bg-blue-50 text-blue-700"      },
};

const ENTRY_TYPES = ["decision", "pattern", "context"] as const;

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

// ─── Answer card ─────────────────────────────────────────────────────────────

interface AnswerCardProps {
  answer: MemoryAnswer;
  onSuggestionClick: (q: string) => void;
}

function AnswerCard({ answer, onSuggestionClick }: AnswerCardProps) {
  return (
    <div className="rounded-panel border border-emerald-200 bg-emerald-50/30 p-5 space-y-4 fade-in">
      {/* Answer + confidence */}
      <div className="flex items-start gap-3">
        <Sparkles size={16} className="text-emerald-500 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-body text-ink leading-relaxed">{answer.answer}</p>
        </div>
        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 self-start ${CONFIDENCE_CLS[answer.confidence]}`}>
          {CONFIDENCE_LABEL[answer.confidence]}
        </span>
      </div>

      {/* Sources */}
      {answer.sources.length > 0 && (
        <div className="pl-7 space-y-1.5">
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted">Based on</p>
          {answer.sources.map((src, i) => (
            <p key={i} className="text-caption text-muted italic border-l-2 border-emerald-200 pl-2.5">
              "{src}"
            </p>
          ))}
        </div>
      )}

      {/* Suggestions */}
      {answer.suggestions.length > 0 && (
        <div className="pl-7">
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted mb-2">You might also ask</p>
          <div className="flex flex-wrap gap-2">
            {answer.suggestions.map((s, i) => (
              <button
                key={i}
                onClick={() => onSuggestionClick(s)}
                className="text-caption text-muted bg-surface border border-border px-2.5 py-1 rounded-lg hover:text-ink hover:border-ink/30 transition-colors text-left"
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Entry card ───────────────────────────────────────────────────────────────

function EntryCard({ entry }: { entry: MemoryEntry }) {
  const badge = TYPE_BADGE[entry.type] ?? TYPE_BADGE.context;
  return (
    <div className="rounded-panel border border-border bg-paper p-4">
      <div className="flex items-start gap-2.5 mb-2">
        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 ${badge.cls}`}>
          {badge.label}
        </span>
        <p className="text-body font-semibold text-ink leading-snug flex-1">{entry.title}</p>
        <span className="text-caption text-muted shrink-0">{timeAgo(entry.created_at)}</span>
      </div>
      <p className="text-caption text-muted line-clamp-2 leading-relaxed">{entry.content}</p>
      {entry.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2.5">
          {entry.tags.map(tag => (
            <span key={tag} className="inline-flex items-center gap-1 text-[10px] text-muted bg-surface border border-border px-1.5 py-0.5 rounded">
              <Tag size={8} />
              {tag}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Add entry form ───────────────────────────────────────────────────────────

interface AddEntryFormProps {
  onAdd:    (entry: MemoryEntry) => void;
  onCancel: () => void;
}

function AddEntryForm({ onAdd, onCancel }: AddEntryFormProps) {
  const [type,       setType]    = useState<"decision" | "pattern" | "context">("context");
  const [title,      setTitle]   = useState("");
  const [content,    setContent] = useState("");
  const [tagsInput,  setTagsInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [showTypeMenu, setShowTypeMenu] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !content.trim()) return;
    setSubmitting(true);
    const tags = tagsInput.split(",").map(t => t.trim()).filter(Boolean);
    const res = await fetch("/api/memory/entries", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ type, title: title.trim(), content: content.trim(), tags }),
    });
    if (res.ok) {
      const { entry } = await res.json() as { entry: MemoryEntry };
      onAdd(entry);
    }
    setSubmitting(false);
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-panel border border-border bg-paper p-4 space-y-3">
      <div className="flex items-center justify-between mb-1">
        <p className="text-body font-semibold text-ink">Add context</p>
        <button type="button" onClick={onCancel} className="text-muted hover:text-ink transition-colors">
          <X size={14} />
        </button>
      </div>

      {/* Type */}
      <div className="relative">
        <button
          type="button"
          onClick={() => setShowTypeMenu(v => !v)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-paper text-body text-ink hover:border-ink/30 transition-colors"
        >
          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${TYPE_BADGE[type].cls}`}>
            {TYPE_BADGE[type].label}
          </span>
          <ChevronDown size={12} className="text-muted" />
        </button>
        {showTypeMenu && (
          <div className="absolute left-0 top-full mt-1 rounded-lg border border-border bg-paper shadow-lg z-20 py-1 w-36">
            {ENTRY_TYPES.map(t => (
              <button
                key={t}
                type="button"
                onClick={() => { setType(t); setShowTypeMenu(false); }}
                className={`w-full text-left px-3 py-1.5 text-body hover:bg-surface transition-colors ${type === t ? "font-semibold text-ink" : "text-muted"}`}
              >
                {TYPE_BADGE[t].label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Title */}
      <input
        type="text"
        placeholder="Title"
        value={title}
        onChange={e => setTitle(e.target.value)}
        required
        className="w-full px-3 py-2 text-body rounded-lg border border-border bg-paper text-ink placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-ink/20 focus:border-ink/30 transition-colors"
      />

      {/* Content */}
      <textarea
        placeholder="Describe the decision, pattern, or context in detail…"
        value={content}
        onChange={e => setContent(e.target.value)}
        required
        rows={4}
        className="w-full px-3 py-2 text-body rounded-lg border border-border bg-paper text-ink placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-ink/20 focus:border-ink/30 transition-colors resize-none"
      />

      {/* Tags */}
      <input
        type="text"
        placeholder="Tags (comma-separated): typography, navigation…"
        value={tagsInput}
        onChange={e => setTagsInput(e.target.value)}
        className="w-full px-3 py-2 text-body rounded-lg border border-border bg-paper text-ink placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-ink/20 focus:border-ink/30 transition-colors"
      />

      <div className="flex gap-2 justify-end pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-1.5 text-body text-muted hover:text-ink transition-colors"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={submitting || !title.trim() || !content.trim()}
          className="px-4 py-1.5 rounded-lg bg-ink text-paper text-body font-medium hover:bg-ink/80 transition-colors disabled:opacity-40"
        >
          {submitting ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}

// ─── Skeleton ────────────────────────────────────────────────────────────────

function AnswerSkeleton() {
  return (
    <div className="rounded-panel border border-border bg-paper p-5 space-y-3">
      <div className="flex items-start gap-3">
        <div className="skeleton w-4 h-4 rounded-full shrink-0 mt-0.5" />
        <div className="flex-1 space-y-2">
          <div className="skeleton h-4 w-full rounded" />
          <div className="skeleton h-4 w-5/6 rounded" />
          <div className="skeleton h-4 w-4/6 rounded" />
        </div>
      </div>
      <div className="pl-7 space-y-2">
        <div className="skeleton h-3 w-20 rounded" />
        <div className="skeleton h-3 w-3/4 rounded" />
        <div className="skeleton h-3 w-2/3 rounded" />
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function MemoryPage() {
  const [query,      setQuery]    = useState("");
  const [answer,     setAnswer]   = useState<MemoryAnswer | null>(null);
  const [asking,     setAsking]   = useState(false);
  const [entries,    setEntries]  = useState<MemoryEntry[]>([]);
  const [showForm,   setShowForm] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Load existing entries
  useEffect(() => {
    fetch("/api/memory/entries")
      .then(r => r.json())
      .then((d: { entries?: MemoryEntry[] }) => setEntries(d.entries ?? []))
      .catch(() => {});
  }, []);

  // Auto-grow textarea
  function handleQueryChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setQuery(e.target.value);
    const el = e.target;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }

  const submitQuery = useCallback(async (q: string) => {
    const trimmed = q.trim();
    if (!trimmed || asking) return;
    setQuery(trimmed);
    setAsking(true);
    setAnswer(null);
    try {
      const res = await fetch("/api/memory/search", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ query: trimmed }),
      });
      const data = await res.json() as MemoryAnswer;
      setAnswer(data);
    } catch {
      setAnswer({ answer: "Something went wrong. Please try again.", confidence: "low", sources: [], suggestions: [] });
    } finally {
      setAsking(false);
    }
  }, [asking]);

  function handleSuggestionClick(q: string) {
    setQuery(q);
    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
    submitQuery(q);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      submitQuery(query);
    }
  }

  function handleEntryAdded(entry: MemoryEntry) {
    setEntries(prev => [entry, ...prev]);
    setShowForm(false);
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-paper">

      {/* ── Header ── */}
      <div className="px-6 pt-6 pb-5 border-b border-border shrink-0">
        <div className="flex items-center gap-2.5 mb-1">
          <BookOpen size={18} className="text-muted shrink-0" />
          <h1 className="text-title font-semibold text-ink">Memory</h1>
        </div>
        <p className="text-body text-muted">Ask questions about your team's decisions and design history</p>
      </div>

      {/* ── Content ── */}
      <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6">

        {/* ── Ask section ── */}
        <div className="space-y-3 max-w-2xl">
          <div className="relative">
            <textarea
              ref={textareaRef}
              rows={3}
              value={query}
              onChange={handleQueryChange}
              onKeyDown={handleKeyDown}
              placeholder={`Ask anything… e.g. "Why did we change the navigation?" or "What decisions were made about typography?"`}
              className="w-full px-4 py-3 text-body rounded-xl border border-border bg-paper text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-ink/10 focus:border-ink/30 transition-colors resize-none leading-relaxed"
              style={{ minHeight: "80px" }}
            />
          </div>
          <div className="flex items-center justify-between">
            <p className="text-caption text-muted">⌘↵ to submit</p>
            <button
              onClick={() => submitQuery(query)}
              disabled={!query.trim() || asking}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-ink text-paper text-body font-medium hover:bg-ink/80 transition-colors disabled:opacity-40"
            >
              <Sparkles size={14} />
              {asking ? "Thinking…" : "Ask"}
            </button>
          </div>
        </div>

        {/* ── Answer ── */}
        {asking && <div className="max-w-2xl"><AnswerSkeleton /></div>}
        {!asking && answer && (
          <div className="max-w-2xl">
            <AnswerCard answer={answer} onSuggestionClick={handleSuggestionClick} />
          </div>
        )}

        {/* ── Saved context ── */}
        <div className="max-w-2xl space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-body font-semibold text-ink">Saved Context</p>
              <p className="text-caption text-muted">
                {entries.length > 0
                  ? `${entries.length} entr${entries.length !== 1 ? "ies" : "y"} — used by the AI when answering questions`
                  : "Add context that the AI can reference when answering questions"}
              </p>
            </div>
            {!showForm && (
              <button
                onClick={() => setShowForm(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-body text-muted hover:text-ink hover:border-ink/30 transition-colors"
              >
                <Plus size={13} />
                Add
              </button>
            )}
          </div>

          {showForm && (
            <AddEntryForm
              onAdd={handleEntryAdded}
              onCancel={() => setShowForm(false)}
            />
          )}

          {entries.length === 0 && !showForm ? (
            <div className="rounded-panel border border-dashed border-border bg-surface p-8 text-center">
              <BookOpen size={24} className="text-wash mx-auto mb-2" />
              <p className="text-body text-muted font-medium">No saved context yet</p>
              <p className="text-caption text-muted mt-1 max-w-xs mx-auto">
                Decisions are automatically indexed as your team resolves feedback.
                Add extra context here to help the AI answer better.
              </p>
              <button
                onClick={() => setShowForm(true)}
                className="mt-4 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-body text-muted hover:text-ink hover:border-ink/30 transition-colors"
              >
                <Plus size={13} />
                Add context
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {entries.map(entry => (
                <EntryCard key={entry.id} entry={entry} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
