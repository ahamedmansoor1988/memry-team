"use client";
import { useState, useEffect } from "react";
import { Loader2, MessageSquare, CheckCircle2, AlertTriangle, Clock, TrendingUp } from "lucide-react";

interface FeedbackItem {
  id: string; status: string; priority: string;
  ai_classification: string | null;
  ai_risk_flag: boolean; ai_vague_flag: boolean;
  ai_key_question: string | null;
  created_at: string;
  figma_comment: { author_name: string; raw_content: string; figma_created_at: string; } | null;
  project: { id: string; name: string } | null;
}

function isStalled(item: FeedbackItem): boolean {
  if (item.status === "resolved" || item.status === "dismissed") return false;
  return Date.now() - new Date(item.created_at).getTime() > 48 * 60 * 60 * 1000;
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

export default function DashboardPage() {
  const [items, setItems] = useState<FeedbackItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/feedback")
      .then(r => r.json())
      .then((d: { items?: FeedbackItem[] }) => {
        setItems(d.items ?? []);
        setLoading(false);
      });
  }, []);

  const needsDecision = items.filter(i => i.ai_classification === "Needs Decision" || i.ai_classification === "Blocked").length;
  const stalled       = items.filter(isStalled).length;
  const risks         = items.filter(i => i.ai_risk_flag || i.ai_classification === "Risk" || i.ai_classification === "Blocked").length;
  const vague         = items.filter(i => i.ai_vague_flag).length;

  const stats = [
    { label: "Open Decisions",   value: needsDecision, icon: <MessageSquare size={18} />,  color: "text-blue-500",    bg: "bg-blue-50" },
    { label: "Stalled Items",    value: stalled,        icon: <Clock size={18} />,           color: "text-orange-500",  bg: "bg-orange-50" },
    { label: "Vague Comments",   value: vague,          icon: <TrendingUp size={18} />,      color: "text-yellow-500",  bg: "bg-yellow-50" },
    { label: "Risks Detected",   value: risks,          icon: <AlertTriangle size={18} />,   color: "text-red-500",     bg: "bg-red-50" },
  ];

  // Top issues: stalled + risk items
  const topIssues = items
    .filter(i => isStalled(i) || i.ai_risk_flag || i.ai_classification === "Blocked")
    .slice(0, 5);

  // Recent decisions
  const recentDecisions = items
    .filter(i => i.status === "resolved")
    .slice(0, 5);

  // Project breakdown
  const projectMap: Record<string, { name: string; open: number; resolved: number }> = {};
  items.forEach(item => {
    if (!item.project) return;
    if (!projectMap[item.project.id]) projectMap[item.project.id] = { name: item.project.name, open: 0, resolved: 0 };
    if (item.status === "open") projectMap[item.project.id].open++;
    if (item.status === "resolved") projectMap[item.project.id].resolved++;
  });
  const projects = Object.values(projectMap).sort((a, b) => b.open - a.open).slice(0, 4);

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-[#f5f5f7]">
      <div className="px-8 pt-7 pb-5">
        <h1 className="text-gray-900 text-2xl font-bold tracking-tight mb-0.5">Dashboard</h1>
        <p className="text-gray-400 text-sm">Overview of all feedback across your workspace</p>
      </div>

      <div className="flex-1 overflow-y-auto px-8 pb-8">
        {loading ? (
          <div className="flex items-center justify-center p-12 text-gray-400">
            <Loader2 size={18} className="animate-spin mr-2" /> Loading…
          </div>
        ) : (
          <div className="space-y-6">
            {/* Stat cards */}
            <div className="grid grid-cols-4 gap-4">
              {stats.map(stat => (
                <div key={stat.label} className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
                  <div className={`w-9 h-9 rounded-xl ${stat.bg} ${stat.color} flex items-center justify-center mb-3`}>
                    {stat.icon}
                  </div>
                  <p className="text-gray-900 text-3xl font-bold mb-1">{stat.value}</p>
                  <p className="text-gray-400 text-sm">{stat.label}</p>
                </div>
              ))}
            </div>

            {/* Two column row */}
            <div className="grid grid-cols-2 gap-4">
              {/* Top issues */}
              <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
                <p className="text-gray-900 text-sm font-bold mb-4">Top Issues</p>
                {topIssues.length === 0 ? (
                  <p className="text-gray-400 text-sm text-center py-6">No active issues 🎉</p>
                ) : (
                  <div className="space-y-3">
                    {topIssues.map(item => {
                      void isStalled(item);
                      const blocked = item.ai_classification === "Blocked";
                      const diff = Math.floor((Date.now() - new Date(item.created_at).getTime()) / 86400000);
                      return (
                        <div key={item.id} className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${blocked ? "bg-red-400" : "bg-orange-400"}`} />
                            <p className="text-gray-600 text-sm truncate">
                              {item.ai_key_question ?? item.figma_comment?.raw_content ?? "—"}
                            </p>
                          </div>
                          <span className="text-gray-400 text-xs flex-shrink-0">{diff}d</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Recent decisions */}
              <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
                <p className="text-gray-900 text-sm font-bold mb-4">Recent Decisions</p>
                {recentDecisions.length === 0 ? (
                  <p className="text-gray-400 text-sm text-center py-6">No decisions yet</p>
                ) : (
                  <div className="space-y-3">
                    {recentDecisions.map(item => (
                      <div key={item.id} className="flex items-center gap-2">
                        <CheckCircle2 size={13} className="text-emerald-400 flex-shrink-0" />
                        <p className="text-gray-600 text-sm truncate flex-1">
                          {item.ai_key_question ?? item.figma_comment?.raw_content ?? "—"}
                        </p>
                        <span className="text-gray-400 text-xs flex-shrink-0">{timeAgo(item.created_at)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Projects breakdown */}
            {projects.length > 0 && (
              <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
                <p className="text-gray-900 text-sm font-bold mb-4">Projects</p>
                <div className="space-y-3">
                  {projects.map(project => {
                    const total = project.open + project.resolved;
                    const pct = total > 0 ? Math.round((project.resolved / total) * 100) : 0;
                    return (
                      <div key={project.name}>
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-gray-700 text-sm font-medium">{project.name}</span>
                          <span className="text-gray-400 text-xs">{project.open} open · {project.resolved} resolved</span>
                        </div>
                        <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-emerald-400 rounded-full transition-all"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
