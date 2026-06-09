"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  Loader2, RefreshCw, Search, SlidersHorizontal,
  Zap, ChevronRight, Clock, Check, MessageSquare,
  MoreHorizontal, Lightbulb, X, Folder,
} from "lucide-react";
import { useAmbientSync } from "@/lib/hooks/useAmbientSync";

// ─── Types ────────────────────────────────────────────────────────────────────

interface TriageItem {
  id:                string;
  score:             number;
  status:            string;
  priority:          string;
  ai_classification: string | null;
  ai_key_question:   string | null;
  ai_summary:        string | null;
  ai_risk_flag:      boolean | null;
  owner_name:        string | null;
  project_id:        string | null;
  project_name:      string | null;
  age_days:          number;
  created_at?:       string | null;
}

interface FigmaFile {
  id: string; name: string; figma_file_key: string;
  sync_status: string; last_synced_at: string | null;
}
interface ProjectStats {
  total: number; needs_decision: number; open: number;
  vague: number; resolved: number; last_activity: string | null;
}
interface Project {
  id: string; name: string; created_at: string;
  figma_files: FigmaFile[];
  stats: ProjectStats;
}

interface LatestItem {
  id:              string;
  ai_key_question: string | null;
  ai_summary:      string | null;
  owner_name:      string | null;
  status:          string;
  created_at:      string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function timeAgo(date: string | null | undefined): string {
  if (!date) return "No activity";
  const diff = Date.now() - new Date(date).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function ProjectCardSkeleton() {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-5">
      <div className="flex gap-6">
        <div className="flex-1 space-y-3">
          <div className="flex items-center gap-3">
            <div className="skeleton w-9 h-9 rounded-lg shrink-0" />
            <div className="space-y-1.5 flex-1">
              <div className="skeleton h-3.5 w-1/3 rounded" />
              <div className="skeleton h-3 w-1/2 rounded" />
            </div>
          </div>
          <div className="flex gap-2">
            <div className="skeleton h-6 w-20 rounded-full" />
            <div className="skeleton h-6 w-16 rounded-full" />
          </div>
        </div>
        <div className="w-px bg-zinc-100" />
        <div className="w-56 shrink-0 space-y-2">
          <div className="skeleton h-3 w-24 rounded" />
          <div className="skeleton h-3.5 w-full rounded" />
          <div className="skeleton h-3.5 w-4/5 rounded" />
        </div>
      </div>
    </div>
  );
}

// ─── Project Card ─────────────────────────────────────────────────────────────

function ProjectCard({
  project,
  latestItem,
}: {
  project:    Project;
  latestItem: LatestItem | null;
}) {
  const router = useRouter();
  const { stats } = project;

  const pendingCount  = (stats.needs_decision ?? 0) + (stats.open ?? 0);
  const resolvedCount = stats.resolved ?? 0;
  const totalCount    = stats.total ?? 0;

  const statusLabel =
    latestItem?.status === "needs_decision" ? "Needs Decision"
    : latestItem?.status === "blocked"      ? "Blocked"
    : latestItem?.status === "open"         ? "Open"
    : latestItem?.status ?? "Open";

  return (
    <div
      onClick={() => router.push(`/inbox/${project.id}`)}
      className="bg-white border border-zinc-200 rounded-xl p-5 hover:border-zinc-300 hover:shadow-sm transition-all cursor-pointer"
    >
      <div className="flex gap-6">

        {/* LEFT — project info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 mb-1">
            <div className="w-9 h-9 rounded-lg bg-zinc-900 text-white text-sm font-bold flex items-center justify-center flex-shrink-0">
              {project.name[0]?.toUpperCase() ?? "?"}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-zinc-900 truncate">{project.name}</p>
              <p className="text-xs text-zinc-400">
                {project.figma_files?.length ?? 0}{" "}
                {(project.figma_files?.length ?? 0) === 1 ? "file" : "files"}
              </p>
            </div>
          </div>

          {/* Stat badges */}
          <div className="flex items-center gap-2 mt-3 flex-wrap">
            {pendingCount > 0 && (
              <span className="inline-flex items-center gap-1 text-xs border border-zinc-200 rounded-full px-2.5 py-1 text-zinc-600">
                <Clock className="w-3 h-3 text-zinc-400" />
                {pendingCount} pending
              </span>
            )}
            {resolvedCount > 0 && (
              <span className="inline-flex items-center gap-1 text-xs border border-zinc-200 rounded-full px-2.5 py-1 text-zinc-600">
                <Check className="w-3 h-3 text-zinc-400" />
                {resolvedCount} resolved
              </span>
            )}
            {totalCount > 0 && (
              <span className="inline-flex items-center gap-1 text-xs border border-zinc-200 rounded-full px-2.5 py-1 text-zinc-600">
                <MessageSquare className="w-3 h-3 text-zinc-400" />
                {totalCount} discussions
              </span>
            )}
            {totalCount === 0 && (
              <span className="text-xs text-zinc-400">No active discussions</span>
            )}
          </div>
        </div>

        {/* DIVIDER */}
        <div className="w-px bg-zinc-100 self-stretch shrink-0" />

        {/* RIGHT — latest discussion */}
        <div className="w-56 flex-shrink-0">
          {latestItem ? (
            <>
              <p className="text-xs text-zinc-400 mb-1.5">Latest discussion</p>
              <p className="text-sm font-medium text-zinc-900 line-clamp-2 mb-1">
                {latestItem.ai_key_question ?? latestItem.ai_summary ?? "Untitled"}
              </p>
              <div className="flex items-center justify-between">
                <p className="text-xs text-zinc-400 truncate flex-1 mr-2">
                  {latestItem.owner_name ?? "Unknown"} · {timeAgo(latestItem.created_at)}
                </p>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="text-xs border border-zinc-200 rounded-md px-2 py-0.5 text-zinc-600 whitespace-nowrap">
                    {statusLabel}
                  </span>
                  <MoreHorizontal className="w-4 h-4 text-zinc-400 hover:text-zinc-600" />
                </div>
              </div>
            </>
          ) : (
            <p className="text-xs text-zinc-400 mt-2">No activity yet</p>
          )}
        </div>

      </div>
    </div>
  );
}

// ─── Needs Decision Banner ────────────────────────────────────────────────────

function NeedsDecisionBanner({
  item,
  count,
  onDismiss,
}: {
  item:      TriageItem;
  count:     number;
  onDismiss: () => void;
}) {
  const router = useRouter();
  const href   = item.project_id ? `/inbox/${item.project_id}/${item.id}` : "#";
  const title  = (item.ai_key_question && item.ai_key_question !== "None")
    ? item.ai_key_question
    : item.ai_summary ?? "Feedback item";
  const initial = item.project_name?.[0]?.toUpperCase() ?? "?";

  return (
    <div
      className="bg-zinc-50 border border-zinc-200 rounded-xl p-4 mb-6 cursor-pointer hover:border-zinc-300 hover:shadow-sm transition-all relative"
      onClick={() => router.push(href)}
    >
      {/* Dismiss */}
      <button
        onClick={e => { e.stopPropagation(); onDismiss(); }}
        className="absolute top-3 right-3 text-zinc-400 hover:text-zinc-600 transition-colors p-1"
        aria-label="Dismiss"
      >
        <X className="w-3.5 h-3.5" />
      </button>

      <div className="flex items-start gap-3 pr-6">
        {/* Icon */}
        <div className="w-9 h-9 rounded-lg bg-zinc-200 flex items-center justify-center flex-shrink-0">
          <Zap className="w-4 h-4 text-zinc-600" />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400 mb-0.5">
            NEEDS DECISION ({count})
          </p>
          <p className="text-base font-medium text-zinc-900 mb-1 line-clamp-2">{title}</p>
          <div className="flex items-center gap-1.5 text-xs text-zinc-400 flex-wrap">
            <span className="w-4 h-4 rounded bg-zinc-900 text-white text-[9px] font-bold inline-flex items-center justify-center flex-shrink-0">
              {initial}
            </span>
            {item.project_name && <span>{item.project_name}</span>}
            {item.owner_name && (
              <>
                <span>·</span>
                <span>Requested by {item.owner_name}</span>
              </>
            )}
            {item.age_days > 0 && (
              <>
                <span>·</span>
                <span>{item.age_days}d old</span>
              </>
            )}
          </div>
        </div>

        {/* CTA */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-xs font-medium text-zinc-600 bg-white border border-zinc-200 px-3 py-1.5 rounded-lg whitespace-nowrap">
            Decision needed
          </span>
          <ChevronRight className="w-4 h-4 text-zinc-400" />
        </div>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function InboxPage() {
  const [projects,      setProjects]      = useState<Project[]>([]);
  const [loading,       setLoading]       = useState(true);
  const [syncing,       setSyncing]       = useState(false);
  const [syncMsg,       setSyncMsg]       = useState<string | null>(null);
  const [triageItems,   setTriageItems]   = useState<TriageItem[]>([]);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [search,        setSearch]        = useState("");
  const [latestItems,   setLatestItems]   = useState<Record<string, LatestItem>>({});
  const [slackConnected, setSlackConnected] = useState(false);

  useAmbientSync(() => { void loadProjects(); });

  async function loadProjects() {
    const res  = await fetch("/api/projects");
    const data = await res.json() as { projects?: Project[] };
    setProjects(data.projects ?? []);
    setLoading(false);
  }

  useEffect(() => { void loadProjects(); }, []);

  useEffect(() => {
    fetch("/api/feedback/triage")
      .then(r => r.json())
      .then((d: { triage?: TriageItem[] }) => setTriageItems(d.triage ?? []))
      .catch(() => {});
  }, []);

  // Fetch latest item per project from activity feed
  useEffect(() => {
    if (projects.length === 0) return;
    fetch("/api/activity?limit=100")
      .then(r => r.json())
      .then((d: { events?: Array<{ feedback_item_id?: string; project_id?: string | null; ai_key_question?: string | null; ai_summary?: string | null; owner_name?: string | null; status?: string; created_at?: string }> }) => {
        const map: Record<string, LatestItem> = {};
        for (const ev of (d.events ?? [])) {
          const pid = ev.project_id;
          if (!pid || map[pid]) continue; // already have latest for this project
          if (!ev.feedback_item_id) continue;
          map[pid] = {
            id:              ev.feedback_item_id,
            ai_key_question: ev.ai_key_question ?? null,
            ai_summary:      ev.ai_summary ?? null,
            owner_name:      ev.owner_name ?? null,
            status:          ev.status ?? "open",
            created_at:      ev.created_at ?? "",
          };
        }
        setLatestItems(map);
      })
      .catch(() => {});
  }, [projects]);

  // Check Slack connectivity
  useEffect(() => {
    fetch("/api/integrations/settings")
      .then(r => r.json())
      .then((d: { slack_bot_token?: string | null }) => {
        setSlackConnected(!!d.slack_bot_token);
      })
      .catch(() => {});
  }, []);

  async function syncNow() {
    setSyncing(true); setSyncMsg(null);
    try {
      const res  = await fetch("/api/figma/pull", { method: "POST" });
      const data = await res.json() as { ok?: boolean; filesQueued?: number; skipped?: boolean; error?: string };
      if (data.error)        { setSyncMsg(data.error); }
      else if (data.skipped) { setSyncMsg("Sync already in progress"); }
      else {
        const n = data.filesQueued ?? 0;
        setSyncMsg(n > 0 ? `Syncing ${n} file${n !== 1 ? "s" : ""}…` : "Up to date");
        if (n > 0) setTimeout(() => void loadProjects(), 12000);
      }
    } catch { setSyncMsg("Sync failed"); }
    finally  { setSyncing(false); }
  }

  const needsDecisionCount = projects.reduce((s, p) => s + (p.stats?.needs_decision ?? 0), 0);

  // Triage banner: show top priority item that needs decision
  const topTriageItem = triageItems.find(i => i.status === "needs_decision") ?? triageItems[0] ?? null;

  // Filter projects by search
  const filteredProjects = search.trim()
    ? projects.filter(p => p.name.toLowerCase().includes(search.trim().toLowerCase()))
    : projects;

  return (
    <div className="min-h-full bg-white">
      <div className="px-8 pt-7 pb-8 max-w-5xl">

        {/* ── Page Header ── */}
        <div className="flex items-center justify-between mb-5">
          <div>
            <h1 className="text-2xl font-semibold text-zinc-900">Inbox</h1>
            <p className="text-sm text-zinc-500 mt-0.5 flex items-center gap-1.5">
              {needsDecisionCount} item{needsDecisionCount !== 1 ? "s" : ""}{" "}
              need{needsDecisionCount === 1 ? "s" : ""} decision
              {needsDecisionCount > 0 && (
                <span className="w-1.5 h-1.5 rounded-full bg-red-500 inline-block" />
              )}
              {syncMsg && (
                <span className="text-zinc-400 ml-1">· {syncMsg}</span>
              )}
            </p>
          </div>
          <button
            onClick={syncNow}
            disabled={syncing}
            className="flex items-center gap-2 border border-zinc-200 bg-white hover:bg-zinc-50 text-zinc-700 text-sm font-medium px-4 py-2 rounded-lg shadow-sm transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${syncing ? "animate-spin" : ""}`} />
            {syncing ? "Syncing…" : "Sync now"}
          </button>
        </div>

        {/* ── Inline Search ── */}
        <div className="relative mb-6">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
          <input
            type="text"
            placeholder="Search discussions, decisions, projects..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full bg-white border border-zinc-200 rounded-lg pl-9 pr-10 py-2.5 text-sm text-zinc-700 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent"
          />
          <SlidersHorizontal className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400 cursor-pointer hover:text-zinc-600" />
        </div>

        {/* ── Needs Decision Banner ── */}
        {!bannerDismissed && topTriageItem && (
          <NeedsDecisionBanner
            item={topTriageItem}
            count={needsDecisionCount}
            onDismiss={() => setBannerDismissed(true)}
          />
        )}

        {/* ── Projects Section ── */}
        {loading ? (
          <div className="space-y-3">
            <ProjectCardSkeleton />
            <ProjectCardSkeleton />
            <ProjectCardSkeleton />
          </div>
        ) : projects.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 gap-3 text-center">
            <Folder className="w-8 h-8 text-zinc-200" />
            <p className="text-base font-medium text-zinc-900">No projects yet</p>
            <p className="text-sm text-zinc-500 max-w-xs">
              Connect your Figma team in Integrations and sync to pull in projects.
            </p>
            <button
              onClick={syncNow}
              disabled={syncing}
              className="mt-2 px-4 py-2 bg-zinc-900 hover:bg-zinc-800 text-white text-sm font-medium rounded-lg shadow-sm transition-colors disabled:opacity-40 flex items-center gap-2"
            >
              {syncing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
              {syncing ? "Syncing…" : "Sync from Figma"}
            </button>
          </div>
        ) : (
          <>
            <h2 className="text-base font-semibold text-zinc-900 mb-3">Projects</h2>

            {filteredProjects.length === 0 ? (
              <p className="text-sm text-zinc-400 py-8 text-center">
                No projects match &ldquo;{search}&rdquo;
              </p>
            ) : (
              <div className="space-y-3">
                {filteredProjects.map(p => (
                  <ProjectCard
                    key={p.id}
                    project={p}
                    latestItem={latestItems[p.id] ?? null}
                  />
                ))}
              </div>
            )}

            {/* ── Tip Bar ── */}
            {!slackConnected && (
              <div className="mt-6 flex items-center gap-2 text-xs text-zinc-500 bg-zinc-50 border border-zinc-200 rounded-lg px-4 py-3">
                <Lightbulb className="w-3.5 h-3.5 text-zinc-400 flex-shrink-0" />
                <span>Tip: Connect Slack to get notified when new feedback needs attention.</span>
                <a
                  href="/integrations"
                  className="ml-auto text-zinc-900 font-medium hover:underline flex-shrink-0"
                >
                  Set up →
                </a>
              </div>
            )}
          </>
        )}

      </div>
    </div>
  );
}
