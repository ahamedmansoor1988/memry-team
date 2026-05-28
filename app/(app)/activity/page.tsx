"use client";
import { useState, useEffect } from "react";
import { Loader2, MessageSquare, CheckCircle2, AlertTriangle, Sparkles, Clock } from "lucide-react";

interface FeedbackItem {
  id: string; status: string; priority: string;
  ai_summary: string | null; ai_classification: string | null;
  ai_key_question: string | null;
  ai_risk_flag: boolean; ai_vague_flag: boolean;
  created_at: string;
  figma_comment: {
    author_name: string; raw_content: string; figma_created_at: string;
    figma_file: { id: string; name: string; figma_file_key: string } | null;
  } | null;
  project: { id: string; name: string } | null;
}

interface ActivityEvent {
  id: string;
  type: "comment" | "decision" | "risk" | "ai" | "stalled";
  title: string;
  subtitle: string;
  time: string;
  project?: string;
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

const eventIcon: Record<string, React.ReactNode> = {
  comment:  <MessageSquare size={14} />,
  decision: <CheckCircle2 size={14} />,
  risk:     <AlertTriangle size={14} />,
  ai:       <Sparkles size={14} />,
  stalled:  <Clock size={14} />,
};

const eventColor: Record<string, string> = {
  comment:  "bg-blue-50 text-blue-500",
  decision: "bg-emerald-50 text-emerald-500",
  risk:     "bg-red-50 text-red-500",
  ai:       "bg-purple-50 text-purple-500",
  stalled:  "bg-orange-50 text-orange-500",
};

export default function ActivityPage() {
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

  // Build activity feed from feedback items
  const events: ActivityEvent[] = [];

  items.forEach(item => {
    const author = item.figma_comment?.author_name ?? "Someone";
    const title = item.ai_key_question ?? item.figma_comment?.raw_content ?? "Comment";
    const project = item.project?.name;
    const file = item.figma_comment?.figma_file?.name;
    const location = [project, file].filter(Boolean).join(" / ");

    // New comment event
    events.push({
      id: `comment-${item.id}`,
      type: "comment",
      title: `${author} left a comment`,
      subtitle: title,
      time: item.figma_comment?.figma_created_at ?? item.created_at,
      project: location,
    });

    // Decision made
    if (item.status === "resolved") {
      events.push({
        id: `decision-${item.id}`,
        type: "decision",
        title: "Decision made",
        subtitle: title,
        time: item.created_at,
        project: location,
      });
    }

    // Risk flagged
    if (item.ai_risk_flag || item.ai_classification === "Risk" || item.ai_classification === "Blocked") {
      events.push({
        id: `risk-${item.id}`,
        type: "risk",
        title: item.ai_classification === "Blocked" ? "Item blocked" : "Risk detected",
        subtitle: title,
        time: item.created_at,
        project: location,
      });
    }

    // Stalled
    if (isStalled(item)) {
      events.push({
        id: `stalled-${item.id}`,
        type: "stalled",
        title: "Item stalled",
        subtitle: `Waiting for decision — ${title}`,
        time: item.created_at,
        project: location,
      });
    }

    // AI classified
    if (item.ai_classification) {
      events.push({
        id: `ai-${item.id}`,
        type: "ai",
        title: `AI classified as ${item.ai_classification}`,
        subtitle: title,
        time: item.created_at,
        project: location,
      });
    }
  });

  // Sort by time, newest first
  events.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());

  // Group by day
  const grouped: { label: string; events: ActivityEvent[] }[] = [];
  const seen = new Set<string>();
  events.forEach(event => {
    const date = new Date(event.time);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    const isYesterday = date.toDateString() === new Date(now.getTime() - 86400000).toDateString();
    const label = isToday ? "Today" : isYesterday ? "Yesterday" : date.toLocaleDateString("en-US", { month: "long", day: "numeric" });
    if (!seen.has(label)) { seen.add(label); grouped.push({ label, events: [] }); }
    grouped[grouped.length - 1].events.push(event);
  });

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-[#f5f5f7]">
      <div className="px-8 pt-7 pb-5">
        <h1 className="text-gray-900 text-2xl font-bold tracking-tight mb-0.5">Activity</h1>
        <p className="text-gray-400 text-sm">Everything that happened across your projects</p>
      </div>

      <div className="flex-1 overflow-y-auto px-8 pb-8">
        {loading ? (
          <div className="flex items-center justify-center p-12 text-gray-400">
            <Loader2 size={18} className="animate-spin mr-2" /> Loading…
          </div>
        ) : events.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-16 text-center bg-white rounded-2xl border border-gray-100">
            <MessageSquare size={36} className="text-gray-200 mb-3" />
            <p className="text-gray-400 text-sm font-medium">No activity yet</p>
          </div>
        ) : (
          <div className="space-y-8">
            {grouped.map(group => (
              <div key={group.label}>
                <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">{group.label}</p>
                <div className="space-y-1">
                  {group.events.map(event => (
                    <div key={event.id} className="flex items-start gap-4 bg-white rounded-2xl px-5 py-4 border border-gray-100 shadow-sm">
                      {/* Icon */}
                      <div className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5 ${eventColor[event.type]}`}>
                        {eventIcon[event.type]}
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-gray-900 text-sm font-semibold">{event.title}</p>
                            <p className="text-gray-500 text-xs mt-0.5 line-clamp-1">{event.subtitle}</p>
                          </div>
                          <span className="text-gray-400 text-xs flex-shrink-0 mt-0.5">{timeAgo(event.time)}</span>
                        </div>
                        {event.project && (
                          <p className="text-gray-300 text-xs mt-1.5">{event.project}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
