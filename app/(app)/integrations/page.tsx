"use client";
import { useState, useEffect } from "react";
import { CheckCircle2, Clock, RefreshCw, Loader2, Save } from "lucide-react";

function FigmaLogo() {
  return (
    <svg width="20" height="26" viewBox="0 0 38 57" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M19 28.5C19 23.8 22.8 20 27.5 20C32.2 20 36 23.8 36 28.5C36 33.2 32.2 37 27.5 37C22.8 37 19 33.2 19 28.5Z" fill="#1ABCFE"/>
      <path d="M2 46C2 41.3 5.8 37.5 10.5 37.5H19V46C19 50.7 15.2 54.5 10.5 54.5C5.8 54.5 2 50.7 2 46Z" fill="#0ACF83"/>
      <path d="M19 2V20H27.5C32.2 20 36 16.2 36 11.5C36 6.8 32.2 3 27.5 3H19V2Z" fill="#FF7262"/>
      <path d="M2 11.5C2 16.2 5.8 20 10.5 20H19V3H10.5C5.8 3 2 6.8 2 11.5Z" fill="#F24E1E"/>
      <path d="M2 28.5C2 33.2 5.8 37 10.5 37H19V20H10.5C5.8 20 2 23.8 2 28.5Z" fill="#FF7262"/>
    </svg>
  );
}

function SlackLogo() {
  return (
    <svg width="22" height="22" viewBox="0 0 122.8 122.8" xmlns="http://www.w3.org/2000/svg">
      <path d="M25.8 77.6c0 7.1-5.8 12.9-12.9 12.9S0 84.7 0 77.6s5.8-12.9 12.9-12.9h12.9v12.9zm6.5 0c0-7.1 5.8-12.9 12.9-12.9s12.9 5.8 12.9 12.9v32.3c0 7.1-5.8 12.9-12.9 12.9s-12.9-5.8-12.9-12.9V77.6z" fill="#e01e5a"/>
      <path d="M45.2 25.8c-7.1 0-12.9-5.8-12.9-12.9S38.1 0 45.2 0s12.9 5.8 12.9 12.9v12.9H45.2zm0 6.5c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9H12.9C5.8 58.1 0 52.3 0 45.2s5.8-12.9 12.9-12.9h32.3z" fill="#36c5f0"/>
      <path d="M97 45.2c0-7.1 5.8-12.9 12.9-12.9s12.9 5.8 12.9 12.9-5.8 12.9-12.9 12.9H97V45.2zm-6.5 0c0 7.1-5.8 12.9-12.9 12.9s-12.9-5.8-12.9-12.9V12.9C64.7 5.8 70.5 0 77.6 0s12.9 5.8 12.9 12.9v32.3z" fill="#2eb67d"/>
      <path d="M77.6 97c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9-12.9-5.8-12.9-12.9V97h12.9zm0-6.5c-7.1 0-12.9-5.8-12.9-12.9s5.8-12.9 12.9-12.9h32.3c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9H77.6z" fill="#ecb22e"/>
    </svg>
  );
}

interface FigmaSettings {
  figma_team_id: string;
  figma_pat: string;
  figma_user_id: string;
}

