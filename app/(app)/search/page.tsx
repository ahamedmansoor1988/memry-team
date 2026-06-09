"use client";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";

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

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_CLS: Record<string, string> = {
  open:           "bg-zinc-100 text-zinc-600 border border-zinc-200",
  needs_decision: "bg-zinc-100 text-zinc-600 border border-zinc-200",
  resolved:       "bg-zinc-100 text-zinc-700 border border-zinc-200",
  archived:       "bg-gray-100 text-gray-500 border border-gray-200",
};

const STATUS_LABEL: Record<string, string> = {
  open:           "Open",
  needs_decision: "Needs Decision",
  resolved:       "Resolved",
  archived:       "Archived",
};

const CLASS_CLS: Record<string, string> = {
  "Needs Decision": "bg-zinc-100 text-zinc-600 border border-zinc-200",
  "Blocked":        "bg-red-50 text-red-600 border border-red-200",
  "Approved":       "bg-zinc-100 text-zinc-700 border border-zinc-200",
  "Risk":           "bg-zinc-100 text-zinc-600 border border-zinc-200",
  "Vague":          "bg-zinc-100 text-zinc-600 border border-zinc-200",
  "Info":           "bg-zinc-100 text-zinc-600 border border-zinc-200",
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

function resultTitle(r: SearchResult): string {
  if (r.ai_key_question && r.ai_key_question !== "None") return r.ai_key_question;
  if (r.ai_summary) return r.ai_summary;
  if (r.raw_content) return r.raw_content;
  return "—";
}

// ─── Result card ─────────────────────────────────────────────────────────────

function ResultCard({ result, onClick }: { result: SearchResult; onClick: () => void }) {
  const title    = resultTitle(result);
  const statusCls = STATUS_CLS[result.status] ?? STATUS_CLS.open;
  const classCls  = result.ai_classification ? (CLASS_CLS[result.ai_classification] ?? null) : null;

  return (
    <div
      onClick={onClick}
      className="rounded-panel border border-border bg-paper p-4 cursor-pointer hover:border-ink/20 transition-colors"
    >
      {/* Title */}
      <p className="text-body font-medium text-ink line-clamp-2 leading-snug mb-2">{title}</p>

      {/* Badges */}
      <div className="flex items-center gap-1.5 flex-wrap mb-2">
        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded text-nowrap ${statusCls}`}>
          {STATUS_LABEL[result.status] ?? result.status}
        </span>
        {classCls && (
          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${classCls}`}>
            {result.ai_classification}
          </span>
        )}
        {result.ai_risk_flag && (
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-red-50 text-red-600 border border-red-200">
            RISK
          </span>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center gap-2 text-caption text-muted flex-wrap">
        {result.project_name && <span>{result.project_name}</span>}
        {result.author_name && (
          <>
            <span className="opacity-40">·</span>
            <span>{result.author_name}</span>
          </>
        )}
        <span className="ml-auto">{timeAgo(result.updated_at)}</span>
      </div>
    </div>
  );
}

// ─── Skeleton ────────────────────────────────────────────────────────────────

function SearchSkeleton() {
  return (
    <div className="space-y-2">
      {[1, 2, 3].map(n => (
        <div key={n} className="rounded-panel border border-border bg-paper p-4 space-y-2">
          <div className="skeleton h-4 w-2/3 rounded mb-2" />
          <div className="flex gap-1.5">
            <div className="skeleton h-4 w-16 rounded" />
            <div className="skeleton h-4 w-20 rounded" />
          </div>
          <div className="skeleton h-3 w-1/3 rounded" />
        </div>
      ))}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function SearchPage() {
  const router    = useRouter();
  const inputRef  = useRef<HTMLInputElement>(null);
  const [query,   setQuery]   = useState("");
  const [draft,   setDraft]   = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  // Autofocus on mount
  useEffect(() => { inputRef.current?.focus(); }, []);

  function runSearch(q: string) {
    const trimmed = q.trim();
    if (!trimmed) return;
    setQuery(trimmed);
    setLoading(true);
    setSearched(true);
    fetch(`/api/search?q=${encodeURIComponent(trimmed)}`)
      .then(r => r.json())
      .then((d: { results?: SearchResult[] }) => {
        setResults(d.results ?? []);
        setLoading(false);
      })
      .catch(() => { setResults([]); setLoading(false); });
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") runSearch(draft);
  }

  function handleClick(result: SearchResult) {
    if (result.project_id) router.push(`/inbox/${result.project_id}/${result.id}`);
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-paper">

      {/* Header + search bar */}
      <div className="px-6 pt-6 pb-5 border-b border-border shrink-0">
        <div className="flex items-center gap-2.5 mb-4">
          <Search size={18} className="text-muted shrink-0" />
          <h1 className="text-title font-semibold text-ink">Search</h1>
        </div>

        {/* Search input */}
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
            <input
              ref={inputRef}
              type="text"
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Search feedback, questions, summaries…"
              className="w-full pl-8 pr-3 py-2.5 text-body rounded-lg border border-border bg-paper text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-ink/10 focus:border-ink/30 transition-colors"
            />
          </div>
          <button
            onClick={() => runSearch(draft)}
            disabled={!draft.trim() || loading}
            className="px-4 py-2.5 rounded-lg bg-ink text-paper text-body font-medium hover:bg-ink/80 transition-colors disabled:opacity-40"
          >
            Search
          </button>
        </div>
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto px-6 py-5">
        {!searched ? (
          <div className="flex flex-col items-center justify-center py-24 gap-3 text-center">
            <Search size={32} className="text-wash" />
            <p className="text-lead font-medium text-ink">Search across all feedback</p>
            <p className="text-body text-muted max-w-xs">
              Find feedback items by question, summary, or classification
            </p>
          </div>
        ) : loading ? (
          <SearchSkeleton />
        ) : results.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 gap-2 text-center">
            <Search size={24} className="text-wash" />
            <p className="text-body text-muted">No results for &ldquo;{query}&rdquo;</p>
          </div>
        ) : (
          <div className="space-y-2 fade-in">
            <p className="text-caption text-muted mb-3">
              {results.length} result{results.length !== 1 ? "s" : ""}
            </p>
            {results.map(r => (
              <ResultCard key={r.id} result={r} onClick={() => handleClick(r)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
