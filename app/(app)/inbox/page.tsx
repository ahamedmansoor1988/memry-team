"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2, ChevronRight, Folder, RefreshCw, Zap, X } from "lucide-react";
import { useAmbientSync } from "@/lib/hooks/useAmbientSync";

// ─── Triage types ─────────────────────────────────────────────────────────────

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
}

function TriageBanner({ items, onDismiss }: { items: TriageItem[]; onDismiss: () => void }) {
  const router = useRouter();
  if (!items.length) return null;
  return (
    <div className="rounded-xl border border-zinc-200 bg-zinc-900 p-3 mb-5">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <Zap size={13} className="text-white shrink-0" />
          <span className="text-[10px] font-bold uppercase tracking-widest text-white">Needs Attention</span>
        </div>
        <button onClick={onDismiss} className="text-zinc-400 hover:text-white transition-colors">
          <X size={13} />
        </button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {items.map(item => {
          const title = item.ai_key_question && item.ai_key_question !== "None"
            ? item.ai_key_question
            : item.ai_summary ?? "Feedback item";
          const href = item.project_id ? `/inbox/${item.project_id}/${item.id}` : "#";
          const isBlocked = item.ai_classification === "Blocked";
          return (
            <button
              key={item.id}
              onClick={() => router.push(href)}
              className="flex flex-col gap-1.5 text-left rounded-lg bg-white/10 border border-white/20 px-3 py-2.5 hover:bg-white/20 transition-colors"
            >
              {item.ai_classification && (
                <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded self-start border ${
                  isBlocked
                    ? "bg-red-50 text-red-700 border-red-200"
                    : "bg-white/10 text-white border-white/20"
                }`}>
                  {item.ai_classification}
                </span>
              )}
              <p className="text-sm font-medium text-white line-clamp-1">{title}</p>
              <div className="flex items-center gap-1.5 text-xs text-zinc-400">
                {item.project_name && <span>{item.project_name}</span>}
                {item.age_days > 0 && (
                  <><span className="opacity-40">·</span><span>{item.age_days}d old</span></>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Project types ────────────────────────────────────────────────────────────

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

// ─── Helpers ─────────────────────────────────────────────────────────────────

function timeAgo(date: string | null): string {
  if (!date) return "No activity";
  const diff = Date.now() - new Date(date).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// Deterministic letter-based icon color (indigo shades only)
function projectInitialColor(id: string): string {
  let n = 0;
  for (const c of id) n = (n * 31 + c.charCodeAt(0)) & 0xffff;
  const shades = ["bg-zinc-900", "bg-zinc-800", "bg-zinc-700", "bg-zinc-600", "bg-zinc-500"];
  return shades[n % shades.length];
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function ProjectCardSkeleton() {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-5 space-y-4">
      <div className="flex items-start gap-3">
        <div className="skeleton w-10 h-10 rounded-lg shrink-0" />
        <div className="flex-1 space-y-2 pt-1">
          <div className="skeleton h-4 w-2/5 rounded" />
          <div className="skeleton h-3 w-3/5 rounded" />
        </div>
      </div>
      <div className="flex gap-2">
        <div className="skeleton h-5 w-20 rounded-full" />
        <div className="skeleton h-5 w-14 rounded-full" />
      </div>
    </div>
  );
}

// ─── Project Card ─────────────────────────────────────────────────────────────

function ProjectCard({ project }: { project: Project }) {
  const router = useRouter();
  const color  = projectInitialColor(project.id);
  const { stats } = project;
  const files  = project.figma_files ?? [];

  return (
    <button
      onClick={() => router.push(`/inbox/${project.id}`)}
      className="w-full text-left rounded-xl border border-zinc-200 bg-white p-5 hover:border-zinc-300 hover:shadow-sm transition-all group"
    >
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="flex items-start gap-3">
          <div className={`w-10 h-10 rounded-lg ${color} flex items-center justify-center text-white font-bold text-[15px] shrink-0`}>
            {project.name.charAt(0).toUpperCase()}
          </div>
          <div>
            <h3 className="text-sm font-semibold text-zinc-900 group-hover:text-zinc-700 transition-colors">
              {project.name}
            </h3>
            <p className="text-xs text-zinc-400 mt-0.5">
              {files.length} {files.length === 1 ? "file" : "files"}
              {stats.last_activity && <> · {timeAgo(stats.last_activity)}</>}
            </p>
          </div>
        </div>
        <ChevronRight size={15} className="text-zinc-300 group-hover:text-zinc-500 transition-colors shrink-0 mt-1" />
      </div>

      {/* Stats pills */}
      {stats.total > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5 mb-4">
          {stats.needs_decision > 0 && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-zinc-900 text-white text-xs font-medium border border-zinc-900">
              {stats.needs_decision} needs decision
            </span>
          )}
          {stats.open > 0 && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-zinc-100 border border-zinc-200 text-xs font-medium text-zinc-600">
              {stats.open} open
            </span>
          )}
          {stats.vague > 0 && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-zinc-100 border border-zinc-200 text-xs font-medium text-zinc-500">
              {stats.vague} vague
            </span>
          )}
          {stats.resolved > 0 && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-zinc-100 border border-zinc-200 text-xs font-medium text-zinc-400">
              {stats.resolved} resolved
            </span>
          )}
        </div>
      ) : (
        <p className="text-xs text-zinc-400 mb-4">No comments yet</p>
      )}

      {/* File list */}
      {files.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {files.slice(0, 3).map(f => (
            <span key={f.id} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-zinc-50 border border-zinc-200 text-xs text-zinc-400">
              <svg width="7" height="10" viewBox="0 0 38 57" fill="none" className="shrink-0 opacity-40">
                <path d="M19 28.5C19 23.8 22.8 20 27.5 20C32.2 20 36 23.8 36 28.5C36 33.2 32.2 37 27.5 37C22.8 37 19 33.2 19 28.5Z" fill="#1ABCFE"/>
                <path d="M2 46C2 41.3 5.8 37.5 10.5 37.5H19V46C19 50.7 15.2 54.5 10.5 54.5C5.8 54.5 2 50.7 2 46Z" fill="#0ACF83"/>
                <path d="M19 2V20H27.5C32.2 20 36 16.2 36 11.5C36 6.8 32.2 3 27.5 3H19V2Z" fill="#FF7262"/>
                <path d="M2 11.5C2 16.2 5.8 20 10.5 20H19V3H10.5C5.8 3 2 6.8 2 11.5Z" fill="#F24E1E"/>
                <path d="M2 28.5C2 33.2 5.8 37 10.5 37H19V20H10.5C5.8 20 2 23.8 2 28.5Z" fill="#FF7262"/>
              </svg>
              {/^\w{22}$/.test(f.name) ? `File (${f.figma_file_key.slice(0,8)}…)` : f.name}
            </span>
          ))}
          {files.length > 3 && (
            <span className="px-2 py-0.5 rounded-md bg-zinc-50 border border-zinc-200 text-xs text-zinc-400">
              +{files.length - 3} more
            </span>
          )}
        </div>
      )}
    </button>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function InboxPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [syncing,  setSyncing]  = useState(false);
  const [syncMsg,  setSyncMsg]  = useState<string | null>(null);
  const [triageItems,     setTriageItems]     = useState<TriageItem[]>([]);
  const [triageDismissed, setTriageDismissed] = useState(false);

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

  // Aggregated stats for right panel
  const totalItems    = projects.reduce((s, p) => s + (p.stats?.total        ?? 0), 0);
  const totalNeeds    = projects.reduce((s, p) => s + (p.stats?.needs_decision ?? 0), 0);
  const totalOpen     = projects.reduce((s, p) => s + (p.stats?.open          ?? 0), 0);
  const totalResolved = projects.reduce((s, p) => s + (p.stats?.resolved      ?? 0), 0);

  const stats = [
    { label: "Total",          value: totalItems,    numCls: "text-zinc-900" },
    { label: "Needs Decision", value: totalNeeds,    numCls: totalNeeds > 0 ? "text-zinc-900 font-bold" : "text-zinc-900" },
    { label: "Open",           value: totalOpen,     numCls: "text-zinc-900" },
    { label: "Resolved",       value: totalResolved, numCls: "text-zinc-900" },
  ];

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-white">

      {/* ── Header ── */}
      <div className="px-8 pt-7 pb-5 border-b border-zinc-200 shrink-0">
        <div className="flex items-center justify-between mb-1">
          <h1 className="text-2xl font-semibold text-zinc-900">Inbox</h1>
          <button
            onClick={syncNow}
            disabled={syncing}
            className="flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-900 transition-colors disabled:opacity-50"
          >
            <RefreshCw size={13} className={syncing ? "animate-spin" : ""} />
            {syncing ? "Syncing…" : "Sync now"}
          </button>
        </div>
        <p className="text-sm text-zinc-500 mt-1">
          {totalNeeds > 0 && <span className="font-medium text-zinc-900">{totalNeeds} needs decision · </span>}
          {totalOpen > 0  && <span>{totalOpen} open</span>}
          {syncMsg && <span className="text-zinc-400"> · {syncMsg}</span>}
        </p>
      </div>

      {/* ── Content: two columns ── */}
      <div className="flex-1 overflow-y-auto">
        <div className="flex gap-6 px-8 py-6 max-w-6xl">

          {/* Left — project list */}
          <div className="flex-1 min-w-0">
            {!triageDismissed && triageItems.length > 0 && (
              <TriageBanner items={triageItems} onDismiss={() => setTriageDismissed(true)} />
            )}

            {loading ? (
              <div className="space-y-3">
                <ProjectCardSkeleton /><ProjectCardSkeleton /><ProjectCardSkeleton />
              </div>
            ) : projects.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-24 gap-3 text-center">
                <Folder size={32} className="text-zinc-200" />
                <p className="text-base font-medium text-zinc-900">No projects yet</p>
                <p className="text-sm text-zinc-500 max-w-xs">
                  Connect your Figma team in Integrations and sync to pull in projects.
                </p>
                <button
                  onClick={syncNow}
                  disabled={syncing}
                  className="mt-2 px-4 py-2 bg-zinc-900 hover:bg-zinc-800 text-white text-sm font-medium rounded-lg shadow-sm transition-colors disabled:opacity-40 flex items-center gap-2"
                >
                  {syncing ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                  {syncing ? "Syncing…" : "Sync from Figma"}
                </button>
              </div>
            ) : (
              <div className="space-y-3 fade-in">
                {projects.map(p => <ProjectCard key={p.id} project={p} />)}
              </div>
            )}
          </div>

          {/* Right — At a glance panel */}
          {!loading && projects.length > 0 && (
            <div className="w-64 shrink-0">
              <div className="bg-zinc-50 border border-zinc-200 rounded-xl p-5 sticky top-6">
                <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400 mb-4">
                  At a glance
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {stats.map(s => (
                    <div key={s.label} className="bg-white border border-zinc-200 rounded-lg p-3">
                      <p className={`text-xl font-semibold ${s.numCls}`}>{s.value}</p>
                      <p className="text-xs text-zinc-500 mt-0.5">{s.label}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
