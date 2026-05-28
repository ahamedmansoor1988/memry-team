"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function OnboardingPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function create() {
    if (!name.trim()) return;
    setLoading(true);
    setError("");

    const res = await fetch("/api/workspaces", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });

    const data = await res.json() as { error?: string };

    if (!res.ok) {
      setError(data.error ?? "Something went wrong");
      setLoading(false);
      return;
    }

    router.push("/inbox");
  }

  return (
    <div className="min-h-screen bg-[#0f0f13] flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex items-center gap-3 mb-10 justify-center">
          <div className="w-9 h-9 rounded-xl bg-zinc-700 flex items-center justify-center">
            <span className="text-white font-bold text-lg">m</span>
          </div>
          <span className="text-white font-bold text-xl tracking-tight">memry.team</span>
        </div>

        <div className="bg-[#1a1a24] border border-white/10 rounded-2xl p-8">
          <h1 className="text-white text-2xl font-bold mb-1">Create your workspace</h1>
          <p className="text-white/40 text-sm mb-8">
            This is where your team will collaborate on design decisions.
          </p>

          <label className="block text-white/50 text-xs font-semibold mb-2 uppercase tracking-wider">
            Workspace name
          </label>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => e.key === "Enter" && create()}
            placeholder="e.g. Acme Design Team"
            className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm placeholder:text-white/20 outline-none focus:border-zinc-600 transition-colors mb-4"
            autoFocus
          />

          {error && (
            <p className="text-red-400 text-sm mb-4">{error}</p>
          )}

          <button
            onClick={create}
            disabled={loading || !name.trim()}
            className="w-full bg-zinc-700 hover:bg-zinc-600 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold text-sm py-3 rounded-xl transition-colors"
          >
            {loading ? "Creating…" : "Create workspace →"}
          </button>
        </div>
      </div>
    </div>
  );
}
