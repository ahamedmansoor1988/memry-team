"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { ExternalLink, BrainCircuit, RefreshCw } from "lucide-react";

const SOURCE_EMOJI: Record<string, string> = {
  slack: "💬", figma: "🎨", jira: "📋", notion: "📝",
};

const CLASS_STYLE: Record<string, { bg: string; text: string; label: string }> = {
  decision: { bg: "bg-blue-500/10",   text: "text-blue-400",   label: "Decision" },
  blocker:  { bg: "bg-red-500/10",    text: "text-red-400",    label: "Blocker"  },
  risk:     { bg: "bg-amber-500/10",  text: "text-amber-400",  label: "Risk"     },
  question: { bg: "bg-purple-500/10", text: "text-purple-400", label: "Question" },
  vague:    { bg: "bg-gray-500/10",   text: "text-gray-400",   label: "Vague"    },
  noise:    { bg: "bg-gray-500/10",   text: "text-gray-400",   label: "Noise"    },
};

const FILTERS = ["all", "decision", "blocker", "risk", "question"] as const;
type Filter = (typeof FILTERS)[number];

interface ThreadRow {
  id: string;
  title: string | null;
  source: string;
  source_url: string | null;
  classification: string | null;
  status: string;
  created_at: string;
  decisions: Array<{ what: string; why: string | null; who: string | null }>;
}

function fmt(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default function DecisionsPage() {
  const [threads, setThreads] = useState<ThreadRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter]   = useState<Filter>("all");
  const [search, setSearch]   = useState("");

  const fetchThreads = useCallback(async () => {
    setLoading(true);
    const res  = await fetch("/api/decisions");
    const data = res.ok ? await res.json() as ThreadRow[] : [];
    setThreads(data);
    setLoading(false);
  }, []);

  useEffect(() => { fetchThreads(); }, [fetchThreads]);

  const visible = threads.filter(t => {
    if (filter !== "all" && t.classification !== filter) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        (t.title ?? "").toLowerCase().includes(q) ||
        t.decisions.some(d => d.what.toLowerCase().includes(q))
      );
    }
    return true;
  });

  return (
    <div className="max-w-3xl mx-auto px-6 py-10">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-text mb-1">Decisions</h1>
          <p className="text-sm text-text-2">Every decision captured across all your tools.</p>
        </div>
        <button onClick={fetchThreads} className="flex items-center gap-1 text-xs text-text-3 hover:text-text transition-colors">
          <RefreshCw size={11} /> Refresh
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-6">
        {FILTERS.map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`text-xs px-3 py-1.5 rounded-full font-medium transition-colors capitalize ${
              filter === f ? "bg-accent text-accent-ink" : "bg-surface border border-border text-text-3 hover:text-text"
            }`}>
            {f === "all" ? "All" : CLASS_STYLE[f]?.label ?? f}
          </button>
        ))}
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search…"
          className="ml-auto text-sm bg-surface border border-border rounded-lg px-3 py-1.5 text-text placeholder:text-text-3 outline-none focus:border-accent-border transition-colors w-48" />
      </div>

      {loading ? (
        <div className="space-y-3">
          {[0,1,2,3].map(i => <div key={i} className="h-24 bg-surface border border-border rounded-xl skeleton" />)}
        </div>
      ) : visible.length === 0 ? (
        <div className="bg-surface border border-border rounded-xl p-10 text-center">
          <div className="w-12 h-12 rounded-xl bg-accent-soft flex items-center justify-center mx-auto mb-4">
            <BrainCircuit size={22} className="text-accent-text" />
          </div>
          <h2 className="text-base font-semibold text-text mb-2">
            {threads.length === 0 ? "No threads captured yet" : "No matches"}
          </h2>
          <p className="text-sm text-text-2">
            {threads.length === 0
              ? "Decisions appear here automatically once your team starts discussing."
              : "Try a different filter or search term."}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {visible.map(t => {
            const cls = t.classification ? CLASS_STYLE[t.classification] : null;
            const dec = t.decisions[0];
            return (
              <div key={t.id} className="bg-surface border border-border rounded-xl p-4 hover:border-accent-border transition-colors">
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-base">{SOURCE_EMOJI[t.source] ?? "📌"}</span>
                    <span className="text-sm font-medium text-text">{t.title ?? "Untitled"}</span>
                    {cls && (
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${cls.bg} ${cls.text}`}>{cls.label}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {t.source_url && (
                      <a href={t.source_url} target="_blank" rel="noopener noreferrer" className="text-text-3 hover:text-text transition-colors">
                        <ExternalLink size={13} />
                      </a>
                    )}
                    <Link href={`/threads/${t.id}`} className="text-xs text-accent-text hover:underline">View →</Link>
                  </div>
                </div>
                {dec && <p className="text-xs text-text-2 line-clamp-2 mb-2">{dec.what}</p>}
                <p className="text-xs text-text-3">{fmt(t.created_at)}</p>
              </div>
            );
          })}
        </div>
      )}

      {!loading && (
        <p className="mt-6 text-xs text-text-3 text-center">
          {visible.length} of {threads.length} thread{threads.length !== 1 ? "s" : ""}
        </p>
      )}
    </div>
  );
}
