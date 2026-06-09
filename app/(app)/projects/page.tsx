"use client";
import { useState, useEffect } from "react";
import { Plus, FolderOpen, Link2, Loader2, RefreshCw, Trash2 } from "lucide-react";

interface FigmaFile {
  id: string;
  name: string;
  figma_file_key: string;
  sync_status: string;
  last_synced_at: string | null;
}

interface Project {
  id: string;
  name: string;
  figma_files: FigmaFile[];
}

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  // New project
  const [showNewProject, setShowNewProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [creatingProject, setCreatingProject] = useState(false);

  // Deleting
  const [deletingProject, setDeletingProject] = useState<string | null>(null);

  // Syncing
  const [syncingFile, setSyncingFile] = useState<string | null>(null);
  const [syncResult, setSyncResult] = useState<Record<string, string>>({});

  // Add file
  const [addingFileTo, setAddingFileTo] = useState<string | null>(null);
  const [fileUrl, setFileUrl] = useState("");
  const [addingFile, setAddingFile] = useState(false);
  const [fileError, setFileError] = useState("");

  useEffect(() => { loadProjects(); }, []);

  async function loadProjects() {
    const res = await fetch("/api/projects");
    const data = await res.json() as { projects?: Project[] };
    setProjects(data.projects ?? []);
    setLoading(false);
  }

  async function deleteProject(id: string) {
    if (!confirm("Delete this project and all its files?")) return;
    setDeletingProject(id);
    await fetch("/api/projects", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    loadProjects();
    setDeletingProject(null);
  }

  async function syncFile(fileId: string) {
    setSyncingFile(fileId);
    setSyncResult(prev => ({ ...prev, [fileId]: "" }));
    const res = await fetch(`/api/figma-files/${fileId}/sync`, { method: "POST" });
    const data = await res.json() as { added?: number; error?: string };
    if (res.ok) {
      setSyncResult(prev => ({ ...prev, [fileId]: `✓ ${data.added ?? 0} new comments` }));
      loadProjects();
    } else {
      setSyncResult(prev => ({ ...prev, [fileId]: `✗ ${data.error ?? "Sync failed"}` }));
    }
    setSyncingFile(null);
  }

  async function createProject() {
    if (!newProjectName.trim()) return;
    setCreatingProject(true);
    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newProjectName }),
    });
    if (res.ok) {
      setNewProjectName("");
      setShowNewProject(false);
      loadProjects();
    }
    setCreatingProject(false);
  }

  async function addFile(projectId: string) {
    if (!fileUrl.trim()) return;
    setAddingFile(true);
    setFileError("");
    const res = await fetch(`/api/projects/${projectId}/files`, {
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
    setAddingFileTo(null);
    loadProjects();
    setAddingFile(false);
  }

  return (
    <div className="p-8 max-w-3xl">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-white text-2xl font-bold">Projects</h1>
          <p className="text-gray-500 text-sm mt-1">Connect Figma files to start syncing comments.</p>
        </div>
        <button
          onClick={() => setShowNewProject(true)}
          className="flex items-center gap-2 bg-zinc-700 hover:bg-zinc-600 text-white text-sm font-semibold px-4 py-2 rounded-xl transition-colors"
        >
          <Plus size={15} />
          New project
        </button>
      </div>

      {/* New project form */}
      {showNewProject && (
        <div className="bg-white border border-zinc-600/60 rounded-2xl p-5 mb-4">
          <h3 className="text-white text-sm font-semibold mb-3">New project</h3>
          <input
            value={newProjectName}
            onChange={e => setNewProjectName(e.target.value)}
            onKeyDown={e => e.key === "Enter" && createProject()}
            placeholder="e.g. Mobile App Redesign"
            autoFocus
            className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-white text-sm placeholder:text-gray-300 outline-none focus:border-zinc-600 transition-colors mb-3"
          />
          <div className="flex gap-2">
            <button
              onClick={createProject}
              disabled={creatingProject || !newProjectName.trim()}
              className="flex items-center gap-2 bg-zinc-700 hover:bg-zinc-600 disabled:opacity-40 text-white text-sm font-semibold px-4 py-2 rounded-xl transition-colors"
            >
              {creatingProject && <Loader2 size={13} className="animate-spin" />}
              Create
            </button>
            <button
              onClick={() => { setShowNewProject(false); setNewProjectName(""); }}
              className="text-gray-500 hover:text-white/70 text-sm px-3 py-2 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-gray-400 text-sm">
          <Loader2 size={14} className="animate-spin" /> Loading…
        </div>
      ) : projects.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-2xl p-12 text-center">
          <FolderOpen size={32} className="text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500 text-sm">No projects yet. Create one to get started.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {projects.map(project => (
            <div key={project.id} className="bg-white border border-gray-200 rounded-2xl p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-white font-semibold">{project.name}</h3>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => { setAddingFileTo(project.id); setFileUrl(""); setFileError(""); }}
                    className="flex items-center gap-1.5 text-zinc-300 hover:text-zinc-200 text-xs font-medium transition-colors"
                  >
                    <Plus size={13} />
                    Add Figma file
                  </button>
                  <button
                    onClick={() => deleteProject(project.id)}
                    disabled={deletingProject === project.id}
                    className="text-gray-300 hover:text-red-400 transition-colors"
                  >
                    {deletingProject === project.id
                      ? <Loader2 size={13} className="animate-spin" />
                      : <Trash2 size={13} />}
                  </button>
                </div>
              </div>

              {/* Add file form */}
              {addingFileTo === project.id && (
                <div className="bg-gray-50 rounded-xl p-4 mb-4">
                  <p className="text-white/50 text-xs mb-2">Paste a Figma file URL</p>
                  <input
                    value={fileUrl}
                    onChange={e => { setFileUrl(e.target.value); setFileError(""); }}
                    onKeyDown={e => e.key === "Enter" && addFile(project.id)}
                    placeholder="https://www.figma.com/design/…"
                    autoFocus
                    className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-white text-sm placeholder:text-gray-300 outline-none focus:border-zinc-600 transition-colors mb-2"
                  />
                  {fileError && <p className="text-red-400 text-xs mb-2">{fileError}</p>}
                  <div className="flex gap-2">
                    <button
                      onClick={() => addFile(project.id)}
                      disabled={addingFile || !fileUrl.trim()}
                      className="flex items-center gap-1.5 bg-zinc-700 hover:bg-zinc-600 disabled:opacity-40 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors"
                    >
                      {addingFile && <Loader2 size={11} className="animate-spin" />}
                      Add file
                    </button>
                    <button
                      onClick={() => setAddingFileTo(null)}
                      className="text-gray-400 hover:text-white/60 text-xs px-2 transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {/* Files list */}
              {project.figma_files.length === 0 ? (
                <p className="text-gray-300 text-xs">No files yet.</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {project.figma_files.map(file => (
                    <div key={file.id} className="flex items-center gap-3 bg-gray-50 rounded-xl px-4 py-3">
                      <Link2 size={14} className="text-gray-400 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-white text-sm font-medium truncate">{file.name}</p>
                        <p className="text-gray-400 text-xs">
                          {file.last_synced_at
                            ? `Last synced ${new Date(file.last_synced_at).toLocaleString()}`
                            : "Never synced"}
                        </p>
                        {syncResult[file.id] && (
                          <p className={`text-xs mt-0.5 ${syncResult[file.id].startsWith("✓") ? "text-zinc-700" : "text-red-400"}`}>
                            {syncResult[file.id]}
                          </p>
                        )}
                      </div>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        file.sync_status === "idle" ? "bg-white/10 text-gray-500" :
                        file.sync_status === "syncing" ? "bg-zinc-700/40 text-zinc-300" :
                        file.sync_status === "error" ? "bg-red-500/20 text-red-400" :
                        "bg-white/10 text-gray-500"
                      }`}>
                        {file.sync_status}
                      </span>
                      <button
                        onClick={() => syncFile(file.id)}
                        disabled={syncingFile === file.id}
                        className="flex items-center gap-1.5 bg-zinc-700/40 hover:bg-zinc-600/50 disabled:opacity-40 text-zinc-300 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
                      >
                        {syncingFile === file.id
                          ? <Loader2 size={12} className="animate-spin" />
                          : <RefreshCw size={12} />}
                        Sync
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
