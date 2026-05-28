"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, Sparkles } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface FigmaFile { id: string; name: string; figma_file_key: string; }
interface Reply { id: string; author_name: string; raw_content: string; figma_created_at: string; }
interface FigmaComment {
  id: string; author_name: string; author_avatar: string | null;
  raw_content: string; figma_created_at: string;
  figma_comment_id: string; figma_order_id: string;
  page_name: string | null;
  figma_file: FigmaFile | null;
}
interface FeedbackItem {
  id: string; status: string; priority: string;
  ai_summary: string | null; ai_classification: string | null;
  ai_key_question: string | null; ai_tags: string[] | null;
  ai_risk_flag: boolean; ai_vague_flag: boolean;
  figma_node_id: string | null; figma_preview_url: string | null;
  created_at: string;
  figma_comment: FigmaComment | null;
  project: { id: string; name: string } | null;
  replies: Reply[];
}

type FilterTab = "all" | "needs_decision" | "open" | "vague";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function timeAgo(date: string): string {
  const diff = Date.now() - new Date(date).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function initials(name?: string | null): string {
  if (!name) return "?";
  return name.split(/\s+/).map(w => w[0]?.toUpperCase() ?? "").slice(0, 2).join("");
}

const BADGE: Record<string, { bg: string; text: string; dot: string }> = {
  "Needs Decision": { bg: "bg-orange-50",   text: "text-orange-600",  dot: "bg-orange-400" },
  "Blocked":        { bg: "bg-red-50",       text: "text-red-600",     dot: "bg-red-400"    },
  "Approved":       { bg: "bg-emerald-50",   text: "text-emerald-700", dot: "bg-emerald-400"},
  "Risk":           { bg: "bg-rose-50",      text: "text-rose-600",    dot: "bg-rose-400"   },
  "Vague":          { bg: "bg-yellow-50",    text: "text-yellow-700",  dot: "bg-yellow-400" },
  "Info":           { bg: "bg-blue-50",      text: "text-blue-600",    dot: "bg-blue-400"   },
  "Open":           { bg: "bg-surface",      text: "text-muted",       dot: "bg-muted/50"   },
};

function ClassBadge({ label }: { label: string | null }) {
  const key = label ?? "Open";
  const s = BADGE[key] ?? BADGE["Open"];
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${s.bg} ${s.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${s.dot}`} />
      {key}
    </span>
  );
}

function Avatar({ name, size = "md" }: { name?: string | null; size?: "sm" | "md" }) {
  const cls = size === "sm"
    ? "w-6 h-6 text-[9px]"
    : "w-7 h-7 text-[10px]";
  return (
    <span className={`${cls} rounded-full bg-ink text-paper flex items-center justify-center font-semibold shrink-0 select-none`}>
      {initials(name)}
    </span>
  );
}

// ─── Figma static preview ─────────────────────────────────────────────────────

function FigmaPreview({ previewUrl }: { previewUrl?: string | null }) {
  const [loaded, setLoaded] = useState(false);
  const [errored, setErrored] = useState(false);

  if (!previewUrl || errored) {
    return (
      <div className="w-full h-full bg-[#F7F7F7] flex items-center justify-center rounded-l-panel">
        <svg width="18" height="26" viewBox="0 0 38 57" fill="none" className="opacity-15">
          <path d="M19 28.5C19 23.8 22.8 20 27.5 20C32.2 20 36 23.8 36 28.5C36 33.2 32.2 37 27.5 37C22.8 37 19 33.2 19 28.5Z" fill="#1ABCFE"/>
          <path d="M2 46C2 41.3 5.8 37.5 10.5 37.5H19V46C19 50.7 15.2 54.5 10.5 54.5C5.8 54.5 2 50.7 2 46Z" fill="#0ACF83"/>
          <path d="M19 2V20H27.5C32.2 20 36 16.2 36 11.5C36 6.8 32.2 3 27.5 3H19V2Z" fill="#FF7262"/>
          <path d="M2 11.5C2 16.2 5.8 20 10.5 20H19V3H10.5C5.8 3 2 6.8 2 11.5Z" fill="#F24E1E"/>
          <path d="M2 28.5C2 33.2 5.8 37 10.5 37H19V20H10.5C5.8 20 2 23.8 2 28.5Z" fill="#FF7262"/>
        </svg>
      </div>
    );
  }

  return (
    <div className="relative w-full h-full bg-surface rounded-l-panel overflow-hidden">
      {!loaded && <div className="absolute inset-0 skeleton" />}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={previewUrl}
        alt="Figma frame preview"
        className={`w-full h-full object-cover transition-opacity duration-200 ${loaded ? "opacity-100" : "opacity-0"}`}
        onLoad={() => setLoaded(true)}
        onError={() => setErrored(true)}
        loading="lazy"
      />
    </div>
  );
}

// ─── Comment row card ─────────────────────────────────────────────────────────

function CommentCard({ item, onSelect }: {
  item: FeedbackItem;
  onSelect: () => void;
}) {
  const fc = item.figma_comment;
  const replyCount = item.replies?.length ?? 0;

  // AI insight text
  let insight: { text: string; color: string } | null = null;
  if (item.ai_vague_flag) insight = { text: "Vague comment detected · Needs clarification", color: "text-yellow-600" };
  else if (item.ai_risk_flag) insight = { text: "Risk detected · Needs attention", color: "text-red-500" };
  else if (item.ai_summary) insight = { text: item.ai_summary.slice(0, 100) + (item.ai_summary.length > 100 ? "…" : ""), color: "text-muted" };

  return (
    <button
      onClick={onSelect}
      className={`w-full text-left flex rounded-panel border border-border bg-paper hover:border-ink/20 hover:shadow-sm transition-all group overflow-hidden ${item.status === "resolved" ? "opacity-60" : ""}`}
    >
      {/* Figma preview thumbnail */}
      <div className="w-[140px] shrink-0 h-[148px] relative bg-surface border-r border-border">
        <FigmaPreview previewUrl={item.figma_preview_url} />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0 p-4 flex flex-col gap-2">
        {/* Badge row */}
        <div className="flex items-center gap-2">
          <ClassBadge label={item.status === "resolved" ? "Approved" : item.ai_classification} />
        </div>

        {/* Title */}
        <p className="text-lead font-semibold text-ink line-clamp-2 leading-snug">
          {item.ai_key_question ?? fc?.raw_content ?? "Comment"}
        </p>

        {/* Meta */}
        <div className="flex items-center gap-1.5 text-caption text-muted">
          <Avatar name={fc?.author_name} size="sm" />
          <span className="font-medium text-ink">{fc?.author_name ?? "Unknown"}</span>
          <span>·</span>
          <span>{fc?.figma_created_at ? timeAgo(fc.figma_created_at) : timeAgo(item.created_at)}</span>
          {replyCount > 0 && <><span>·</span><span>{replyCount} {replyCount === 1 ? "reply" : "replies"}</span></>}
        </div>

        {/* Breadcrumb: Project / File / Page */}
        <div className="flex items-center gap-1 text-caption text-muted overflow-hidden">
          <svg width="8" height="11" viewBox="0 0 38 57" fill="none" className="shrink-0 opacity-40">
            <path d="M19 28.5C19 23.8 22.8 20 27.5 20C32.2 20 36 23.8 36 28.5C36 33.2 32.2 37 27.5 37C22.8 37 19 33.2 19 28.5Z" fill="#1ABCFE"/>
            <path d="M2 46C2 41.3 5.8 37.5 10.5 37.5H19V46C19 50.7 15.2 54.5 10.5 54.5C5.8 54.5 2 50.7 2 46Z" fill="#0ACF83"/>
            <path d="M19 2V20H27.5C32.2 20 36 16.2 36 11.5C36 6.8 32.2 3 27.5 3H19V2Z" fill="#FF7262"/>
            <path d="M2 11.5C2 16.2 5.8 20 10.5 20H19V3H10.5C5.8 3 2 6.8 2 11.5Z" fill="#F24E1E"/>
            <path d="M2 28.5C2 33.2 5.8 37 10.5 37H19V20H10.5C5.8 20 2 23.8 2 28.5Z" fill="#FF7262"/>
          </svg>
          <span className="shrink-0">{item.project?.name ?? "—"}</span>
          {fc?.figma_file?.name && (
            <><span className="opacity-40 shrink-0">/</span><span className="truncate">{
              /^\w{22}$/.test(fc.figma_file.name)
                ? `File (${fc.figma_file.figma_file_key.slice(0,8)}…)`
                : fc.figma_file.name
            }</span></>
          )}
          {fc?.page_name && (
            <><span className="opacity-40 shrink-0">/</span><span className="truncate">{fc.page_name}</span></>
          )}
        </div>

        {/* AI insight */}
        {insight && (
          <div className={`flex items-center gap-1.5 text-caption ${insight.color} mt-auto`}>
            {item.ai_vague_flag ? (
              <span className="opacity-60">⚠</span>
            ) : item.ai_risk_flag ? (
              <span className="opacity-60">⚡</span>
            ) : (
              <Sparkles size={10} className="opacity-60 shrink-0" />
            )}
            <span className="line-clamp-1">{insight.text}</span>
          </div>
        )}
      </div>

      {/* Right arrow */}
      <div className="flex items-center px-3 shrink-0">
        <ChevronRight size={16} className="text-muted group-hover:text-ink transition-colors" />
      </div>
    </button>
  );
}

// ─── Project detail page ──────────────────────────────────────────────────────

export default function ProjectInboxPage({ params }: { params: { projectId: string } }) {
  const { projectId } = params;
  const router = useRouter();

  const [items, setItems] = useState<FeedbackItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterTab>("all");
  const [search, setSearch] = useState("");
  const [projectName, setProjectName] = useState<string>("Project");

  useEffect(() => {
    fetch(`/api/feedback?projectId=${projectId}`)
      .then(r => r.json())
      .then((d: { items?: FeedbackItem[] }) => {
        const its = d.items ?? [];
        setItems(its);
        const name = its[0]?.project?.name;
        if (name) setProjectName(name);
        setLoading(false);
      });
  }, [projectId]);


  const filtered = items.filter(item => {
    const text = `${item.ai_key_question ?? ""} ${item.figma_comment?.raw_content ?? ""} ${item.figma_comment?.author_name ?? ""}`.toLowerCase();
    if (search && !text.includes(search.toLowerCase())) return false;
    if (filter === "needs_decision") return item.ai_classification === "Needs Decision" || item.ai_classification === "Blocked";
    if (filter === "open") return item.status === "open";
    if (filter === "vague") return item.ai_vague_flag;
    return true;
  });

  const tabs: { key: FilterTab; label: string; count?: number }[] = [
    { key: "all",            label: "All",            count: items.length },
    { key: "needs_decision", label: "Needs Decision", count: items.filter(i => i.ai_classification === "Needs Decision" || i.ai_classification === "Blocked").length },
    { key: "open",           label: "Open",           count: items.filter(i => i.status === "open").length },
    { key: "vague",          label: "Vague",          count: items.filter(i => i.ai_vague_flag).length },
  ];

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-paper">

      {/* ── Header ── */}
      <div className="px-6 pt-5 pb-4 border-b border-border shrink-0">
        <button
          onClick={() => router.push("/inbox")}
          className="flex items-center gap-1.5 text-caption text-muted hover:text-ink transition-colors mb-3"
        >
          <ChevronLeft size={13} /> Inbox
        </button>

        <h1 className="text-title font-semibold text-ink mb-3">{projectName}</h1>

        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search comments…"
          className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-body text-ink placeholder:text-muted outline-none focus:border-ink/40 transition-colors mb-3"
        />

        <div className="flex items-center gap-1 overflow-x-auto">
          {tabs.map(tab => (
            <button
              key={tab.key}
              onClick={() => setFilter(tab.key)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-body font-medium transition-colors shrink-0 ${
                filter === tab.key ? "bg-ink text-paper" : "bg-surface text-muted hover:text-ink border border-border"
              }`}
            >
              {tab.label}
              {tab.count != null && tab.count > 0 && (
                <span className={`text-caption ${filter === tab.key ? "text-paper/70" : "text-muted"}`}>
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* ── Content ── */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {loading ? (
          <div className="space-y-3">
            {[1,2,3].map(n => (
              <div key={n} className="flex rounded-panel border border-border overflow-hidden h-[148px]">
                <div className="skeleton w-[140px] shrink-0" />
                <div className="flex-1 p-4 space-y-2.5">
                  <div className="skeleton h-4 w-24 rounded-full" />
                  <div className="skeleton h-5 w-3/4 rounded" />
                  <div className="skeleton h-3 w-1/2 rounded" />
                  <div className="skeleton h-3 w-2/5 rounded" />
                </div>
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-2 text-center">
            <p className="text-lead font-medium text-ink">
              {items.length === 0 ? "No comments in this project" : "Nothing matches"}
            </p>
            <p className="text-body text-muted">
              {items.length === 0 ? "Comments will appear here once synced from Figma." : "Try a different filter."}
            </p>
          </div>
        ) : (
          <div className="space-y-3 pb-10 fade-in">
            {filtered.map(item => (
              <CommentCard
                key={item.id}
                item={item}
                onSelect={() => router.push(`/inbox/${projectId}/${item.id}`)}
              />
            ))}
          </div>
        )}
      </div>

    </div>
  );
}
