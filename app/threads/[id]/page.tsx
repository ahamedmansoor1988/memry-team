import { createAdminClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import { ExternalLink } from "lucide-react";

const SOURCE_LABEL: Record<string, string> = {
  slack: "Slack", figma: "Figma", jira: "Jira", notion: "Notion",
};

const CLASS_STYLE: Record<string, string> = {
  decision: "bg-blue-500/10 text-blue-400 border border-blue-500/20",
  blocker:  "bg-red-500/10  text-red-400  border border-red-500/20",
  risk:     "bg-amber-500/10 text-amber-400 border border-amber-500/20",
  question: "bg-purple-500/10 text-purple-400 border border-purple-500/20",
  vague:    "bg-gray-500/10 text-gray-400 border border-gray-500/20",
  noise:    "bg-gray-500/10 text-gray-400 border border-gray-500/20",
};

function fmt(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

export default async function ThreadPage({ params }: { params: { id: string } }) {
  const admin = createAdminClient();

  const [threadRes, commentsRes, decisionRes, summaryRes] = await Promise.all([
    admin.from("threads").select("*").eq("id", params.id).maybeSingle(),
    admin.from("comments").select("*").eq("thread_id", params.id).is("deleted_at", null).order("sequence_order"),
    admin.from("decisions").select("*").eq("thread_id", params.id).maybeSingle(),
    admin.from("summaries").select("*").eq("thread_id", params.id).maybeSingle(),
  ]);

  const thread   = threadRes.data   as any;
  const comments = (commentsRes.data ?? []) as any[];
  const decision = decisionRes.data as any;
  const summary  = summaryRes.data  as any;

  if (!thread) notFound();

  const cls = thread.classification as string | null;

  return (
    <div className="min-h-screen bg-background text-text">
      <div className="max-w-2xl mx-auto px-6 py-12">

        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-xs text-text-3 uppercase tracking-wider font-medium">
              {SOURCE_LABEL[thread.source] ?? thread.source}
            </span>
            {cls && (
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${CLASS_STYLE[cls] ?? ""}`}>
                {cls}
              </span>
            )}
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
              thread.status === "resolved" ? "bg-green-500/10 text-green-400" : "bg-amber-500/10 text-amber-400"
            }`}>
              {thread.status}
            </span>
          </div>
          <h1 className="text-2xl font-semibold text-text mb-2">
            {thread.title ?? "Untitled thread"}
          </h1>
          <div className="flex items-center gap-3 text-xs text-text-3">
            <span>{fmt(thread.created_at)}</span>
            {thread.source_url && (
              <a href={thread.source_url} target="_blank" rel="noopener noreferrer"
                 className="flex items-center gap-1 hover:text-text transition-colors">
                View in {SOURCE_LABEL[thread.source]} <ExternalLink size={11} />
              </a>
            )}
          </div>
        </div>

        {/* Decision box */}
        {decision && (
          <div className="bg-blue-500/5 border border-blue-500/20 rounded-xl p-5 mb-6 space-y-3">
            <p className="text-xs font-semibold text-blue-400 uppercase tracking-wider">Decision captured</p>
            <div>
              <p className="text-xs text-text-3 mb-0.5">What</p>
              <p className="text-sm text-text">{decision.what}</p>
            </div>
            {decision.why && (
              <div>
                <p className="text-xs text-text-3 mb-0.5">Why</p>
                <p className="text-sm text-text">{decision.why}</p>
              </div>
            )}
            {decision.who && (
              <div>
                <p className="text-xs text-text-3 mb-0.5">Who</p>
                <p className="text-sm text-text">{decision.who}</p>
              </div>
            )}
            {decision.rejected_alternatives?.length > 0 && (
              <div>
                <p className="text-xs text-text-3 mb-0.5">Alternatives considered</p>
                <ul className="list-disc list-inside space-y-0.5">
                  {decision.rejected_alternatives.map((alt: string, i: number) => (
                    <li key={i} className="text-sm text-text-2">{alt}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* Summary box */}
        {summary && (
          <div className="bg-surface border border-border rounded-xl p-5 mb-6">
            <p className="text-xs font-semibold text-text-3 uppercase tracking-wider mb-2">Summary</p>
            <p className="text-sm text-text-2 leading-relaxed whitespace-pre-wrap">{summary.summary_text}</p>
          </div>
        )}

        {/* Comments */}
        <div className="space-y-4">
          <p className="text-xs font-semibold text-text-3 uppercase tracking-wider">
            {comments.length} comment{comments.length !== 1 ? "s" : ""}
          </p>
          {comments.map((c: any) => (
            <div key={c.id} className="bg-surface border border-border rounded-xl p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-text">{c.author_name ?? "Unknown"}</span>
                <span className="text-xs text-text-3">{fmt(c.created_at)}</span>
              </div>
              <p className="text-sm text-text-2 leading-relaxed whitespace-pre-wrap">{c.body}</p>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="mt-12 pt-6 border-t border-border text-center">
          <p className="text-xs text-text-3">Captured by <span className="font-semibold text-text">Memry</span></p>
        </div>

      </div>
    </div>
  );
}
