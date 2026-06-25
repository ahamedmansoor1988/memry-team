"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { FolderKanban } from "lucide-react";

const SOURCE_EMOJI: Record<string, string> = {
  slack: "💬", figma: "🎨", jira: "📋", notion: "📝",
};
const SOURCE_LABEL: Record<string, string> = {
  slack: "Slack", figma: "Figma", jira: "Jira", notion: "Notion",
};

interface SourceGroup {
  source: string;
  total: number;
  decision: number;
  blocker: number;
  risk: number;
  question: number;
  latest: string | null;
}

export default function ProjectsPage() {
  const [groups, setGroups]   = useState<SourceGroup[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/projects")
      .then(r => r.json())
      .then((data: SourceGroup[]) => { setGroups(data); setLoading(false); });
  }, []);

  return (
    <div className="max-w-3xl mx-auto px-6 py-10">
      <div className="mb-8">
        <h1 className="text-xl font-semibold text-text mb-1">Projects</h1>
        <p className="text-sm text-text-2">Threads grouped by tool — decisions, blockers, and risks at a glance.</p>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {[0,1,2,3].map(i => <div key={i} className="h-36 bg-surface border border-border rounded-xl skeleton" />)}
        </div>
      ) : groups.length === 0 ? (
        <div className="bg-surface border border-border rounded-xl p-10 text-center">
          <div className="w-12 h-12 rounded-xl bg-accent-soft flex items-center justify-center mx-auto mb-4">
            <FolderKanban size={22} className="text-accent-text" />
          </div>
          <h2 className="text-base font-semibold text-text mb-2">No threads yet</h2>
          <p className="text-sm text-text-2">Threads appear here once your tools start capturing discussions.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {groups.map(g => (
            <Link key={g.source} href={`/projects/${g.source}`}
              className="bg-surface border border-border rounded-xl p-5 hover:border-accent-border transition-colors block">
              <div className="flex items-center gap-3 mb-4">
                <span className="text-2xl">{SOURCE_EMOJI[g.source] ?? "📌"}</span>
                <div>
                  <p className="text-sm font-semibold text-text">{SOURCE_LABEL[g.source] ?? g.source}</p>
                  <p className="text-xs text-text-3">{g.total} thread{g.total !== 1 ? "s" : ""}</p>
                </div>
              </div>
              <div className="grid grid-cols-4 gap-2 text-center">
                {[
                  { label: "Decisions", val: g.decision, color: "text-blue-400" },
                  { label: "Blockers",  val: g.blocker,  color: "text-red-400"  },
                  { label: "Risks",     val: g.risk,     color: "text-amber-400"},
                  { label: "Questions", val: g.question, color: "text-purple-400"},
                ].map(({ label, val, color }) => (
                  <div key={label}>
                    <p className={`text-lg font-semibold ${color}`}>{val}</p>
                    <p className="text-2xs text-text-3">{label}</p>
                  </div>
                ))}
              </div>
              {g.latest && (
                <p className="text-xs text-text-3 mt-4">
                  Last activity {new Date(g.latest).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                </p>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
