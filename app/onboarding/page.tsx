"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, ArrowRight, Check } from "lucide-react";

type Step = "info" | "figma";

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("info");

  // Step 1
  const [name, setName] = useState("");
  const [workspaceName, setWorkspaceName] = useState("");

  // Step 2
  const [pat, setPat] = useState("");
  const [showPat, setShowPat] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleInfoSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !workspaceName.trim()) return;
    setStep("figma");
  }

  async function handleFigmaSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const { createClient } = await import("@/lib/supabase/client");
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();

      if (!session) {
        setError("Session expired — please sign in again.");
        setLoading(false);
        return;
      }

      const res = await fetch("/api/onboarding", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ name, workspaceName, figmaPat: pat }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong");
        setLoading(false);
      } else {
        router.push("/agents/figma-compare");
      }
    } catch (err) {
      setError("Unexpected error: " + String(err));
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#0f0f13] flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex items-center gap-3 mb-10 justify-center">
          <div
            className="flex h-8 w-8 items-center justify-center rounded-lg"
            style={{ background: "linear-gradient(135deg, #a855f7, #ec4899, #f97316)" }}
          >
            <span className="text-[13px] font-bold text-white">L</span>
          </div>
          <span className="text-white font-semibold text-[18px] font-[family-name:var(--font-serif)] italic">
            Loupe
          </span>
        </div>

        {/* Step indicator */}
        <div className="flex items-center gap-2 mb-6 justify-center">
          <StepDot active={step === "info"} done={step === "figma"} label="1" />
          <div className="h-px w-8 bg-white/10" />
          <StepDot active={step === "figma"} done={false} label="2" />
        </div>

        <div className="bg-[#1a1a24] border border-white/10 rounded-2xl p-8">
          {step === "info" ? (
            <>
              <h1 className="text-white text-2xl font-bold mb-1">Welcome to Loupe</h1>
              <p className="text-white/40 text-sm mb-8">Tell us a bit about you to get started.</p>

              <form onSubmit={handleInfoSubmit} className="space-y-4">
                <div>
                  <label className="block text-white/60 text-xs font-medium mb-1.5">Your name</label>
                  <input
                    type="text"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder="Alex Morgan"
                    required
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm placeholder:text-white/20 focus:outline-none focus:border-purple-500/60 transition-colors"
                  />
                </div>

                <div>
                  <label className="block text-white/60 text-xs font-medium mb-1.5">Workspace name</label>
                  <input
                    type="text"
                    value={workspaceName}
                    onChange={e => setWorkspaceName(e.target.value)}
                    placeholder="Acme Design Team"
                    required
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm placeholder:text-white/20 focus:outline-none focus:border-purple-500/60 transition-colors"
                  />
                </div>

                <button
                  type="submit"
                  disabled={!name.trim() || !workspaceName.trim()}
                  className="w-full flex items-center justify-center gap-2 bg-purple-600 hover:bg-purple-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold text-sm py-3 px-4 rounded-xl transition-colors mt-2"
                >
                  Continue <ArrowRight size={15} />
                </button>
              </form>
            </>
          ) : (
            <>
              <h1 className="text-white text-2xl font-bold mb-1">Connect Figma</h1>
              <p className="text-white/40 text-sm mb-2">
                Add your Figma Personal Access Token so Loupe can read your files and comments.
              </p>
              <a
                href="https://www.figma.com/settings"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block text-purple-400 hover:text-purple-300 text-xs mb-6 transition-colors"
              >
                Generate a PAT in Figma Settings →
              </a>

              <form onSubmit={handleFigmaSubmit} className="space-y-4">
                <div>
                  <label className="block text-white/60 text-xs font-medium mb-1.5">
                    Figma Personal Access Token
                  </label>
                  <div className="relative">
                    <input
                      type={showPat ? "text" : "password"}
                      value={pat}
                      onChange={e => setPat(e.target.value)}
                      placeholder="figd_••••••••••••••••"
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 pr-10 text-white text-sm placeholder:text-white/20 focus:outline-none focus:border-purple-500/60 transition-colors font-mono"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPat(v => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60 transition-colors"
                    >
                      {showPat ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                  <p className="text-white/25 text-xs mt-1.5">
                    Stored securely. Only used to sync your Figma files.
                  </p>
                </div>

                {error && (
                  <p className="text-red-400 text-xs">{error}</p>
                )}

                <div className="flex gap-3 pt-1">
                  <button
                    type="button"
                    onClick={() => { setError(""); setStep("info"); }}
                    className="flex-1 bg-white/5 hover:bg-white/10 text-white/60 font-semibold text-sm py-3 px-4 rounded-xl transition-colors"
                  >
                    Back
                  </button>
                  <button
                    type="submit"
                    disabled={loading}
                    className="flex-1 flex items-center justify-center gap-2 bg-purple-600 hover:bg-purple-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold text-sm py-3 px-4 rounded-xl transition-colors"
                  >
                    {loading ? (
                      <span className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    ) : (
                      <>{pat.trim() ? "Finish setup" : "Skip for now"} <ArrowRight size={15} /></>
                    )}
                  </button>
                </div>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function StepDot({ active, done, label }: { active: boolean; done: boolean; label: string }) {
  return (
    <div
      className={`h-7 w-7 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
        done
          ? "bg-purple-600 text-white"
          : active
          ? "bg-purple-600/20 border border-purple-500 text-purple-400"
          : "bg-white/5 border border-white/10 text-white/20"
      }`}
    >
      {done ? <Check size={13} /> : label}
    </div>
  );
}