export default function IntegrationsPage() {
  // Figma team settings
  const [figma, setFigma] = useState<FigmaSettings>({ figma_team_id: "", figma_pat: "", figma_user_id: "" });
  const [figmaSaving, setFigmaSaving] = useState(false);
  const [figmaMsg, setFigmaMsg] = useState<string | null>(null);
  const [figmaConnected, setFigmaConnected] = useState(false);

  // Figma sync
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [lastSynced, setLastSynced] = useState<string | null>(null);

  // Slack Bot
  const [slackBotToken, setSlackBotToken] = useState("");
  const [slackChannelId, setSlackChannelId] = useState("");
  const [slackSigningSecret, setSlackSigningSecret] = useState("");
  const [slackSaving, setSlackSaving] = useState(false);
  const [slackMsg, setSlackMsg] = useState<string | null>(null);
  const [slackConnected, setSlackConnected] = useState(false);

  useEffect(() => {
    fetch("/api/integrations/settings")
      .then(r => r.json())
      .then((d: Record<string, unknown>) => {
        if (d.figma_team_id) {
          setFigma({
            figma_team_id: d.figma_team_id as string,
            figma_pat: d.figma_pat as string ?? "",
            figma_user_id: d.figma_user_id as string ?? "",
          });
          setFigmaConnected(true);
        }
        if (d.slack_bot_token) {
          setSlackConnected(true);
        }
        if (d.slack_channel_id) setSlackChannelId(d.slack_channel_id as string);
        if (d.last_synced_at) setLastSynced(d.last_synced_at as string);
      })
      .catch(() => null);
  }, []);

  async function saveFigmaSettings() {
    if (!figma.figma_team_id.trim() || !figma.figma_pat.trim()) return;
    setFigmaSaving(true);
    setFigmaMsg(null);
    const res = await fetch("/api/integrations/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(figma),
    });
    const data = await res.json() as { ok?: boolean; error?: string };
    if (data.ok) {
      setFigmaConnected(true);
      setFigmaMsg("✓ Figma settings saved");
    } else {
      setFigmaMsg(data.error ?? "Failed to save");
    }
    setFigmaSaving(false);
  }

  async function handleSync() {
    setSyncing(true);
    setSyncMsg(null);
    try {
      const res = await fetch("/api/figma/pull", { method: "POST" });
      const data = await res.json() as { ok?: boolean; totalAdded?: number; files?: { fileName: string; added: number; error?: string }[]; error?: string };
      if (data.error) {
        setSyncMsg(`⚠ ${data.error}`);
      } else {
        const fileCount = data.files?.length ?? 0;
        const added = data.totalAdded ?? 0;
        setSyncMsg(`✓ Synced ${fileCount} file${fileCount !== 1 ? "s" : ""} — ${added} new comment${added !== 1 ? "s" : ""}`);
        setLastSynced(new Date().toISOString());
      }
    } catch {
      setSyncMsg("Sync failed — check your Team ID and PAT");
    } finally {
      setSyncing(false);
    }
  }

  async function saveSlackBot() {
    if (!slackBotToken.trim() || !slackChannelId.trim()) return;
    setSlackSaving(true); setSlackMsg(null);
    const res = await fetch("/api/integrations/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        slack_bot_token: slackBotToken.trim(),
        slack_channel_id: slackChannelId.trim(),
        ...(slackSigningSecret.trim() ? { slack_signing_secret: slackSigningSecret.trim() } : {}),
      }),
    });
    const data = await res.json() as { ok?: boolean; error?: string };
    if (data.ok) {
      setSlackConnected(true);
      setSlackMsg("✓ Slack bot connected — decisions will post to your channel");
      setSlackBotToken(""); // clear for security
      setSlackSigningSecret("");
    } else {
      setSlackMsg(data.error ?? "Failed to save");
    }
    setSlackSaving(false);
  }

  const relativeTime = (iso: string) => {
    const diff = Date.now() - new Date(iso).getTime();
    if (diff < 60000) return "just now";
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return `${Math.floor(diff / 86400000)}d ago`;
  };

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-[#f5f5f7]">
      <div className="px-8 pt-7 pb-5">
        <h1 className="text-gray-900 text-2xl font-bold tracking-tight mb-0.5">Integrations</h1>
        <p className="text-gray-400 text-sm">Connect your tools to keep everything in sync</p>
      </div>

      <div className="flex-1 overflow-y-auto px-8 pb-8">
        <div className="grid grid-cols-1 gap-4 max-w-2xl">

          {/* ── Figma ── */}
          <div className="bg-white rounded-2xl border border-gray-100 p-6 shadow-sm">
            <div className="flex items-start justify-between gap-4 mb-5">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-xl bg-gray-50 border border-gray-100 flex items-center justify-center flex-shrink-0">
                  <FigmaLogo />
                </div>
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="text-gray-900 text-base font-bold">Figma</h3>
                    {figmaConnected ? (
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">
                        <CheckCircle2 size={10} /> Connected
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
                        Not configured
                      </span>
                    )}
                  </div>
                  <p className="text-gray-500 text-sm leading-relaxed">
                    Auto-discovers all files in your Figma team and syncs comments continuously.
                  </p>
                  {lastSynced && (
                    <p className="text-gray-400 text-xs mt-1">Last synced {relativeTime(lastSynced)}</p>
                  )}
                </div>
              </div>
              {figmaConnected && (
                <button
                  onClick={handleSync}
                  disabled={syncing}
                  className="flex items-center gap-1.5 text-sm font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 disabled:opacity-50 px-3 py-2 rounded-xl transition-colors flex-shrink-0"
                >
                  {syncing ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                  {syncing ? "Syncing…" : "Sync now"}
                </button>
              )}
            </div>

            {syncMsg && (
              <p className={`text-xs mb-4 ${syncMsg.startsWith("✓") ? "text-emerald-500" : "text-amber-500"}`}>
                {syncMsg}
              </p>
            )}

            <div className="space-y-3 border-t border-gray-100 pt-5">
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1.5">
                  Personal Access Token (PAT)
                </label>
                <input
                  type="password"
                  value={figma.figma_pat}
                  onChange={e => setFigma(f => ({ ...f, figma_pat: e.target.value }))}
                  placeholder="figd_…"
                  className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-gray-700 text-sm placeholder:text-gray-300 outline-none focus:border-gray-400 transition-colors"
                />
                <p className="text-gray-300 text-xs mt-1">
                  Figma → Settings → Security → Personal access tokens. Scopes: files:read, file_comments:read
                </p>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1.5">
                  Team ID
                </label>
                <input
                  type="text"
                  value={figma.figma_team_id}
                  onChange={e => setFigma(f => ({ ...f, figma_team_id: e.target.value }))}
                  placeholder="1234567890"
                  className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-gray-700 text-sm placeholder:text-gray-300 outline-none focus:border-gray-400 transition-colors"
                />
                <p className="text-gray-300 text-xs mt-1">
                  From your Figma team URL: figma.com/files/team/<span className="text-gray-400">TEAM_ID</span>/…
                </p>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1.5">
                  Your Figma User ID <span className="text-gray-300 font-normal">(optional — for @mention detection)</span>
                </label>
                <input
                  type="text"
                  value={figma.figma_user_id}
                  onChange={e => setFigma(f => ({ ...f, figma_user_id: e.target.value }))}
                  placeholder="976750381837408411"
                  className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-gray-700 text-sm placeholder:text-gray-300 outline-none focus:border-gray-400 transition-colors"
                />
                <p className="text-gray-300 text-xs mt-1">
                  Found at figma.com/api/v1/me → id field
                </p>
              </div>

              <div className="flex items-center gap-3 pt-1">
                <button
                  onClick={saveFigmaSettings}
                  disabled={figmaSaving || !figma.figma_team_id.trim() || !figma.figma_pat.trim()}
                  className="flex items-center gap-1.5 bg-gray-900 hover:bg-black disabled:opacity-40 text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition-colors"
                >
                  {figmaSaving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                  Save settings
                </button>
                {figmaMsg && (
                  <p className={`text-xs ${figmaMsg.startsWith("✓") ? "text-emerald-500" : "text-red-400"}`}>
                    {figmaMsg}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* ── Slack ── */}
          <div className="bg-white rounded-2xl border border-gray-100 p-6 shadow-sm">
            <div className="flex items-start gap-4 mb-5">
              <div className="w-12 h-12 rounded-xl bg-gray-50 border border-gray-100 flex items-center justify-center flex-shrink-0">
                <SlackLogo />
              </div>
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="text-gray-900 text-base font-bold">Slack</h3>
                  {slackConnected ? (
                    <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">
                      <CheckCircle2 size={10} /> Connected
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-[10px] font-bold text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
                      <Clock size={10} /> Not connected
                    </span>
                  )}
                </div>
                <p className="text-gray-500 text-sm leading-relaxed">
                  Post design decisions to a dedicated Slack channel. Approve, request changes, or ask for clarification — directly from Slack.
                </p>
              </div>
            </div>

            <div className="space-y-3 border-t border-gray-100 pt-5">
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1.5">
                  Bot Token
                </label>
                <input
                  type="password"
                  value={slackBotToken}
                  onChange={e => { setSlackBotToken(e.target.value); setSlackMsg(null); }}
                  placeholder={slackConnected ? "••••••••••••••• (already saved)" : "xoxb-…"}
                  className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-gray-700 text-sm placeholder:text-gray-300 outline-none focus:border-gray-400 transition-colors"
                />
                <p className="text-gray-300 text-xs mt-1">
                  Slack app → OAuth & Permissions → Bot User OAuth Token
                </p>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1.5">
                  Channel ID
                </label>
                <input
                  type="text"
                  value={slackChannelId}
                  onChange={e => { setSlackChannelId(e.target.value); setSlackMsg(null); }}
                  placeholder="C0123ABCDEF"
                  className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-gray-700 text-sm placeholder:text-gray-300 outline-none focus:border-gray-400 transition-colors"
                />
                <p className="text-gray-300 text-xs mt-1">
                  Right-click your channel in Slack → Copy link → last segment is the ID
                </p>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1.5">
                  Signing Secret <span className="text-gray-300 font-normal">(for verifying button clicks)</span>
                </label>
                <input
                  type="password"
                  value={slackSigningSecret}
                  onChange={e => { setSlackSigningSecret(e.target.value); setSlackMsg(null); }}
                  placeholder={slackConnected ? "••••••••••••••• (already saved)" : "abc123…"}
                  className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-gray-700 text-sm placeholder:text-gray-300 outline-none focus:border-gray-400 transition-colors"
                />
                <p className="text-gray-300 text-xs mt-1">
                  Slack app → Basic Information → App Credentials → Signing Secret
                </p>
              </div>

              <div className="flex items-center gap-3 pt-1">
                <button
                  onClick={saveSlackBot}
                  disabled={slackSaving || (!slackBotToken.trim() && !slackConnected) || !slackChannelId.trim()}
                  className="flex items-center gap-1.5 bg-gray-900 hover:bg-black disabled:opacity-40 text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition-colors"
                >
                  {slackSaving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                  {slackConnected ? "Update" : "Connect Slack"}
                </button>
                {slackMsg && (
                  <p className={`text-xs ${slackMsg.startsWith("✓") ? "text-emerald-500" : "text-red-400"}`}>
                    {slackMsg}
                  </p>
                )}
              </div>

              {!slackConnected && (
                <div className="bg-gray-50 rounded-xl p-4 mt-1">
                  <p className="text-xs font-semibold text-gray-500 mb-2">Setup checklist</p>
                  <ol className="text-xs text-gray-400 space-y-1 list-decimal list-inside">
                    <li>Create a Slack app at <span className="text-gray-500 font-medium">api.slack.com/apps</span></li>
                    <li>Add <span className="font-mono bg-gray-100 px-1 rounded">chat:write</span> bot scope under OAuth & Permissions</li>
                    <li>Enable Interactivity, set Request URL to <span className="font-mono bg-gray-100 px-1 rounded text-[10px]">https://memry-team-opal.vercel.app/api/slack/interactive</span></li>
                    <li>Install app to your workspace and invite bot to the channel</li>
                  </ol>
                </div>
              )}
            </div>
          </div>

          {/* ── Coming soon ── */}
          {[
            { name: "Jira", desc: "Automatically create Jira tickets from flagged feedback items." },
            { name: "Notion", desc: "Export decisions and summaries to a Notion database." },
          ].map(item => (
            <div key={item.name} className="bg-white rounded-2xl border border-gray-100 p-6 shadow-sm opacity-60">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="text-gray-900 text-base font-bold">{item.name}</h3>
                    <span className="inline-flex items-center gap-1 text-[10px] font-bold text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
                      <Clock size={10} /> Coming soon
                    </span>
                  </div>
                  <p className="text-gray-500 text-sm">{item.desc}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
