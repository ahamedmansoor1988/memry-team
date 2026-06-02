"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2, ChevronRight, Folder, RefreshCw } from "lucide-react";
import { useAmbientSync } from "@/lib/hooks/useAmbientSync";

// ─── Types ────────────────────────────────────────────────────────────────────

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

const PROJECT_COLORS = [
  "bg-violet-500", "bg-blue-500", "bg-emerald-500",
  "bg-orange-500", "bg-rose-500", "bg-cyan-500",
];

function projectColor(id: string) {
  let n = 0;
  for (const c of id) n = (n * 31 + c.charCodeAt(0)) & 0xffff;
  return PROJECT_COLORS[n % PROJECT_COLORS.length];
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function ProjectCardSkeleton() {
  return (
    <div className="rounded-panel border border-border bg-paper p-5 space-y-4">
      <div className="flex items-start gap-3">
        <div className="skeleton w-10 h-10 rounded-lg shrink-0" />
        <div className="flex-1 space-y-2 pt-1">
          <div className="skeleton h-4 w-2/5 rounded" />
          <div className="skeleton h-3 w-3/5 rounded" />
        </div>
      </div>
      <div className="flex gap-2">
        <div className="skeleton h-6 w-20 rounded-full" />
        <div className="skeleton h-6 w-14 rounded-full" />
      </div>
    </div>
  );
}

// ─── Project Card ─────────────────────────────────────────────────────────────

function ProjectCard({ project }: { project: Project }) {
  const router = useRouter();
  const color = projectColor(project.id);
  const { stats } = project;
  const files = project.figma_files ?? [];

  return (
    <button
      onClick={() => router.push(`/inbox/${project.id}`)}
      className="w-full text-left rounded-panel border border-border bg-paper p-5 hover:border-ink/20 hover:shadow-sm transition-all group"
    >
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="flex items-start gap-3">
          {/* Project icon */}
          <div className={`w-10 h-10 rounded-lg ${color} flex items-center justify-center text-white font-bold text-[15px] shrink-0`}>
            {project.name.charAt(0).toUpperCase()}
          </div>
          <div>
            <h3 className="text-lead font-semibold text-ink group-hover:text-ink/80 transition-colors">
              {project.name}
            </h3>
            <p className="text-caption text-muted mt-0.5">
              {files.length} {files.length === 1 ? "file" : "files"}
              {stats.last_activity && <> · {timeAgo(stats.last_activity)}</>}
            </p>
          </div>
        </div>
        <ChevronRight size={16} className="text-muted group-hover:text-ink transition-colors shrink-0 mt-1" />
      </div>

      {/* Stats pills */}
      {stats.total > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5 mb-4">
          {stats.needs_decision > 0 && (
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-red-50 border border-red-200 text-caption font-semibold text-red-600">
              <span className="w-1.5 h-1.5 rounded-full bg-red-400 shrink-0" />
              {stats.needs_decision} needs decision
            </span>
          )}
          {stats.open > 0 && (
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-surface border border-border text-caption font-medium text-muted">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-400 shrink-0" />
              {stats.open} open
            </span>
          )}
          {stats.vague > 0 && (
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-yellow-50 border border-yellow-200 text-caption font-medium text-yellow-700">
              <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 shrink-0" />
              {stats.vague} vague
            </span>
          )}
          {stats.resolved > 0 && (
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-caption font-medium text-emerald-700">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
              {stats.resolved} resolved
            </span>
          )}
        </div>
      ) : (
        <p className="text-caption text-muted mb-4">No comments yet</p>
      )}

      {/* File list */}
      {files.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {files.slice(0, 3).map(f => (
            <span key={f.id} className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-surface border border-border text-caption text-muted">
              {/* Figma logo mini */}
              <svg width="8" height="11" viewBox="0 0 38 57" fill="none" className="shrink-0 opacity-50">
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
            <span className="px-2 py-1 rounded-md bg-surface border border-border text-caption text-muted">
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
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  // Ambient: auto-sync on load + tab focus + every 5 min
  useAmbientSync(() => {
    void loadProjects();
  });

  async function loadProjects() {
    const res = await fetch("/api/projects");
    const data = await res.json() as { projects?: Project[] };
    setProjects(data.projects ?? []);
    setLoading(false);
  }

  useEffect(() => { void loadProjects(); }, []);

  async function syncNow() {
    setSyncing(true); setSyncMsg(null);
    try {
      const res = await fetch("/api/figma/pull", { method: "POST" });
      const data = await res.json() as { ok?: boolean; filesQueued?: number; skipped?: boolean; error?: string };
      if (data.error) { setSyncMsg(data.error); }
      else if (data.skipped) { setSyncMsg("Sync already in progress"); }
      else {
        const n = data.filesQueued ?? 0;
        setSyncMsg(n > 0 ? `Syncing ${n} file${n !== 1 ? "s" : ""}…` : "Up to date");
        // Reload after delay so per-file syncs have time to land
        if (n > 0) setTimeout(() => void loadProjects(), 12000);
      }
    } catch { setSyncMsg("Sync failed"); }
    finally { setSyncing(false); }
  }

  const visibleProjects = projects;

  const totalOpen = visibleProjects.reduce((s, p) => s + (p.stats?.open ?? 0), 0);
  const totalNeeds = visibleProjects.reduce((s, p) => s + (p.stats?.needs_decision ?? 0), 0);

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-paper">

      {/* ── Header ── */}
      <div className="px-6 pt-6 pb-5 border-b border-border shrink-0">
        <div className="flex items-center justify-between mb-1">
          <h1 className="text-title font-semibold text-ink">Inbox</h1>
          <button
            onClick={syncNow}
            disabled={syncing}
            className="flex items-center gap-1.5 text-body text-muted hover:text-ink transition-colors disabled:opacity-50"
          >
            <RefreshCw size={13} className={syncing ? "animate-spin" : ""} />
            {syncing ? "Syncing…" : "Sync now"}
          </button>
        </div>

        <div className="flex items-center gap-3 text-caption text-muted">
          {totalNeeds > 0 && (
            <span className="text-red-600 font-medium">{totalNeeds} needs decision</span>
          )}
          {totalOpen > 0 && (
            <span>{totalOpen} open</span>
          )}
          {syncMsg && <span className="text-ink">· {syncMsg}</span>}
        </div>
      </div>

      {/* ── Content ── */}
      <div className="flex-1 overflow-y-auto px-6 py-5">
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <ProjectCardSkeleton /><ProjectCardSkeleton /><ProjectCardSkeleton />
          </div>
        ) : visibleProjects.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 gap-3 text-center">
            <Folder size={32} className="text-wash" />
            <p className="text-lead font-medium text-ink">No projects yet</p>
            <p className="text-body text-muted max-w-xs">
              Connect your Figma team in Integrations and sync to pull in projects and comments.
            </p>
            <button
              onClick={syncNow}
              disabled={syncing}
              className="mt-2 px-4 py-2 rounded-panel border border-border text-body text-ink hover:bg-surface transition-colors disabled:opacity-40 flex items-center gap-2"
            >
              {syncing ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
              {syncing ? "Syncing…" : "Sync from Figma"}
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 fade-in">
            {visibleProjects.map(p => <ProjectCard key={p.id} project={p} />)}
          </div>
        )}
      </div>
    </div>
  );
}
