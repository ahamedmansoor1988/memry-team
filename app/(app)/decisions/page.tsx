"use client";
import { useState, useEffect } from "react";
import { Loader2, CheckCircle2, Clock, XCircle, MoreHorizontal } from "lucide-react";

interface FeedbackItem {
  id: string; status: string; priority: string;
  ai_summary: string | null; ai_classification: string | null;
  ai_key_question: string | null; ai_tags: string[] | null;
  created_at: string;
  figma_comment: {
    author_name: string; author_avatar: string | null;
    raw_content: string; figma_created_at: string;
    figma_file: { id: string; name: string; figma_file_key: string } | null;
  } | null;
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

const statusConfig: Record<string, { label: string; icon: React.ReactNode; cls: string }> = {
  resolved:    { label: "Approved",    icon: <CheckCircle2 size={13} />, cls: "text-emerald-600 bg-emerald-50" },
  in_progress: { label: "In Progress", icon: <Clock size={13} />,        cls: "text-blue-600 bg-blue-50" },
  dismissed:   { label: "Cancelled",   icon: <XCircle size={13} />,      cls: "text-gray-400 bg-gray-100" },
};

const classificationBadge: Record<string, string> = {
  "Needs Decision": "text-red-500 bg-red-50",
  "Blocked":        "text-red-500 bg-red-50",
  "Approved":       "text-emerald-600 bg-emerald-50",
  "Risk":           "text-orange-500 bg-orange-50",
  "Vague":          "text-yellow-600 bg-yellow-50",
  "Info":           "text-blue-500 bg-blue-50",
};

type StatusFilter = "all" | "resolved" | "in_progress" | "dismissed";

export default function DecisionsPage() {
  const [items, setItems] = useState<FeedbackItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  useEffect(() => {
    fetch("/api/feedback")
      .then(r => r.json())
      .then((d: { items?: FeedbackItem[] }) => {
        // Show all items that have been acted on (not just open)
        setItems(d.items ?? []);
        setLoading(false);
      });
  }, []);

  const decisionItems = items.filter(i =>
    i.status === "resolved" || i.status === "in_progress" || i.status === "dismissed"
  );

  const filtered = statusFilter === "all" ? decisionItems : decisionItems.filter(i => i.status === statusFilter);

  const counts = {
    all:         decisionItems.length,
    resolved:    decisionItems.filter(i => i.status === "resolved").length,
    in_progress: decisionItems.filter(i => i.status === "in_progress").length,
    dismissed:   decisionItems.filter(i => i.status === "dismissed").length,
  };

  const tabs: { key: StatusFilter; label: string }[] = [
    { key: "all",         label: "All" },
    { key: "resolved",    label: "Approved" },
    { key: "in_progress", label: "In Progress" },
    { key: "dismissed",   label: "Cancelled" },
  ];

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-[#f5f5f7]">
      {/* Header */}
      <div className="px-8 pt-7 pb-5 bg-[#f5f5f7]">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h1 className="text-gray-900 text-2xl font-bold tracking-tight">Decisions</h1>
            <p className="text-gray-400 text-sm mt-0.5">All resolved and in-progress feedback items</p>
          </div>
        </div>
        {/* Tabs */}
        <div className="flex items-center gap-2">
          {tabs.map(tab => {
            const active = statusFilter === tab.key;
            const count = counts[tab.key];
            return (
              <button
                key={tab.key}
                onClick={() => setStatusFilter(tab.key)}
                className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold transition-all ${
                  active ? "bg-gray-900 text-white" : "bg-white text-gray-500 hover:bg-gray-100 border border-gray-200"
                }`}
              >
                {tab.label}
                <span className={`text-xs font-bold ${active ? "text-white/70" : "text-gray-400"}`}>{count}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-y-auto px-8 pb-8">
        {loading ? (
          <div className="flex items-center justify-center p-12 text-gray-400">
            <Loader2 size={18} className="animate-spin mr-2" /> Loading…
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-16 text-center bg-white rounded-2xl border border-gray-100">
            <CheckCircle2 size={36} className="text-gray-200 mb-3" />
            <p className="text-gray-400 text-sm font-medium">No decisions yet</p>
            <p className="text-gray-300 text-xs mt-1">Resolved feedback items will appear here</p>
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden shadow-sm">
            {/* Table header */}
            <div className="grid grid-cols-[1fr_140px_120px_100px_36px] gap-4 px-5 py-3 border-b border-gray-100 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
              <span>Decision</span>
              <span>Author</span>
              <span>Project</span>
              <span>Status</span>
              <span />
            </div>

            {/* Rows */}
            {filtered.map((item, i) => {
              const sc = statusConfig[item.status] ?? statusConfig.resolved;
              const clsCls = classificationBadge[item.ai_classification ?? ""] ?? "text-gray-400 bg-gray-100";
              const authorInitial = (item.figma_comment?.author_name ?? "?")[0]?.toUpperCase();
              return (
                <div
                  key={item.id}
                  className={`grid grid-cols-[1fr_140px_120px_100px_36px] gap-4 px-5 py-4 items-center hover:bg-gray-50 transition-colors ${i < filtered.length - 1 ? "border-b border-gray-50" : ""}`}
                >
                  {/* Decision title */}
                  <div className="min-w-0">
                    {item.ai_classification && (
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full mb-1.5 inline-block ${clsCls}`}>
                        {item.ai_classification.toUpperCase()}
                      </span>
                    )}
                    <p className="text-gray-900 text-sm font-semibold line-clamp-1">
                      {item.ai_key_question ?? item.figma_comment?.raw_content ?? "—"}
                    </p>
                    <p className="text-gray-400 text-xs mt-0.5">{timeAgo(item.created_at)}</p>
                  </div>

                  {/* Author */}
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center flex-shrink-0">
                      <span className="text-gray-600 font-bold" style={{ fontSize: 10 }}>{authorInitial}</span>
                    </div>
                    <span className="text-gray-600 text-sm truncate">{item.figma_comment?.author_name ?? "—"}</span>
                  </div>

                  {/* Project */}
                  <div className="min-w-0">
                    <p className="text-gray-500 text-sm truncate">{item.project?.name ?? "—"}</p>
                    <p className="text-gray-300 text-xs truncate">{item.figma_comment?.figma_file?.name ?? ""}</p>
                  </div>

                  {/* Status */}
                  <div>
                    <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full ${sc.cls}`}>
                      {sc.icon} {sc.label}
                    </span>
                  </div>

                  {/* Actions */}
                  <button className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-300 hover:text-gray-500 hover:bg-gray-100 transition-colors">
                    <MoreHorizontal size={14} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
