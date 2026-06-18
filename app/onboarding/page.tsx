"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2, AlertCircle } from "lucide-react";

export default function OnboardingPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState("");

  // If user already has a workspace, skip onboarding
  useEffect(() => {
    fetch("/api/integrations/settings")
      .then(r => r.json())
      .then(d => {
        if (d.workspace_id) router.replace("/integrations");
        else setChecking(false);
      })
      .catch(() => setChecking(false));
  }, [router]);

  async function createWorkspace() {
    const trimmed = name.trim();
    if (trimmed.length < 2) { setError("Name must be at least 2 characters."); return; }
    setLoading(true);
    setError("");
    const res = await fetch("/api/workspaces", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: trimmed }),
    });
    const data = await res.json() as { error?: string };
    if (!res.ok) { setError(data.error ?? "Something went wrong."); setLoading(false); return; }
    router.push("/integrations");
  }

  if (checking) {
    return (
      <div className="min-h-screen bg-[#0f0f13] flex items-center justify-center">
        <Loader2 size={20} className="text-white/30 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0f0f13] flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-3 mb-10 justify-center">
          <div className="w-9 h-9 rounded-xl bg-zinc-700 flex items-center justify-center">
            <span className="text-white font-bold text-lg">m</span>
          </div>
          <span className="text-white font-bold text-xl tracking-tight">memry</span>
        </div>

        <div className="bg-[#1a1a24] border border-white/10 rounded-2xl p-8">
          <h1 className="text-white text-2xl font-bold mb-1">Create your workspace</h1>
          <p className="text-white/40 text-sm mb-8">
            Where your team's decisions will be captured automatically.
          </p>

          <div className="mb-4">
            <label className="block text-white/50 text-xs font-semibold mb-2 uppercase tracking-wider">
              Workspace name
            </label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => e.key === "Enter" && createWorkspace()}
              placeholder="e.g. Acme Product Team"
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm placeholder:text-white/20 outline-none focus:border-zinc-500 transition-colors"
            />
          </div>

          {error && (
            <p className="text-red-400 text-sm mb-4 flex items-center gap-1.5">
              <AlertCircle size={14} />{error}
            </p>
          )}

          <button
            onClick={createWorkspace}
            disabled={loading || name.trim().length < 2}
            className="w-full bg-zinc-700 hover:bg-zinc-600 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold text-sm py-3 rounded-xl transition-colors flex items-center justify-center gap-2"
          >
            {loading && <Loader2 size={14} className="animate-spin" />}
            {loading ? "Creating…" : "Create workspace →"}
          </button>
        </div>
      </div>
    </div>
  );
}
