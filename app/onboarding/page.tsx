"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, AlertCircle, Loader2, ChevronLeft } from "lucide-react";

// ─── Step indicator ───────────────────────────────────────────────────────────

function StepIndicator({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex items-center justify-center gap-2 mb-8">
      {Array.from({ length: total }, (_, i) => {
        const step = i + 1;
        const done = step < current;
        const active = step === current;
        return (
          <div key={step} className="flex items-center gap-2">
            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
              done   ? "bg-emerald-500 text-white"
              : active ? "bg-zinc-700 text-white ring-2 ring-zinc-500 ring-offset-2 ring-offset-[#0f0f13]"
              : "bg-white/10 text-white/30"
            }`}>
              {done ? <CheckCircle2 size={14} /> : step}
            </div>
            {step < total && (
              <div className={`w-8 h-px ${done ? "bg-emerald-500" : "bg-white/10"}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Input helper ─────────────────────────────────────────────────────────────

function Field({
  label, value, onChange, placeholder, type = "text", disabled = false,
}: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; type?: string; disabled?: boolean;
}) {
  return (
    <div className="mb-4">
      <label className="block text-white/50 text-xs font-semibold mb-2 uppercase tracking-wider">
        {label}
      </label>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm placeholder:text-white/20 outline-none focus:border-zinc-500 transition-colors disabled:opacity-40"
      />
    </div>
  );
}

// ─── Step 1 — Create workspace ────────────────────────────────────────────────

function Step1({
  onNext,
}: {
  onNext: () => void;
}) {
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    const trimmed = name.trim();
    if (trimmed.length < 2) { setError("Workspace name must be at least 2 characters."); return; }
    setLoading(true);
    setError("");
    const res = await fetch("/api/workspaces", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: trimmed }),
    });
    const data = await res.json() as { error?: string };
    if (!res.ok) { setError(data.error ?? "Something went wrong."); setLoading(false); return; }
    onNext();
  }

  return (
    <>
      <h1 className="text-white text-2xl font-bold mb-1">Create your workspace</h1>
      <p className="text-white/40 text-sm mb-8">This is where your team will collaborate on design decisions.</p>

      <Field label="Workspace name" value={name} onChange={setName} placeholder="e.g. Acme Design Team" />

      {error && <p className="text-red-400 text-sm mb-4 flex items-center gap-1.5"><AlertCircle size={14} />{error}</p>}

      <button
        onClick={submit}
        disabled={loading || name.trim().length < 2}
        className="w-full bg-zinc-700 hover:bg-zinc-600 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold text-sm py-3 rounded-xl transition-colors flex items-center justify-center gap-2"
      >
        {loading && <Loader2 size={14} className="animate-spin" />}
        {loading ? "Creating…" : "Create workspace →"}
      </button>
    </>
  );
}

// ─── Step 2 — Connect Figma ───────────────────────────────────────────────────

function Step2({
  onNext, onBack, onFigmaConnected,
}: {
  onNext: () => void;
  onBack: () => void;
  onFigmaConnected: (connected: boolean) => void;
}) {
  const [pat,     setPat]     = useState("");
  const [teamId,  setTeamId]  = useState("");
  const [userId,  setUserId]  = useState("");
  const [testing, setTesting] = useState(false);
  const [saving,  setSaving]  = useState(false);
  const [status,  setStatus]  = useState<"idle" | "ok" | "error">("idle");
  const [msg,     setMsg]     = useState("");

  async function testAndSave() {
    if (!pat.trim() || !teamId.trim()) { setMsg("PAT and Team ID are required."); setStatus("error"); return; }
    setTesting(true); setStatus("idle"); setMsg("");

    const res = await fetch("/api/integrations/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ figma_pat: pat.trim(), figma_team_id: teamId.trim(), figma_user_id: userId.trim() || null }),
    });
    const data = await res.json() as { error?: string };
    setTesting(false);
    if (!res.ok) { setStatus("error"); setMsg(data.error ?? "Failed to save settings."); return; }
    setStatus("ok"); setMsg("Figma connected successfully!");
    onFigmaConnected(true);
  }

  async function saveAndNext() {
    if (status !== "ok") { await testAndSave(); }
    if (status === "ok") onNext();
  }

  function skipFigma() { onFigmaConnected(false); onNext(); }

  return (
    <>
      <button onClick={onBack} className="flex items-center gap-1 text-white/40 hover:text-white/70 text-sm mb-6 transition-colors">
        <ChevronLeft size={14} /> Back
      </button>

      <h1 className="text-white text-2xl font-bold mb-1">Connect Figma</h1>
      <p className="text-white/40 text-sm mb-8">Sync comments from your Figma files into Memry.</p>

      <Field label="Personal Access Token" value={pat} onChange={setPat} placeholder="figd_…" type="password" />
      <Field label="Team ID" value={teamId} onChange={setTeamId} placeholder="123456789" />
      <Field label="Figma User ID (optional)" value={userId} onChange={setUserId} placeholder="leave blank to import all" />

      {status === "ok" && (
        <p className="text-emerald-400 text-sm mb-4 flex items-center gap-1.5"><CheckCircle2 size={14} />{msg}</p>
      )}
      {status === "error" && (
        <p className="text-red-400 text-sm mb-4 flex items-center gap-1.5"><AlertCircle size={14} />{msg}</p>
      )}

      <div className="flex flex-col gap-2">
        {status !== "ok" && (
          <button
            onClick={testAndSave}
            disabled={testing || !pat.trim() || !teamId.trim()}
            className="w-full bg-zinc-700 hover:bg-zinc-600 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold text-sm py-3 rounded-xl transition-colors flex items-center justify-center gap-2"
          >
            {testing && <Loader2 size={14} className="animate-spin" />}
            {testing ? "Testing connection…" : "Test connection"}
          </button>
        )}

        {status === "ok" && (
          <button
            onClick={saveAndNext}
            disabled={saving}
            className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white font-semibold text-sm py-3 rounded-xl transition-colors flex items-center justify-center gap-2"
          >
            {saving && <Loader2 size={14} className="animate-spin" />}
            Continue →
          </button>
        )}

        <button onClick={skipFigma} className="w-full text-white/40 hover:text-white/60 text-sm py-2 transition-colors">
          Skip for now
        </button>
      </div>
    </>
  );
}

