"use client";

import { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import {
  CheckCircle2, XCircle, AlertCircle, Clock, Loader2,
  RefreshCw, Unplug, ExternalLink,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

type WebhookStatus = "healthy" | "stale" | "waiting";

interface SlackStatus   { connected: boolean; team_name: string | null; connected_at: string | null; webhook: WebhookStatus }
interface FigmaStatus   { connected: boolean; team_id: string | null; connected_at: string | null; webhook: WebhookStatus }
interface JiraStatus    { connected: boolean; cloud_id: string | null; connected_at: string | null; webhook: WebhookStatus }
interface NotionStatus  { connected: boolean; connected_at: string | null; webhook: WebhookStatus }

interface Settings {
  workspace_id: string;
  workspace_name: string;
  slack:  SlackStatus;
  figma:  FigmaStatus;
  jira:   JiraStatus;
  notion: NotionStatus;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function WebhookBadge({ status, connected }: { status: WebhookStatus; connected: boolean }) {
  if (!connected) return null;
  if (status === "healthy") {
    return (
      <span className="inline-flex items-center gap-1 text-green text-xs">
        <span className="w-1.5 h-1.5 rounded-full bg-green inline-block" />
        Webhooks active
      </span>
    );
  }
  if (status === "waiting") {
    return (
      <span className="inline-flex items-center gap-1 text-text-3 text-xs">
        <span className="w-1.5 h-1.5 rounded-full bg-text-3 inline-block" />
        Awaiting first event
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-amber text-xs">
      <span className="w-1.5 h-1.5 rounded-full bg-amber inline-block" />
      No webhook in 6h
    </span>
  );
}

function ConnectedBadge({ connected }: { connected: boolean }) {
  return connected ? (
    <span className="inline-flex items-center gap-1.5 text-green text-xs font-medium bg-green-soft px-2 py-0.5 rounded-full">
      <CheckCircle2 size={11} /> Connected
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 text-text-3 text-xs bg-border-2 px-2 py-0.5 rounded-full">
      <XCircle size={11} /> Not connected
    </span>
  );
}

function ToolIcon({ tool }: { tool: "slack" | "figma" | "jira" | "notion" }) {
  const base = "w-10 h-10 rounded-xl flex items-center justify-center shrink-0";
  switch (tool) {
    case "slack":
      return (
        <div className={`${base} bg-[#4A154B]`}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zM15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z" fill="white"/>
          </svg>
        </div>
      );
    case "figma":
      return (
        <div className={`${base} bg-[#1E1E1E]`}>
          <svg width="20" height="24" viewBox="0 0 38 57" fill="none">
            <path d="M19 28.5A9.5 9.5 0 0 1 28.5 19a9.5 9.5 0 0 1 0 19A9.5 9.5 0 0 1 19 28.5z" fill="#1ABCFE"/>
            <path d="M0 47.5A9.5 9.5 0 0 1 9.5 38H19v9.5a9.5 9.5 0 0 1-19 0z" fill="#0ACF83"/>
            <path d="M19 0v19h9.5a9.5 9.5 0 0 0 0-19H19z" fill="#FF7262"/>
            <path d="M0 9.5A9.5 9.5 0 0 0 9.5 19H19V0H9.5A9.5 9.5 0 0 0 0 9.5z" fill="#F24E1E"/>
            <path d="M0 28.5A9.5 9.5 0 0 0 9.5 38H19V19H9.5A9.5 9.5 0 0 0 0 28.5z" fill="#FF7262"/>
          </svg>
        </div>
      );
    case "jira":
      return (
        <div className={`${base} bg-[#0052CC]`}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path d="M11.975 0C11.228 0 6.196 5.947 6.196 5.947L0 12.143l5.974 5.97C8.478 20.617 9.73 22 12 22c4.432 0 8.025-3.588 8.025-8.025V8.025C20.025 3.592 16.407 0 11.975 0z" fill="white" opacity="0.4"/>
            <path d="M12.025 2c4.432 0 8.025 3.588 8.025 8.02v5.96C20.05 20.412 16.457 24 12.025 24c-2.27 0-3.522-1.383-6.026-3.887L0 14.143 6.22 7.923C6.22 7.923 11.278 2 12.025 2z" fill="white"/>
          </svg>
        </div>
      );
    case "notion":
      return (
        <div className={`${base} bg-[#191919]`}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <path d="M4.459 4.208c.746.606 1.026.56 2.428.466l13.215-.793c.28 0 .047-.28-.046-.326L17.86 1.968c-.42-.326-.981-.7-2.055-.607L3.01 2.295c-.466.046-.56.28-.374.466l1.823 1.447zm.793 3.08V19.64c0 .7.373 .98 1.167.933l14.146-.84c.793-.046.886-.56.886-1.167V5.354c0-.607-.233-.934-.747-.887l-14.799.84c-.56.047-.653.327-.653.98zm13.86.42c.093.42 0 .84-.42.886l-.7.14v10.264c-.607.326-1.167.513-1.634.513-.746 0-.933-.233-1.493-.933l-4.577-7.196v6.96l1.447.327s0 .84-1.167.84l-3.222.186c-.093-.186 0-.653.327-.746l.84-.233V9.854L7.1 9.76c-.094-.42.139-1.026.793-1.073l3.456-.233 4.764 7.29V9.1l-1.214-.14c-.094-.514.28-.887.747-.933l3.266-.42z" fill="white"/>
          </svg>
        </div>
      );
  }
}

// ── Figma connect form (inline, PAT-based) ────────────────────────────────────

function FigmaConnectForm({ onSuccess }: { onSuccess: () => void }) {
  const [pat, setPat] = useState("");
  const [teamId, setTeamId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function connect() {
    if (!pat.trim() || !teamId.trim()) {
      setError("Both fields are required");
      return;
    }
    setLoading(true);
    setError("");
    const res = await fetch("/api/integrations/figma/connect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pat: pat.trim(), team_id: teamId.trim() }),
    });
    const data = await res.json() as { error?: string };
    setLoading(false);
    if (!res.ok) { setError(data.error ?? "Failed to connect"); return; }
    onSuccess();
  }

  return (
    <div className="mt-4 space-y-2.5">
      <div>
        <label className="block text-xs text-text-3 mb-1">Personal Access Token</label>
        <input
          type="password"
          value={pat}
          onChange={e => setPat(e.target.value)}
          placeholder="figd_…"
          className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-text placeholder:text-text-3 outline-none focus:border-accent-border transition-colors"
        />
      </div>
      <div>
        <label className="block text-xs text-text-3 mb-1">Team ID</label>
        <input
          type="text"
          value={teamId}
          onChange={e => setTeamId(e.target.value)}
          placeholder="123456789"
          className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-text placeholder:text-text-3 outline-none focus:border-accent-border transition-colors"
        />
        <p className="text-2xs text-text-3 mt-1">
          Find it in Figma → Team URL: figma.com/files/team/<strong>TEAM_ID</strong>
        </p>
      </div>
      {error && (
        <p className="flex items-center gap-1.5 text-xs text-red">
          <AlertCircle size={12} /> {error}
        </p>
      )}
      <button
        onClick={connect}
        disabled={loading}
        className="w-full flex items-center justify-center gap-2 bg-accent text-accent-ink text-sm font-medium py-2 rounded-lg hover:opacity-90 disabled:opacity-50 transition-opacity"
      >
        {loading && <Loader2 size={13} className="animate-spin" />}
        {loading ? "Verifying…" : "Connect Figma"}
      </button>
    </div>
  );
}

// ── Integration card ──────────────────────────────────────────────────────────

interface CardProps {
  tool:        "slack" | "figma" | "jira" | "notion";
  name:        string;
  description: string;
  connected:   boolean;
  connectedAt: string | null;
  meta:        string | null;
  webhook:     WebhookStatus;
  onConnect:   () => void;
  onDisconnect: () => Promise<void>;
  connectHref?: string;
  isOAuth:     boolean;
}

function IntegrationCard({
  tool, name, description, connected, connectedAt, meta,
  webhook, onConnect, onDisconnect, connectHref, isOAuth,
}: CardProps) {
  const [disconnecting, setDisconnecting] = useState(false);
  const [showForm, setShowForm] = useState(false);

  async function handleDisconnect() {
    setDisconnecting(true);
    await onDisconnect();
    setDisconnecting(false);
  }

  return (
    <div className="bg-surface border border-border rounded-xl p-5 flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <ToolIcon tool={tool} />
          <div>
            <p className="text-sm font-semibold text-text">{name}</p>
            {tool === "figma" && (
              <span className="text-2xs text-amber bg-amber-soft px-1.5 py-0.5 rounded-full font-medium">
                OAuth under review
              </span>
            )}
          </div>
        </div>
        <ConnectedBadge connected={connected} />
      </div>

      {/* Description */}
      <p className="text-xs text-text-2 leading-relaxed">{description}</p>

      {/* Connected state */}
      {connected && (
        <div className="space-y-1.5 border-t border-border-2 pt-3">
          {meta && <p className="text-xs text-text-3">{meta}</p>}
          <p className="text-xs text-text-3">Connected {fmt(connectedAt)}</p>
          <WebhookBadge status={webhook} connected={connected} />
        </div>
      )}

      {/* Actions */}
      <div className="mt-auto">
        {connected ? (
          <button
            onClick={handleDisconnect}
            disabled={disconnecting}
            className="flex items-center gap-1.5 text-xs text-text-3 hover:text-red transition-colors disabled:opacity-50"
          >
            {disconnecting
              ? <Loader2 size={12} className="animate-spin" />
              : <Unplug size={12} />}
            {disconnecting ? "Disconnecting…" : "Disconnect"}
          </button>
        ) : isOAuth ? (
          <a
            href={connectHref}
            className="inline-flex items-center gap-1.5 bg-accent text-accent-ink text-sm font-medium px-4 py-2 rounded-lg hover:opacity-90 transition-opacity"
          >
            Connect {name}
            <ExternalLink size={12} />
          </a>
        ) : (
          <>
            {!showForm ? (
              <button
                onClick={() => setShowForm(true)}
                className="inline-flex items-center gap-1.5 bg-accent text-accent-ink text-sm font-medium px-4 py-2 rounded-lg hover:opacity-90 transition-opacity"
              >
                Connect {name}
              </button>
            ) : (
              <FigmaConnectForm onSuccess={onConnect} />
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function IntegrationsPage() {
  const searchParams = useSearchParams();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<string | null>(null);

  const fetchSettings = useCallback(async () => {
    const res = await fetch("/api/integrations/settings");
    if (res.ok) setSettings(await res.json() as Settings);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  // Show toast on OAuth redirect-back
  useEffect(() => {
    const connected = searchParams.get("connected");
    const error     = searchParams.get("error");
    if (connected) {
      setToast(`${connected.charAt(0).toUpperCase() + connected.slice(1)} connected successfully`);
      setTimeout(() => setToast(null), 4000);
    } else if (error) {
      setToast(`Connection failed — ${error.replace(/_/g, " ")}`);
      setTimeout(() => setToast(null), 4000);
    }
  }, [searchParams]);

  async function disconnect(endpoint: string) {
    await fetch(endpoint, { method: "POST" });
    await fetchSettings();
  }

  const s = settings;

  return (
    <div className="max-w-3xl mx-auto px-6 py-10">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-xl font-semibold text-text mb-1">Integrations</h1>
        <p className="text-sm text-text-2">
          Connect your tools. Every decision made in these tools gets captured in Memry automatically.
        </p>
      </div>

      {/* Cards grid */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {[0,1,2,3].map(i => (
            <div key={i} className="bg-surface border border-border rounded-xl p-5 h-52 skeleton" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <IntegrationCard
            tool="slack"
            name="Slack"
            description="Capture decisions from Slack channels and threads. Every message is classified automatically — decisions, blockers, and open questions are surfaced in real time."
            connected={s?.slack.connected ?? false}
            connectedAt={s?.slack.connected_at ?? null}
            meta={s?.slack.team_name ? `Team: ${s.slack.team_name}` : null}
            webhook={s?.slack.webhook ?? "waiting"}
            isOAuth={true}
            connectHref="/api/integrations/slack/oauth"
            onConnect={fetchSettings}
            onDisconnect={() => disconnect("/api/integrations/slack/disconnect")}
          />

          <IntegrationCard
            tool="figma"
            name="Figma"
            description="Sync comments from every Figma file your team works on. When a thread is resolved, Memry captures what was decided and posts a summary to Slack automatically."
            connected={s?.figma.connected ?? false}
            connectedAt={s?.figma.connected_at ?? null}
            meta={s?.figma.team_id ? `Team: ${s.figma.team_id}` : null}
            webhook={s?.figma.webhook ?? "waiting"}
            isOAuth={false}
            onConnect={fetchSettings}
            onDisconnect={() => disconnect("/api/integrations/figma/connect")}
          />

          <IntegrationCard
            tool="jira"
            name="Jira"
            description="Pull comments, decisions, and status changes from Jira issues. When an issue comment thread concludes, the decision and context are captured automatically."
            connected={s?.jira.connected ?? false}
            connectedAt={s?.jira.connected_at ?? null}
            meta={s?.jira.cloud_id ? `Cloud: ${s.jira.cloud_id}` : null}
            webhook={s?.jira.webhook ?? "waiting"}
            isOAuth={true}
            connectHref="/api/integrations/jira/oauth"
            onConnect={fetchSettings}
            onDisconnect={() => disconnect("/api/integrations/jira/disconnect")}
          />

          <IntegrationCard
            tool="notion"
            name="Notion"
            description="Track comments and discussions in Notion pages and databases. Page updates and resolved comment threads flow into Memry with full context preserved."
            connected={s?.notion.connected ?? false}
            connectedAt={s?.notion.connected_at ?? null}
            meta={null}
            webhook={s?.notion.webhook ?? "waiting"}
            isOAuth={true}
            connectHref="/api/integrations/notion/oauth"
            onConnect={fetchSettings}
            onDisconnect={() => disconnect("/api/integrations/notion/disconnect")}
          />
        </div>
      )}

      {/* Status summary */}
      {!loading && s && (
        <div className="mt-8 flex items-center justify-between text-xs text-text-3">
          <span>
            {[s.slack.connected, s.figma.connected, s.jira.connected, s.notion.connected].filter(Boolean).length} of 4 tools connected
          </span>
          <button
            onClick={fetchSettings}
            className="flex items-center gap-1 hover:text-text transition-colors"
          >
            <RefreshCw size={11} /> Refresh
          </button>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 px-4 py-2.5 rounded-lg text-sm font-medium shadow-2 fade-in ${
          toast.includes("failed") ? "bg-red text-white" : "bg-accent text-accent-ink"
        }`}>
          {toast}
        </div>
      )}
    </div>
  );
}
