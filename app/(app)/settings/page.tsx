"use client";

import { useState, useEffect } from "react";
import { Loader2, CheckCircle2 } from "lucide-react";

interface WorkspaceSettings {
  id: string;
  name: string;
  slack_channel_id: string | null;
  slack_team_name:  string | null;
  slack_connected:  boolean;
}

export default function SettingsPage() {
  const [ws, setWs]           = useState<WorkspaceSettings | null>(null);
  const [channelId, setChannel] = useState("");
  const [saving, setSaving]   = useState(false);
  const [saved, setSaved]     = useState(false);
  const [error, setError]     = useState("");

  useEffect(() => {
    fetch("/api/integrations/settings")
      .then(r => r.json())
      .then((data: any) => {
        setWs({
          id:               data.workspace_id,
          name:             data.workspace_name,
          slack_channel_id: data.slack?.team_name ?? null,
          slack_team_name:  data.slack?.team_name ?? null,
          slack_connected:  data.slack?.connected ?? false,
        });
        setChannel(data.slack_channel_id ?? "");
      });
  }, []);

  async function save() {
    setSaving(true);
    setError("");
    const res = await fetch("/api/integrations/settings", {
      method:  "PATCH",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ slack_channel_id: channelId.trim() || null }),
    });
    setSaving(false);
    if (res.ok) { setSaved(true); setTimeout(() => setSaved(false), 2500); }
    else        { setError("Failed to save — try again."); }
  }

  return (
    <div className="max-w-3xl mx-auto px-6 py-10">
      <div className="mb-8">
        <h1 className="text-xl font-semibold text-text mb-1">Settings</h1>
        <p className="text-sm text-text-2">Workspace configuration and Slack channel defaults.</p>
      </div>

      <div className="space-y-4">
        {/* Workspace info */}
        <div className="bg-surface border border-border rounded-xl p-5">
          <p className="text-xs font-semibold text-text-3 uppercase tracking-wider mb-3">Workspace</p>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-text">{ws?.name ?? "—"}</p>
              {ws?.slack_team_name && (
                <p className="text-xs text-text-3 mt-0.5">Slack: {ws.slack_team_name}</p>
              )}
            </div>
          </div>
        </div>

        {/* Default Slack channel */}
        <div className="bg-surface border border-border rounded-xl p-5">
          <p className="text-xs font-semibold text-text-3 uppercase tracking-wider mb-1">Default Slack channel</p>
          <p className="text-xs text-text-3 mb-4">
            Blocker alerts, clarification requests, and summaries are posted here when no project channel is set.
            Enter the channel ID (e.g. <code className="bg-border-2 px-1 rounded">C0123456789</code>) — found in Slack → right-click channel → View channel details → bottom of About tab.
          </p>
          <div className="flex gap-2">
            <input
              value={channelId}
              onChange={e => setChannel(e.target.value)}
              placeholder="C0123456789"
              className="flex-1 bg-background border border-border rounded-lg px-3 py-2 text-sm text-text placeholder:text-text-3 outline-none focus:border-accent-border transition-colors font-mono"
            />
            <button
              onClick={save}
              disabled={saving}
              className="flex items-center gap-1.5 bg-accent text-accent-ink text-sm font-medium px-4 py-2 rounded-lg hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              {saving ? <Loader2 size={13} className="animate-spin" /> : saved ? <CheckCircle2 size={13} /> : null}
              {saving ? "Saving…" : saved ? "Saved" : "Save"}
            </button>
          </div>
          {error && <p className="text-xs text-red mt-2">{error}</p>}
        </div>

        {/* Slack commands */}
        <div className="bg-surface border border-border rounded-xl p-5">
          <p className="text-xs font-semibold text-text-3 uppercase tracking-wider mb-3">Slack slash command</p>
          <p className="text-xs text-text-2 mb-2">
            Use <code className="bg-border-2 px-1 rounded">/memry ask &lt;question&gt;</code> in any Slack channel to search captured decisions.
          </p>
          <p className="text-xs text-text-3">
            Register the slash command in your Slack app: <strong>Slash Commands</strong> → command <code className="bg-border-2 px-1 rounded">/memry</code> → request URL:
          </p>
          <code className="block mt-2 text-xs bg-border-2 px-3 py-2 rounded-lg break-all text-text-2">
            {process.env.NEXT_PUBLIC_APP_URL ?? "https://memry-team-opal.vercel.app"}/api/slack/commands
          </code>
        </div>

        {/* Interactions URL */}
        <div className="bg-surface border border-border rounded-xl p-5">
          <p className="text-xs font-semibold text-text-3 uppercase tracking-wider mb-3">Slack interactivity</p>
          <p className="text-xs text-text-3 mb-2">
            Enable interactive buttons (e.g. "Mark as clear") in your Slack app: <strong>Interactivity & Shortcuts</strong> → toggle on → request URL:
          </p>
          <code className="block text-xs bg-border-2 px-3 py-2 rounded-lg break-all text-text-2">
            {process.env.NEXT_PUBLIC_APP_URL ?? "https://memry-team-opal.vercel.app"}/api/slack/interactions
          </code>
        </div>
      </div>
    </div>
  );
}
