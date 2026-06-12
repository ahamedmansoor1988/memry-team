"use client";
import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft, FileText, MessagesSquare, ListChecks, ShieldAlert,
  CheckCircle2, Plus, RefreshCw, Loader2, Trash2, AlertTriangle,
} from "lucide-react";

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

interface DecisionItem {
  id: string; decision_text: string; owner_name: string | null;
  source: string; decided_at: string; project_id: string | null;
}

interface InboxItem {
  id: string; status: string; ai_classification: string | null;
  ai_key_question: string | null; ai_summary: string | null;
  ai_risk_flag: boolean | null; project_id: string | null;
  created_at: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function timeAgo(date: string | null): string {
  if (!date) return "—";
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

function fmtDate(date: string): string {
  return new Date(date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// ─── Stat card ────────────────────────────────────────────────────────────────

function StatCard({ value, label, icon }: { value: number; label: string; icon: React.ReactNode }) {
  return (
    <div style={{
      background: "var(--surface)", border: "1px solid var(--border)",
      borderRadius: 12, padding: "14px 16px", boxShadow: "var(--shadow-1)",
      flex: 1, minWidth: 0,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6, color: "var(--text-3)" }}>
        {icon}
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase" }}>{label}</span>
      </div>
      <p style={{ fontSize: 22, fontWeight: 600, color: "var(--text)", fontFamily: "var(--font-mono)", lineHeight: 1 }}>{value}</p>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function ProjectDetailPage({ params }: { params: { projectId: string } }) {
  const { projectId } = params;
  const router = useRouter();

  const [project, setProject]     = useState<Project | null>(null);
  const [decisions, setDecisions] = useState<DecisionItem[]>([]);
  const [items, setItems]         = useState<InboxItem[]>([]);
  const [loading, setLoading]     = useState(true);

  // File management
  const [showAddFile, setShowAddFile] = useState(false);
  const [fileUrl, setFileUrl]         = useState("");
  const [addingFile, setAddingFile]   = useState(false);
  const [fileError, setFileError]     = useState("");
  const [syncingFile, setSyncingFile] = useState<string | null>(null);
  const [syncResult, setSyncResult]   = useState<Record<string, string>>({});
  const [deleting, setDeleting]       = useState(false);

  async function loadProject() {
    const res  = await fetch("/api/projects");
    const data = await res.json() as { projects?: Project[] };
    const p = (data.projects ?? []).find(x => x.id === projectId) ?? null;
    setProject(p);
    setLoading(false);
  }

  useEffect(() => { void loadProject(); }, [projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetch("/api/decisions/timeline")
      .then(r => r.json())
      .then((d: { timeline?: { decisions: DecisionItem[] }[] }) => {
        const all = (d.timeline ?? []).flatMap(g => g.decisions);
        setDecisions(all.filter(x => x.project_id === projectId));
      })
      .catch(() => {});
    fetch("/api/inbox")
      .then(r => r.json())
      .then((d: { items?: InboxItem[] }) => {
        setItems((d.items ?? []).filter(i => i.project_id === projectId));
      })
      .catch(() => {});
  }, [projectId]);

  const risks = useMemo(
    () => items.filter(i => i.ai_risk_flag || i.status === "blocked" || i.ai_classification === "Blocked"),
    [items],
  );

  async function addFile() {
    if (!fileUrl.trim()) return;
    setAddingFile(true);
    setFileError("");
    const res  = await fetch(`/api/projects/${projectId}/files`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: fileUrl }),
    });
    const data = await res.json() as { error?: string };
    if (!res.ok) {
      setFileError(data.error ?? "Failed to add file");
      setAddingFile(false);
      return;
    }
    setFileUrl("");
    setShowAddFile(false);
    setAddingFile(false);
    await loadProject();
  }

  async function syncFile(fileId: string) {
    setSyncingFile(fileId);
    setSyncResult(prev => ({ ...prev, [fileId]: "" }));
    const res  = await fetch(`/api/figma-files/${fileId}/sync`, { method: "POST" });
    const data = await res.json() as { added?: number; error?: string };
    setSyncResult(prev => ({
      ...prev,
      [fileId]: res.ok ? `✓ ${data.added ?? 0} new` : `✗ ${data.error ?? "failed"}`,
    }));
    setSyncingFile(null);
    if (res.ok) await loadProject();
  }

  async function deleteProject() {
    if (!confirm("Delete this project and all its files?")) return;
    setDeleting(true);
    await fetch("/api/projects", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: projectId }),
    });
    router.push("/projects");
  }

  const panelStyle: React.CSSProperties = {
    background: "var(--surface)", border: "1px solid var(--border)",
    borderRadius: 12, boxShadow: "var(--shadow-1)", overflow: "hidden",
  };

