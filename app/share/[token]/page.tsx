import { createAdminClient } from "@/lib/supabase/server";
import { CheckCircle2, AlertTriangle, Clock, MessageSquare } from "lucide-react";

interface FeedbackItem {
  id: string; status: string; priority: string;
  ai_summary: string | null; ai_classification: string | null;
  ai_key_question: string | null; ai_tags: string[] | null;
  ai_risk_flag: boolean; created_at: string;
  figma_comment: { author_name: string; raw_content: string; figma_created_at: string; figma_file: { name: string } | null } | null;
  project: { id: string; name: string } | null;
}

function timeAgo(date: string): string {
  const diff = Date.now() - new Date(date).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function isStalled(item: FeedbackItem): boolean {
  if (item.status === "resolved" || item.status === "dismissed") return false;
  return Date.now() - new Date(item.created_at).getTime() > 48 * 60 * 60 * 1000;
}

export default async function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const admin = createAdminClient();

  const { data: workspace } = await admin
    .from("workspaces")
    .select("id, name")
    .eq("id", token)
    .single();

  if (!workspace) {
    return (
      <div className="min-h-screen bg-[#f5f5f7] flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-400 text-lg font-medium">Page not found</p>
          <p className="text-gray-300 text-sm mt-1">This link may have expired or is invalid.</p>
        </div>
      </div>
    );
  }

  const { data: items } = await admin
    .from("feedback_items")
    .select(`
      id, status, priority, ai_summary, ai_classification,
      ai_key_question, ai_tags, ai_risk_flag, created_at,
      figma_comment:figma_comments(author_name, raw_content, figma_created_at,
        figma_file:figma_files(name)),
      project:projects(id, name)
    `)
    .eq("workspace_id", workspace.id)
    .order("created_at", { ascending: false });

  const allItems = (items ?? []) as unknown as FeedbackItem[];

  const open       = allItems.filter(i => i.status === "open").length;
  const resolved   = allItems.filter(i => i.status === "resolved").length;
  const risks      = allItems.filter(i => i.ai_risk_flag || i.ai_classification === "Blocked").length;
  // stalled count available if needed
  const needsDecision = allItems.filter(i => i.ai_classification === "Needs Decision" || i.ai_classification === "Blocked").length;

  const openItems     = allItems.filter(i => i.status === "open" && (i.ai_classification === "Needs Decision" || i.ai_classification === "Blocked")).slice(0, 10);
  const recentDecisions = allItems.filter(i => i.status === "resolved").slice(0, 8);
  const riskItems     = allItems.filter(i => i.ai_risk_flag || i.ai_classification === "Blocked" || isStalled(i)).slice(0, 6);

  const clsBadge: Record<string, string> = {
    "Needs Decision": "text-red-500 bg-red-50",
    "Blocked":        "text-red-500 bg-red-50",
    "Approved":       "text-emerald-600 bg-emerald-50",
    "Risk":           "text-orange-500 bg-orange-50",
    "Vague":          "text-yellow-600 bg-yellow-50",
    "Info":           "text-blue-500 bg-blue-50",
  };

  return (
    <div className="min-h-screen bg-[#f5f5f7]">
      {/* Header */}
      <div className="bg-white border-b border-gray-100 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-8 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded-lg bg-gray-900 flex items-center justify-center">
              <span className="text-white font-bold text-sm">m</span>
            </div>
            <span className="text-gray-900 font-bold text-sm">memry</span>
            <span className="text-gray-300 text-sm">/</span>
            <span className="text-gray-600 text-sm font-medium">{workspace.name}</span>
          </div>
          <span className="text-xs text-gray-400 bg-gray-100 px-3 py-1 rounded-full">Public view</span>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-8 py-10">
        {/* Title */}
        <div className="mb-8">
          <h1 className="text-gray-900 text-3xl font-bold mb-1">{workspace.name}</h1>
          <p className="text-gray-400">Project feedback status for stakeholders</p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-4 gap-4 mb-10">
          {[
            { label: "Decisions Needed", value: needsDecision, icon: <MessageSquare size={16} />, color: "text-blue-500", bg: "bg-blue-50" },
            { label: "Resolved",         value: resolved,      icon: <CheckCircle2 size={16} />,  color: "text-emerald-500", bg: "bg-emerald-50" },
            { label: "Open Items",       value: open,          icon: <Clock size={16} />,          color: "text-gray-500", bg: "bg-gray-100" },
            { label: "Risks / Blockers", value: risks,         icon: <AlertTriangle size={16} />,  color: "text-red-500", bg: "bg-red-50" },
          ].map(s => (
            <div key={s.label} className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
              <div className={`w-8 h-8 rounded-xl ${s.bg} ${s.color} flex items-center justify-center mb-3`}>{s.icon}</div>
              <p className="text-gray-900 text-2xl font-bold">{s.value}</p>
              <p className="text-gray-400 text-sm">{s.label}</p>
            </div>
          ))}
        </div>

        {/* Needs Decision */}
        {openItems.length > 0 && (
          <section className="mb-8">
            <h2 className="text-gray-900 text-lg font-bold mb-4">Needs Decision</h2>
            <div className="space-y-3">
              {openItems.map(item => (
                <div key={item.id} className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      {item.ai_classification && (
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full mb-2 inline-block ${clsBadge[item.ai_classification] ?? "text-gray-400 bg-gray-100"}`}>
                          {item.ai_classification.toUpperCase()}
                        </span>
                      )}
                      <p className="text-gray-900 text-sm font-semibold leading-snug mb-1">
                        {item.ai_key_question ?? item.figma_comment?.raw_content ?? "—"}
                      </p>
                      {item.ai_summary && (
                        <p className="text-gray-500 text-xs leading-relaxed">{item.ai_summary}</p>
                      )}
                    </div>
                    <div className="flex-shrink-0 text-right">
                      <p className="text-gray-400 text-xs">{item.figma_comment?.author_name}</p>
                      <p className="text-gray-300 text-xs">{timeAgo(item.created_at)}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 mt-3 pt-3 border-t border-gray-50">
                    <span className="text-gray-400 text-xs">{[item.project?.name, item.figma_comment?.figma_file?.name].filter(Boolean).join(" / ")}</span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Risks & Blockers */}
        {riskItems.length > 0 && (
          <section className="mb-8">
            <h2 className="text-gray-900 text-lg font-bold mb-4">Risks & Blockers</h2>
            <div className="space-y-3">
              {riskItems.map(item => (
                <div key={item.id} className="bg-white rounded-2xl border border-red-100 p-5 shadow-sm">
                  <div className="flex items-start gap-3">
                    <AlertTriangle size={14} className="text-red-400 flex-shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <p className="text-gray-900 text-sm font-semibold leading-snug mb-1">
                        {item.ai_key_question ?? item.figma_comment?.raw_content ?? "—"}
                      </p>
                      <p className="text-gray-400 text-xs">{item.project?.name} · {timeAgo(item.created_at)}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Recent Decisions */}
        {recentDecisions.length > 0 && (
          <section className="mb-8">
            <h2 className="text-gray-900 text-lg font-bold mb-4">Recent Decisions</h2>
            <div className="space-y-2">
              {recentDecisions.map(item => (
                <div key={item.id} className="bg-white rounded-2xl border border-gray-100 px-5 py-4 shadow-sm flex items-center gap-3">
                  <CheckCircle2 size={14} className="text-emerald-400 flex-shrink-0" />
                  <p className="text-gray-700 text-sm flex-1 truncate">{item.ai_key_question ?? item.figma_comment?.raw_content ?? "—"}</p>
                  <span className="text-gray-400 text-xs flex-shrink-0">{timeAgo(item.created_at)}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Footer */}
        <div className="text-center pt-6 border-t border-gray-200">
          <p className="text-gray-300 text-xs">Powered by <span className="font-semibold text-gray-400">memry.team</span></p>
        </div>
      </div>
    </div>
  );
}
