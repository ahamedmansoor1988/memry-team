"use client";
import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Plus, Search, FolderKanban, Loader2 } from "lucide-react";

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
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return `${Math.floor(d / 30)}mo ago`;
}

const TILE_COLORS = [
  { bg: "var(--accent)", fg: "var(--accent-ink)" },
  { bg: "var(--blue)",   fg: "#ffffff" },
  { bg: "var(--green)",  fg: "#ffffff" },
  { bg: "var(--amber)",  fg: "#ffffff" },
];

// ─── Main page ────────────────────────────────────────────────────────────────

export default function ProjectsPage() {
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);
  const [decisionCounts, setDecisionCounts] = useState<Record<string, number>>({});
  const [loading, setLoading]   = useState(true);
  const [search, setSearch]     = useState("");

  const [showNew, setShowNew]   = useState(false);
  const [newName, setNewName]   = useState("");
  const [creating, setCreating] = useState(false);

  async function loadProjects() {
    const res  = await fetch("/api/projects");
    const data = await res.json() as { projects?: Project[] };
    setProjects(data.projects ?? []);
    setLoading(false);
  }

  useEffect(() => { void loadProjects(); }, []);

  // Decisions per project
  useEffect(() => {
    fetch("/api/decisions/timeline")
      .then(r => r.json())
      .then((d: { timeline?: { decisions: { project_id: string | null }[] }[] }) => {
        const counts: Record<string, number> = {};
        for (const g of d.timeline ?? []) {
          for (const dec of g.decisions) {
            if (dec.project_id) counts[dec.project_id] = (counts[dec.project_id] ?? 0) + 1;
          }
        }
        setDecisionCounts(counts);
      })
      .catch(() => {});
  }, []);

  async function createProject() {
    if (!newName.trim()) return;
    setCreating(true);
    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName }),
    });
    if (res.ok) {
      setNewName("");
      setShowNew(false);
      await loadProjects();
    }
    setCreating(false);
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? projects.filter(p => p.name.toLowerCase().includes(q)) : projects;
  }, [projects, search]);

  return (
    <div className="min-h-full" style={{ background: "var(--bg)" }}>
      <div className="px-7 pt-6 pb-10 max-w-4xl">

        {/* ── Header ── */}
        <div className="flex items-start justify-between mb-5">
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 600, color: "var(--text)", letterSpacing: "-0.02em" }}>Projects</h1>
            <p style={{ fontSize: 13, color: "var(--text-2)", marginTop: 2 }}>
              All projects across your organization.
            </p>
          </div>
          <button
            onClick={() => setShowNew(v => !v)}
            style={{
              display: "flex", alignItems: "center", gap: 7,
              background: "var(--accent)", color: "var(--accent-ink)",
              borderRadius: 8, padding: "8px 14px",
              fontSize: 12, fontWeight: 500, border: "none", cursor: "pointer",
            }}
            className="hover:opacity-90 transition-opacity"
          >
            <Plus style={{ width: 13, height: 13 }} />
            New project
          </button>
        </div>

        {/* ── New project form ── */}
        {showNew && (
          <div style={{
            display: "flex", gap: 8, marginBottom: 16,
            background: "var(--surface)", border: "1px solid var(--border)",
            borderRadius: 12, padding: 12, boxShadow: "var(--shadow-1)",
          }} className="fade-in">
            <input
              autoFocus
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") void createProject(); }}
              placeholder="Project name…"
              style={{
                flex: 1, padding: "8px 12px", fontSize: 13,
                borderRadius: 8, border: "1px solid var(--border)",
                background: "var(--bg)", color: "var(--text)", outline: "none",
              }}
            />
            <button
              onClick={createProject}
              disabled={creating || !newName.trim()}
              style={{
                display: "flex", alignItems: "center", gap: 6,
                background: "var(--accent)", color: "var(--accent-ink)",
                borderRadius: 8, padding: "8px 16px", fontSize: 12, fontWeight: 500,
                border: "none", cursor: "pointer",
                opacity: creating || !newName.trim() ? 0.4 : 1,
              }}
            >
              {creating && <Loader2 style={{ width: 12, height: 12 }} className="animate-spin" />}
              Create
            </button>
          </div>
        )}

        {/* ── Search ── */}
        <div style={{ position: "relative", marginBottom: 14 }}>
          <Search style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", width: 13, height: 13, color: "var(--text-3)", pointerEvents: "none" }} />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search projects…"
            style={{
              width: "100%", padding: "9px 12px 9px 32px", fontSize: 13,
              borderRadius: 10, border: "1px solid var(--border)",
              background: "var(--surface)", color: "var(--text)", outline: "none",
            }}
          />
        </div>

        {/* ── Project cards ── */}
        {loading ? (
          <div className="space-y-3">
            {[0, 1, 2].map(i => (
              <div key={i} className="skeleton" style={{ height: 76, borderRadius: 12 }} />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: "56px 0", textAlign: "center", boxShadow: "var(--shadow-1)" }}>
            <FolderKanban style={{ width: 28, height: 28, color: "var(--border)", margin: "0 auto 10px" }} />
            <p style={{ fontSize: 14, fontWeight: 500, color: "var(--text)" }}>
              {projects.length === 0 ? "No projects yet" : "No projects match"}
            </p>
            <p style={{ fontSize: 12, color: "var(--text-3)", marginTop: 4 }}>
              {projects.length === 0
                ? "Sync from Figma in Integrations, or create one manually."
                : `Nothing named “${search}”.`}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map((p, idx) => {
              const tile = TILE_COLORS[idx % TILE_COLORS.length];
              const decisions = decisionCounts[p.id] ?? 0;
              return (
                <div
                  key={p.id}
                  onClick={() => router.push(`/projects/${p.id}`)}
                  style={{
                    display: "flex", alignItems: "center", gap: 14,
                    background: "var(--surface)", border: "1px solid var(--border)",
                    borderRadius: 12, padding: "16px 18px", cursor: "pointer",
                    boxShadow: "var(--shadow-1)", transition: "border-color 0.15s",
                  }}
                  className="hover:!border-[var(--accent-border)]"
                >
                  {/* Tile */}
                  <div style={{
                    width: 40, height: 40, borderRadius: 10, flexShrink: 0,
                    background: tile.bg, color: tile.fg,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 15, fontWeight: 700,
                  }}>
                    {p.name[0]?.toUpperCase() ?? "?"}
                  </div>

                  {/* Name + stats */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }} className="truncate">{p.name}</p>
                    <p style={{ fontSize: 11.5, color: "var(--text-3)", marginTop: 2 }}>
                      {p.figma_files?.length ?? 0} {`file${(p.figma_files?.length ?? 0) === 1 ? "" : "s"}`}
                      <span style={{ margin: "0 5px", opacity: 0.5 }}>·</span>
                      {p.stats?.total ?? 0} discussions
                      <span style={{ margin: "0 5px", opacity: 0.5 }}>·</span>
                      {decisions} decisions
                    </p>
                  </div>

                  {/* Updated */}
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-3)", flexShrink: 0 }}>
                    Updated {timeAgo(p.stats?.last_activity ?? null)}
                  </span>
                </div>
              );
            })}
          </div>
        )}

      </div>
    </div>
  );
}