  if (loading) {
    return (
      <div className="min-h-full" style={{ background: "var(--bg)" }}>
        <div className="px-7 pt-6 max-w-4xl space-y-4">
          <div className="skeleton" style={{ height: 20, width: 200, borderRadius: 4 }} />
          <div className="skeleton" style={{ height: 48, width: "60%", borderRadius: 8 }} />
          <div style={{ display: "flex", gap: 12 }}>
            {[0, 1, 2, 3].map(i => <div key={i} className="skeleton" style={{ height: 80, borderRadius: 12, flex: 1 }} />)}
          </div>
        </div>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="min-h-full flex flex-col items-center justify-center gap-3" style={{ background: "var(--bg)" }}>
        <p style={{ fontSize: 14, fontWeight: 500, color: "var(--text)" }}>Project not found</p>
        <Link href="/projects" style={{ fontSize: 12, color: "var(--text-2)" }}>← Back to projects</Link>
      </div>
    );
  }

  return (
    <div className="min-h-full" style={{ background: "var(--bg)" }}>
      <div className="px-7 pt-5 pb-10 max-w-4xl">

        {/* ── Breadcrumb ── */}
        <button
          onClick={() => router.push("/projects")}
          style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text-3)", background: "none", border: "none", cursor: "pointer", padding: 0, marginBottom: 14 }}
          className="hover:text-[var(--text-2)] transition-colors"
        >
          <ArrowLeft style={{ width: 12, height: 12 }} />
          Projects <span style={{ opacity: 0.5 }}>/</span> <span style={{ color: "var(--text-2)" }}>{project.name}</span>
        </button>

