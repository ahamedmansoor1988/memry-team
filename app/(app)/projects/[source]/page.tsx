"use client";

import { useState, useEffect, use } from "react";
import Link from "next/link";
import { ArrowLeft, ExternalLink } from "lucide-react";

const SOURCE_EMOJI: Record<string, string> = {
  slack: "💬", figma: "🎨", jira: "📋", notion: "📝",
};
const SOURCE_LABEL: Record<string, string> = {
  slack: "Slack", figma: "Figma", jira: "Jira", notion: "Notion",
};
const CLS_COLOR: Record<string, string> = {
  decision: "bg-blue-500/10 text-blue-400 border border-blue-500/20",
  blocker:  "bg-red-500/10 text-red-400 border border-red-500/20",
  risk:     "bg-amber-500/10 text-amber-400 border border-amber-500/20",
  question: "bg-purple-500/10 text-purple-400 border border-purple-500/20",
};
const FILTERS = ["all", "decision", "blocker", "risk", "question"] as const;

interface Thread {
  id: string;
  title: string | null;
  source: string;
  source_url: string | null;
  classification: string | null;
  status: string;
  created_at: string;
}

export default function SourceProjectsPage({ params }: { params: Promise<{ source: string }> }) {
  const { source } = use(params);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [filter, setFilter]   = useState<typeof FILTERS[number]>("all");
  const [search, setSearch]   = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/decisions")
      .then(r => r.json())
      .then((data: Thread[]) => {
        setThreads(data.filter(t => t.source === source));
        setLoading(false);
      });
  }, [source]);

  const label = SOURCE_LABEL[source] ?? source;
  const emoji = SOURCE_EMOJI[source] ?? "📌";

  const visible = threads.filter(t => {
    if (filter !== "all" && t.classification !== filter) return false;
    if (search) {
      const q = search.toLowerCase();
      return (t.title ?? "").toLowerCase().includes(q);
    }
    return true;
  });

  return (
    <div className="max-w-3xl mx-auto px-6 py-10">
      <Link href="/projects" className="inline-flex items-center gap-1.5 text-xs text-text-3 hover:text-text mb-6 transition-colors">
        <ArrowLeft size={13} /> Projects
      </Link>

      <div className="mb-6 flex items-center gap-3">
        <span className="text-3xl">{emoji}</span>
        <div>
          <h1 className="text-xl font-semibold text-text">{label}</h1>
          <p className="text-xs text-text-3">{threads.length} thread{threads.length !== 1 ? "s" : ""} captured</p>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search threads…"
          className="flex-1 bg-surface border border-border rounded-lg px-3 py-2 text-sm text-text placeholder:text-text-3 outline-none focus:border-accent-border transition-colors"
        />
        <div className="flex gap-1 flex-wrap">
          {FILTERS.map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition-colors ${
                filter === f ? "bg-accent text-accent-ink" : "bg-surface border border-border text-text-2 hover:border-accent-border"
              }`}>
              {f}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[0,1,2].map(i => <div key={i} className="h-16 bg-surface border border-border rounded-xl skeleton" />)}
        </div>
      ) : visible.length === 0 ? (
        <div className="bg-surface border border-border rounded-xl p-8 text-center">
          <p className="text-sm text-text-2">No threads match your filters.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {visible.map(t => (
            <div key={t.id} className="bg-surface border border-border rounded-xl px-4 py-3 flex items-center gap-4 hover:border-accent-border transition-colors">
              <div className="flex-1 min-w-0">
                <Link href={`/threads/${t.id}`} className="text-sm font-medium text-text hover:text-accent-text transition-colors truncate block">
                  {t.title ?? "Untitled thread"}
                </Link>
                <p className="text-xs text-text-3 mt-0.5">
                  {new Date(t.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {t.classification && (
                  <span className={`text-2xs px-2 py-0.5 rounded-full font-medium capitalize ${CLS_COLOR[t.classification] ?? "bg-surface border border-border text-text-3"}`}>
                    {t.classification}
                  </span>
                )}
                {t.source_url && (
                  <a href={t.source_url} target="_blank" rel="noopener noreferrer"
                    className="text-text-3 hover:text-text transition-colors" title="Open in source">
                    <ExternalLink size={13} />
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