// ─── Step 3 — Connect Slack ───────────────────────────────────────────────────

function Step3({
  onFinish, onBack, figmaConnected,
}: {
  onFinish: () => void;
  onBack: () => void;
  figmaConnected: boolean;
}) {
  const router = useRouter();
  const [botToken,       setBotToken]       = useState("");
  const [channelId,      setChannelId]      = useState("");
  const [signingSecret,  setSigningSecret]  = useState("");
  const [saving,   setSaving]  = useState(false);
  const [status,   setStatus]  = useState<"idle" | "ok" | "error">("idle");
  const [msg,      setMsg]     = useState("");
  const [finishing, setFinishing] = useState(false);

  function validate() {
    if (!botToken.trim() || !channelId.trim()) {
      setMsg("Bot Token and Channel ID are required."); setStatus("error"); return false;
    }
    return true;
  }

  async function saveSlack() {
    if (!validate()) return;
    setSaving(true); setStatus("idle"); setMsg("");
    const res = await fetch("/api/integrations/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slack_bot_token: botToken.trim(), slack_channel_id: channelId.trim(), slack_signing_secret: signingSecret.trim() || null }),
    });
    setSaving(false);
    if (!res.ok) { setStatus("error"); setMsg("Failed to save Slack settings."); return; }
    setStatus("ok"); setMsg("Slack connected!");
  }

  async function finishSetup(skipSlack = false) {
    setFinishing(true);

    // If Slack filled but not saved, try to save
    if (!skipSlack && status !== "ok" && botToken.trim()) {
      await saveSlack();
    }

    // Trigger first sync if Figma connected
    if (figmaConnected) {
      await fetch("/api/figma/pull", { method: "POST" }).catch(() => {});
    }

    router.push("/dashboard");
  }

  return (
    <>
      <button onClick={onBack} className="flex items-center gap-1 text-white/40 hover:text-white/70 text-sm mb-6 transition-colors">
        <ChevronLeft size={14} /> Back
      </button>

      <h1 className="text-white text-2xl font-bold mb-1">Connect Slack</h1>
      <p className="text-white/40 text-sm mb-8">Post new feedback and decisions to a Slack channel automatically.</p>

      <Field label="Bot Token" value={botToken} onChange={setBotToken} placeholder="xoxb-…" type="password" />
      <Field label="Channel ID" value={channelId} onChange={setChannelId} placeholder="C01234ABCD" />
      <Field label="Signing Secret (optional)" value={signingSecret} onChange={setSigningSecret} placeholder="abc123…" type="password" />

      {status === "ok" && (
        <p className="text-emerald-400 text-sm mb-4 flex items-center gap-1.5"><CheckCircle2 size={14} />{msg}</p>
      )}
      {status === "error" && (
        <p className="text-red-400 text-sm mb-4 flex items-center gap-1.5"><AlertCircle size={14} />{msg}</p>
      )}

      <div className="flex flex-col gap-2">
        <button
          onClick={() => finishSetup(false)}
          disabled={finishing}
          className="w-full bg-zinc-700 hover:bg-zinc-600 disabled:opacity-40 text-white font-semibold text-sm py-3 rounded-xl transition-colors flex items-center justify-center gap-2"
        >
          {finishing && <Loader2 size={14} className="animate-spin" />}
          {finishing ? "Setting up…" : (status === "ok" ? "Finish setup →" : "Save & finish →")}
        </button>

        <button
          onClick={() => finishSetup(true)}
          disabled={finishing}
          className="w-full text-white/40 hover:text-white/60 text-sm py-2 transition-colors"
        >
          Skip for now
        </button>
      </div>
    </>
  );
}

// ─── Main wizard ──────────────────────────────────────────────────────────────

export default function OnboardingPage() {
  const [step, setStep] = useState(1);
  const [figmaConnected, setFigmaConnected] = useState(false);

  return (
    <div className="min-h-screen bg-[#0f0f13] flex items-center justify-center px-4">
      <div className="w-full max-w-md">

        {/* Logo */}
        <div className="flex items-center gap-3 mb-10 justify-center">
          <div className="w-9 h-9 rounded-xl bg-zinc-700 flex items-center justify-center">
            <span className="text-white font-bold text-lg">m</span>
          </div>
          <span className="text-white font-bold text-xl tracking-tight">memry.team</span>
        </div>

        {/* Step indicator */}
        <StepIndicator current={step} total={3} />

        {/* Card */}
        <div className="bg-[#1a1a24] border border-white/10 rounded-2xl p-8">
          {step === 1 && (
            <Step1
              onNext={() => setStep(2)}
            />
          )}
          {step === 2 && (
            <Step2
              onNext={() => setStep(3)}
              onBack={() => setStep(1)}
              onFigmaConnected={setFigmaConnected}
            />
          )}
          {step === 3 && (
            <Step3
              onFinish={() => {}}
              onBack={() => setStep(2)}
              figmaConnected={figmaConnected}
            />
          )}
        </div>

        {/* Footer */}
        <p className="text-center text-white/20 text-xs mt-6">
          memry.team · design feedback intelligence
        </p>
      </div>
    </div>
  );
}