        {/* ── Header ── */}
        <div className="flex items-center justify-between mb-5">
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{
              width: 44, height: 44, borderRadius: 11, flexShrink: 0,
              background: "var(--accent)", color: "var(--accent-ink)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 17, fontWeight: 700,
            }}>
              {project.name[0]?.toUpperCase()}
            </div>
            <div>
              <h1 style={{ fontSize: 19, fontWeight: 600, color: "var(--text)", letterSpacing: "-0.02em" }}>{project.name}</h1>
              <p style={{ fontSize: 12, color: "var(--text-3)", marginTop: 1 }}>
                Created {fmtDate(project.created_at)}
              </p>
            </div>
          </div>
          <button
            onClick={deleteProject}
            disabled={deleting}
            title="Delete project"
            style={{
              display: "flex", alignItems: "center", gap: 6,
              background: "var(--surface)", border: "1px solid var(--border)",
              borderRadius: 8, padding: "7px 12px", fontSize: 12,
              color: "var(--red)", cursor: "pointer", opacity: deleting ? 0.5 : 1,
            }}
            className="hover:!border-[color-mix(in_oklab,var(--red)_30%,#ffffff)] transition-colors"
          >
            <Trash2 style={{ width: 12, height: 12 }} />
            Delete
          </button>
        </div>

        {/* ── Stat cards ── */}
        <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
          <StatCard value={project.figma_files?.length ?? 0} label="Files"       icon={<FileText style={{ width: 11, height: 11 }} />} />
          <StatCard value={project.stats?.total ?? 0}        label="Discussions" icon={<MessagesSquare style={{ width: 11, height: 11 }} />} />
          <StatCard value={decisions.length}                 label="Decisions"   icon={<ListChecks style={{ width: 11, height: 11 }} />} />
          <StatCard value={risks.length}                     label="Risks"       icon={<ShieldAlert style={{ width: 11, height: 11 }} />} />
        </div>

        {/* ── Two columns: recent decisions + recent risks ── */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 20 }} className="max-md:!grid-cols-1">

          {/* Recent decisions */}
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <p style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>Recent decisions</p>
              <Link href="/decisions" style={{ fontSize: 11, color: "var(--text-3)", textDecoration: "none" }} className="hover:text-[var(--text-2)]">View all →</Link>
            </div>
            <div style={panelStyle}>
              {decisions.length === 0 ? (
                <p style={{ padding: "28px 16px", fontSize: 12, color: "var(--text-3)", textAlign: "center" }}>No decisions yet for this project.</p>
              ) : (
                decisions.slice(0, 4).map(d => (
                  <div
                    key={d.id}
                    onClick={() => router.push("/decisions")}
                    style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderBottom: "1px solid var(--border-2)", cursor: "pointer" }}
                    className="hover:bg-[var(--accent-softer)] last:border-0 transition-colors"
                  >
                    <div style={{ width: 24, height: 24, borderRadius: 6, flexShrink: 0, background: "var(--green-soft)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <CheckCircle2 style={{ width: 12, height: 12, color: "var(--green)" }} />
                    </div>
                    <p style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 500, color: "var(--text)" }} className="truncate">{d.decision_text}</p>
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-3)", flexShrink: 0 }}>{timeAgo(d.decided_at)}</span>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Recent risks */}
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <p style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>Recent risks</p>
              <Link href="/risks" style={{ fontSize: 11, color: "var(--text-3)", textDecoration: "none" }} className="hover:text-[var(--text-2)]">View all →</Link>
            </div>
            <div style={panelStyle}>
              {risks.length === 0 ? (
                <p style={{ padding: "28px 16px", fontSize: 12, color: "var(--text-3)", textAlign: "center" }}>No open risks. 🎉</p>
              ) : (
                risks.slice(0, 4).map(r => (
                  <div
                    key={r.id}
                    onClick={() => router.push(`/inbox/${projectId}/${r.id}`)}
                    style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderBottom: "1px solid var(--border-2)", cursor: "pointer" }}
                    className="hover:bg-[var(--accent-softer)] last:border-0 transition-colors"
                  >
                    <div style={{ width: 24, height: 24, borderRadius: 6, flexShrink: 0, background: "var(--red-soft)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <AlertTriangle style={{ width: 12, height: 12, color: "var(--red)" }} />
                    </div>
                    <p style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 500, color: "var(--text)" }} className="truncate">
                      {(r.ai_key_question && r.ai_key_question !== "None") ? r.ai_key_question : (r.ai_summary ?? "Untitled")}
                    </p>
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-3)", flexShrink: 0 }}>{timeAgo(r.created_at)}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* ── Files ── */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <p style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>Files</p>
          <button
            onClick={() => setShowAddFile(v => !v)}
            style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "var(--text-2)", background: "none", border: "none", cursor: "pointer" }}
            className="hover:text-[var(--text)] transition-colors"
          >
            <Plus style={{ width: 11, height: 11 }} />
            Add Figma file
          </button>
        </div>

        {showAddFile && (
          <div style={{ marginBottom: 10 }} className="fade-in">
            <div style={{ display: "flex", gap: 8 }}>
              <input
                autoFocus
                value={fileUrl}
                onChange={e => setFileUrl(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") void addFile(); }}
                placeholder="Paste a Figma file URL…"
                style={{
                  flex: 1, padding: "8px 12px", fontSize: 12,
                  borderRadius: 8, border: "1px solid var(--border)",
                  background: "var(--surface)", color: "var(--text)", outline: "none",
                }}
              />
              <button
                onClick={addFile}
                disabled={addingFile || !fileUrl.trim()}
                style={{
                  display: "flex", alignItems: "center", gap: 6,
                  background: "var(--accent)", color: "var(--accent-ink)",
                  borderRadius: 8, padding: "8px 14px", fontSize: 12, fontWeight: 500,
                  border: "none", cursor: "pointer",
                  opacity: addingFile || !fileUrl.trim() ? 0.4 : 1,
                }}
              >
                {addingFile && <Loader2 style={{ width: 12, height: 12 }} className="animate-spin" />}
                Add
              </button>
            </div>
            {fileError && <p style={{ fontSize: 11, color: "var(--red)", marginTop: 5 }}>{fileError}</p>}
          </div>
        )}

        <div style={panelStyle}>
          {(project.figma_files?.length ?? 0) === 0 ? (
            <p style={{ padding: "28px 16px", fontSize: 12, color: "var(--text-3)", textAlign: "center" }}>
              No files yet — add a Figma file URL or sync your team from Integrations.
            </p>
          ) : (
            project.figma_files.map(f => (
              <div
                key={f.id}
                style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 14px", borderBottom: "1px solid var(--border-2)" }}
                className="last:border-0"
              >
                <div style={{ width: 28, height: 28, borderRadius: 7, flexShrink: 0, background: "var(--bg)", border: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <FileText style={{ width: 13, height: 13, color: "var(--text-2)" }} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 12.5, fontWeight: 500, color: "var(--text)" }} className="truncate">{f.name}</p>
                  <p style={{ fontSize: 10.5, color: "var(--text-3)", marginTop: 1 }}>
                    {f.last_synced_at ? `Synced ${timeAgo(f.last_synced_at)}` : "Never synced"}
                    {syncResult[f.id] && <span style={{ marginLeft: 6, color: syncResult[f.id].startsWith("✓") ? "var(--green)" : "var(--red)" }}>{syncResult[f.id]}</span>}
                  </p>
                </div>
                <button
                  onClick={() => syncFile(f.id)}
                  disabled={syncingFile === f.id}
                  style={{
                    display: "flex", alignItems: "center", gap: 5,
                    fontSize: 11, fontWeight: 500, padding: "5px 10px", borderRadius: 7,
                    border: "1px solid var(--border)", background: "var(--surface)",
                    color: "var(--text-2)", cursor: "pointer", flexShrink: 0,
                    opacity: syncingFile === f.id ? 0.5 : 1,
                  }}
                  className="hover:border-[var(--accent-border)] transition-colors"
                >
                  <RefreshCw style={{ width: 10, height: 10 }} className={syncingFile === f.id ? "animate-spin" : ""} />
                  Sync
                </button>
              </div>
            ))
          )}
        </div>

      </div>
    </div>
  );
}
