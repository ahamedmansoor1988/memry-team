"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2, Loader2, AlertCircle, ArrowRight } from "lucide-react";

const APP_URL = "https://memry-team-opal.vercel.app";

type Step = 1 | 2 | 3 | 4;

interface ConnectionStatus {
  slack:        boolean;
  figma:        boolean;
  jira:         boolean;
  notion:       boolean;
  slackChannel: string | null;
}

// ── Progress stepper ──────────────────────────────────────────────────────────

function StepDot({ n, label, active, done }: { n: number; label: string; active: boolean; done: boolean }) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
        done   ? "bg-white text-black"                  :
        active ? "bg-white/20 text-white border border-white/40" :
                 "bg-white/5 text-white/20 border border-white/10"
      }`}>
        {done ? <CheckCircle2 size={14} /> : n}
      </div>
      <span className={`text-xs transition-colors ${active ? "text-white/50" : "text-white/20"}`}>{label}</span>
    </div>
  );
}

function StepLine({ done }: { done: boolean }) {
  return <div className={`flex-1 h-px mt-4 transition-colors ${done ? "bg-white/30" : "bg-white/10"}`} />;
}

// ── Tool cards ────────────────────────────────────────────────────────────────

const TOOLS = [
  { id: "slack"  as const, label: "Slack",  desc: "Capture decisions from channels in real time.", bg: "#4A154B", emoji: "💬", oauth: true  },
  { id: "figma"  as const, label: "Figma",  desc: "Sync comments from design files daily.",        bg: "#1E1E1E", emoji: "🎨", oauth: false },
  { id: "jira"   as const, label: "Jira",   desc: "Pull decisions from issue comment threads.",    bg: "#0052CC", emoji: "📋", oauth: true  },
  { id: "notion" as const, label: "Notion", desc: "Track resolved discussions in pages.",          bg: "#191919", emoji: "📝", oauth: true  },
];

function FigmaForm({ onSuccess }: { onSuccess: () => void }) {
  const [pat, setPat]     = useState("");
  const [team, setTeam]   = useState("");
  const [busy, setBusy]   = useState(false);
  const [err, setErr]     = useState("");

  async function connect() {
    if (!pat.trim() || !team.trim()) { setErr("Both fields are required"); return; }
    setBusy(true); setErr("");
    const res  = await fetch("/api/integrations/figma/connect", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pat: pat.trim(), team_id: team.trim() }) });
    const data = await res.json() as { error?: string };
    setBusy(false);
    if (!res.ok) { setErr(data.error ?? "Failed to connect"); return; }
    // Kick off historical sync
    fetch("/api/integrations/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: "figma" }),
    }).catch(() => {});
    onSuccess();
  }

  return (
    <div className="mt-3 space-y-2">
      <input type="password" value={pat} onChange={e => setPat(e.target.value)} placeholder="Personal access token (figd_…)"
        className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder:text-white/20 outline-none focus:border-white/30 transition-colors" />
      <textarea value={team} onChange={e => setTeam(e.target.value)}
        placeholder={"https://www.figma.com/file/abc123/My-Design\nhttps://www.figma.com/design/xyz456/Another"}
        rows={2}
        className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder:text-white/20 outline-none focus:border-white/30 transition-colors resize-none" />
      {err && <p className="text-red-400 text-xs flex items-center gap-1"><AlertCircle size={11} />{err}</p>}
      <button onClick={connect} disabled={busy}
        className="w-full bg-white/10 hover:bg-white/15 text-white text-xs font-medium py-2 rounded-lg transition-colors disabled:opacity-40 flex items-center justify-center gap-1.5">
        {busy && <Loader2 size={11} className="animate-spin" />}
        {busy ? "Connecting…" : "Connect Figma"}
      </button>
    </div>
  );
}

function ToolCard({ tool, connected, onConnected }: { tool: typeof TOOLS[number]; connected: boolean; onConnected: () => void }) {
  const [showForm, setShowForm] = useState(false);

  return (
    <div className={`p-4 rounded-xl border transition-colors ${connected ? "bg-white/5 border-white/20" : "bg-white/[0.03] border-white/10"}`}>
      <div className="flex items-start gap-3 mb-3">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center text-base shrink-0" style={{ background: tool.bg }}>
          {tool.emoji}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold text-white">{tool.label}</p>
            {connected && <CheckCircle2 size={13} className="text-green-400" />}
          </div>
          <p className="text-xs text-white/35 leading-relaxed">{tool.desc}</p>
        </div>
      </div>

      {!connected && (
        tool.oauth ? (
          <a href={`/api/integrations/${tool.id}/oauth?returnTo=/onboarding`}
            className="block text-center w-full bg-white/10 hover:bg-white/15 text-white text-xs font-medium py-2 rounded-lg transition-colors">
            Connect {tool.label}
          </a>
        ) : !showForm ? (
          <button onClick={() => setShowForm(true)}
            className="w-full bg-white/10 hover:bg-white/15 text-white text-xs font-medium py-2 rounded-lg transition-colors">
            Connect {tool.label}
          </button>
        ) : (
          <FigmaForm onSuccess={() => { setShowForm(false); onConnected(); }} />
        )
      )}
    </div>
  );
}

// ── Copy helper ───────────────────────────────────────────────────────────────

function CopyBox({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }
  return (
    <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-lg px-3 py-2">
      <code className="flex-1 text-xs text-white/50 break-all font-mono">{value}</code>
      <button onClick={copy} className="text-xs text-white/30 hover:text-white/60 transition-colors shrink-0 font-medium">
        {copied ? "Copied!" : "Copy"}
      </button>
    </div>
  );
}

// ── Main onboarding content ───────────────────────────────────────────────────

function OnboardingContent() {
  const router       = useRouter();
  const searchParams = useSearchParams();

  const [step, setStep]       = useState<Step | null>(null);
  const [wsName, setWsName]   = useState("");
  const [channel, setChannel] = useState("");
  const [status, setStatus]   = useState<ConnectionStatus | null>(null);
  const [busy, setBusy]       = useState(false);
  const [err, setErr]         = useState("");
  const [toast, setToast]     = useState<string | null>(null);

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 3000); };

  const fetchStatus = useCallback(async (): Promise<boolean> => {
    const res = await fetch("/api/integrations/settings");
    if (!res.ok) return false;
    const d = await res.json() as {
      workspace_id?: string;
      slack?: { connected: boolean };
      figma?: { connected: boolean };
      jira?:  { connected: boolean };
      notion?: { connected: boolean };
      slack_channel_id?: string | null;
    };
    setStatus({
      slack:        d.slack?.connected  ?? false,
      figma:        d.figma?.connected  ?? false,
      jira:         d.jira?.connected   ?? false,
      notion:       d.notion?.connected ?? false,
      slackChannel: d.slack_channel_id  ?? null,
    });
    setChannel(d.slack_channel_id ?? "");
    return !!d.workspace_id;
  }, []);

  useEffect(() => {
    const connectedTool = searchParams.get("connected");
    fetchStatus().then(hasWorkspace => {
      if (!hasWorkspace) {
        setStep(1);
        return;
      }
      if (connectedTool) {
        const name = connectedTool.charAt(0).toUpperCase() + connectedTool.slice(1);
        showToast(`${name} connected — syncing history…`);
        router.replace("/onboarding", { scroll: false });
        // Kick off historical sync in background
        fetch("/api/integrations/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ source: connectedTool }),
        }).then(r => r.json()).then((d: any) => {
          showToast(`${name} synced — ${d.synced ?? 0} items imported`);
        }).catch(() => {});
      }
      setStep(2);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function createWorkspace() {
    const name = wsName.trim();
    if (name.length < 2) { setErr("Name must be at least 2 characters"); return; }
    setBusy(true); setErr("");
    const res  = await fetch("/api/workspaces", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
    const data = await res.json() as { error?: string };
    setBusy(false);
    if (!res.ok) { setErr(data.error ?? "Something went wrong"); return; }
    setStep(2);
  }

  async function saveChannelAndNext() {
    if (channel.trim()) {
      setBusy(true);
      await fetch("/api/integrations/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ slack_channel_id: channel.trim() }) });
      setBusy(false);
    }
    setStep(4);
  }

  function advance() {
    if (status?.slack) setStep(3);
    else setStep(4);
  }

  const connectedCount = status ? [status.slack, status.figma, status.jira, status.notion].filter(Boolean).length : 0;
  const STEP_LABELS = ["Workspace", "Connect", "Slack", "Done"];

  if (step === null) {
    return (
      <div className="min-h-screen bg-[#0f0f13] flex items-center justify-center">
        <Loader2 size={20} className="text-white/20 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0f0f13] flex flex-col items-center pt-14 px-4 pb-16">
      {/* Logo */}
      <div className="flex items-center gap-2.5 mb-10">
        <div className="w-8 h-8 rounded-xl bg-zinc-700 flex items-center justify-center">
          <span className="text-white font-bold text-base">m</span>
        </div>
        <span className="text-white font-bold text-lg tracking-tight">memry</span>
      </div>

      {/* Progress */}
      <div className="flex items-start w-full max-w-xs mb-10">
        {STEP_LABELS.flatMap((label, i) => {
          const items = [
            <StepDot key={`s${i}`} n={i + 1} label={label} active={step === i + 1} done={(step as number) > i + 1} />,
          ];
          if (i < STEP_LABELS.length - 1) items.push(<StepLine key={`l${i}`} done={(step as number) > i + 1} />);
          return items;
        })}
      </div>

      {/* ── Step 1: Workspace name ── */}
      {step === 1 && (
        <div className="w-full max-w-sm bg-[#1a1a24] border border-white/10 rounded-2xl p-8">
          <h1 className="text-white text-2xl font-bold mb-1">Name your workspace</h1>
          <p className="text-white/40 text-sm mb-8">This is where your team's decisions will be captured automatically.</p>
          <input
            type="text" value={wsName} onChange={e => setWsName(e.target.value)}
            onKeyDown={e => e.key === "Enter" && createWorkspace()}
            placeholder="e.g. Acme Product Team"
            className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm placeholder:text-white/20 outline-none focus:border-zinc-500 transition-colors mb-4"
          />
          {err && <p className="text-red-400 text-xs mb-4 flex items-center gap-1.5"><AlertCircle size={12} />{err}</p>}
          <button onClick={createWorkspace} disabled={busy || wsName.trim().length < 2}
            className="w-full bg-white text-black font-semibold text-sm py-3 rounded-xl hover:bg-white/90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity flex items-center justify-center gap-2">
            {busy && <Loader2 size={13} className="animate-spin" />}
            {busy ? "Creating…" : "Continue →"}
          </button>
        </div>
      )}

      {/* ── Step 2: Connect tools ── */}
      {step === 2 && (
        <div className="w-full max-w-2xl bg-[#1a1a24] border border-white/10 rounded-2xl p-8">
          <h1 className="text-white text-2xl font-bold mb-1">Connect your tools</h1>
          <p className="text-white/40 text-sm mb-8">Memry automatically captures decisions, blockers, and risks from every tool you connect. Connect as many as you use.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-8">
            {TOOLS.map(tool => (
              <ToolCard key={tool.id} tool={tool} connected={!!status?.[tool.id]} onConnected={fetchStatus} />
            ))}
          </div>
          <div className="flex items-center justify-between">
            <p className="text-xs text-white/25">{connectedCount} of 4 connected</p>
            <div className="flex items-center gap-4">
              <button onClick={advance} className="text-xs text-white/30 hover:text-white/50 transition-colors">
                Skip for now
              </button>
              <button onClick={advance}
                className="bg-white text-black text-sm font-semibold px-5 py-2.5 rounded-xl hover:bg-white/90 transition-opacity flex items-center gap-2">
                Continue <ArrowRight size={14} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Step 3: Slack setup ── */}
      {step === 3 && (
        <div className="w-full max-w-lg bg-[#1a1a24] border border-white/10 rounded-2xl p-8">
          <h1 className="text-white text-2xl font-bold mb-1">Set up Slack</h1>
          <p className="text-white/40 text-sm mb-8">Two quick steps to enable blocker alerts and the <code className="bg-white/10 px-1 rounded">/memry</code> slash command.</p>

          <div className="space-y-6">
            {/* Channel */}
            <div>
              <p className="text-white/50 text-xs font-semibold uppercase tracking-wider mb-1.5">Default channel</p>
              <p className="text-white/30 text-xs mb-2">
                Paste your Slack channel ID — alerts and summaries go here. Find it in Slack: right-click the channel → View channel details → scroll to bottom.
              </p>
              <input type="text" value={channel} onChange={e => setChannel(e.target.value)}
                placeholder="C0123456789"
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm font-mono placeholder:text-white/20 outline-none focus:border-zinc-500 transition-colors" />
            </div>

            {/* Events API — most important */}
            <div className="border border-white/20 rounded-xl p-4 bg-white/5">
              <div className="flex items-center gap-2 mb-1.5">
                <p className="text-white/60 text-xs font-semibold uppercase tracking-wider">Events API</p>
                <span className="text-2xs bg-amber-500/20 text-amber-400 px-1.5 py-0.5 rounded-full font-medium">Required for real-time</span>
              </div>
              <p className="text-white/30 text-xs mb-2">
                In your Slack app → <strong className="text-white/50">Event Subscriptions</strong> → toggle ON → paste as Request URL, then add bot event <code className="bg-white/10 px-1 rounded">message.channels</code>:
              </p>
              <CopyBox value={`${APP_URL}/api/slack/events`} />
            </div>

            {/* Slash command */}
            <div>
              <p className="text-white/50 text-xs font-semibold uppercase tracking-wider mb-1.5">Slash command</p>
              <p className="text-white/30 text-xs mb-2">
                In your Slack app → <strong className="text-white/40">Slash Commands</strong> → create command <code className="bg-white/10 px-1 rounded">/memry</code> → paste this URL:
              </p>
              <CopyBox value={`${APP_URL}/api/slack/commands`} />
            </div>

            {/* Interactivity */}
            <div>
              <p className="text-white/50 text-xs font-semibold uppercase tracking-wider mb-1.5">Interactive buttons</p>
              <p className="text-white/30 text-xs mb-2">
                In your Slack app → <strong className="text-white/40">Interactivity & Shortcuts</strong> → toggle ON → paste this URL:
              </p>
              <CopyBox value={`${APP_URL}/api/slack/interactions`} />
            </div>
          </div>

          <div className="flex items-center justify-between mt-8">
            <button onClick={() => setStep(2)} className="text-xs text-white/30 hover:text-white/50 transition-colors">← Back</button>
            <button onClick={saveChannelAndNext} disabled={busy}
              className="bg-white text-black text-sm font-semibold px-5 py-2.5 rounded-xl hover:bg-white/90 disabled:opacity-40 transition-opacity flex items-center gap-2">
              {busy && <Loader2 size={13} className="animate-spin" />}
              {busy ? "Saving…" : <>Continue <ArrowRight size={14} /></>}
            </button>
          </div>
        </div>
      )}

      {/* ── Step 4: Done ── */}
      {step === 4 && (
        <div className="w-full max-w-sm bg-[#1a1a24] border border-white/10 rounded-2xl p-8 text-center">
          <div className="w-14 h-14 rounded-2xl bg-white/5 flex items-center justify-center mx-auto mb-5">
            <span className="text-3xl">🎉</span>
          </div>
          <h1 className="text-white text-2xl font-bold mb-2">You're all set</h1>
          <p className="text-white/40 text-sm mb-8 leading-relaxed">
            Memry is now watching your tools. Every decision, blocker, and open question will be captured automatically.
          </p>

          {connectedCount > 0 && (
            <div className="flex flex-wrap justify-center gap-2 mb-8">
              {TOOLS.filter(t => status?.[t.id]).map(t => (
                <span key={t.id} className="inline-flex items-center gap-1.5 text-xs text-white/50 bg-white/5 border border-white/10 rounded-full px-3 py-1">
                  {t.emoji} {t.label}
                </span>
              ))}
            </div>
          )}

          <button onClick={() => router.push("/decisions")}
            className="w-full bg-white text-black font-semibold text-sm py-3 rounded-xl hover:bg-white/90 transition-opacity flex items-center justify-center gap-2">
            Open Memry <ArrowRight size={14} />
          </button>

          {connectedCount === 0 && (
            <button onClick={() => setStep(2)} className="mt-4 text-xs text-white/25 hover:text-white/40 transition-colors">
              Connect tools first →
            </button>
          )}
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-emerald-500 text-white text-sm font-medium px-4 py-2.5 rounded-lg shadow-xl whitespace-nowrap">
          ✓ {toast}
        </div>
      )}
    </div>
  );
}

export default function OnboardingPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-[#0f0f13] flex items-center justify-center">
        <Loader2 size={20} className="text-white/20 animate-spin" />
      </div>
    }>
      <OnboardingContent />
    </Suspense>
  );
}
