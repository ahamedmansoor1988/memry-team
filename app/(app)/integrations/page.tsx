"use client";
import { useState, useEffect, useCallback } from "react";
import { CheckCircle2, Clock, RefreshCw, Loader2, Save, AlertTriangle, Copy, Check } from "lucide-react";

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

interface PreviewMetrics {
  total: number;
  ready: number;
  pending: number;
  generating: number;
  failed: number;
  stale: number;
  errorBreakdown: Partial<Record<string, number>>;
  nextRetryAt: string | null;
}

const ERROR_LABELS: Record<string, string> = {
  rate_limited:      "Rate Limited",
  node_missing:      "Node Missing",
  permission_denied: "Permission Denied",
  images_api_error:  "Images API Error",
  unknown:           "Unknown Error",
};

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

  // Preview enrichment
  const [enriching, setEnriching] = useState(false);
  const [enrichMsg, setEnrichMsg] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<PreviewMetrics | null>(null);
  const [metricsLoading, setMetricsLoading] = useState(false);

  // Slack Bot
  const [slackBotToken, setSlackBotToken] = useState("");
  const [slackChannelId, setSlackChannelId] = useState("");
  const [slackSigningSecret, setSlackSigningSecret] = useState("");
  const [slackSaving, setSlackSaving] = useState(false);
  const [slackMsg, setSlackMsg] = useState<string | null>(null);
  const [slackConnected, setSlackConnected] = useState(false);
  const [eventsUrlCopied, setEventsUrlCopied] = useState(false);

  const loadMetrics = useCallback(() => {
    setMetricsLoading(true);
    fetch("/api/figma/preview-metrics")
      .then(r => r.json())
      .then((d: PreviewMetrics) => { setMetrics(d); })
      .catch(() => null)
      .finally(() => setMetricsLoading(false));
  }, []);

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
          loadMetrics();
        }
        if (d.slack_bot_token) {
          setSlackConnected(true);
        }
        if (d.slack_channel_id) setSlackChannelId(d.slack_channel_id as string);
        if (d.last_synced_at) setLastSynced(d.last_synced_at as string);
      })
      .catch(() => null);
  }, [loadMetrics]);

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

  async function handleEnrichPreviews() {
    setEnriching(true);
    setEnrichMsg(null);
    try {
      const res = await fetch("/api/figma/enrich-previews", { method: "POST" });
      const data = await res.json() as {
        ok?: boolean; enriched?: number; failed?: number; processed?: number;
        message?: string; error?: string; retryAfterHours?: number; metrics?: PreviewMetrics;
      };
      if (data.metrics) setMetrics(data.metrics);
      if (data.error) {
        setEnrichMsg(`⚠ ${data.error}`);
      } else if (data.retryAfterHours) {
        setEnrichMsg(`⚠ Rate limited — retry in ~${data.retryAfterHours}h`);
      } else if (data.message) {
        setEnrichMsg(`✓ ${data.message}`);
      } else {
        setEnrichMsg(`✓ ${data.enriched ?? 0} preview${(data.enriched ?? 0) !== 1 ? "s" : ""} generated, ${data.failed ?? 0} failed`);
      }
    } catch {
      setEnrichMsg("Failed — check your PAT and try again");
    } finally {
      setEnriching(false);
    }
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
    <div className="flex flex-col h-screen overflow-hidden bg-[var(--bg)]">
      <div className="px-8 pt-7 pb-5">
        <h1 className="text-[var(--text)] text-xl font-semibold tracking-tight mb-0.5">Integrations</h1>
        <p className="text-[var(--text-2)] text-sm">Connect your tools — Memry watches them so you don't have to.</p>
      </div>

      <div className="flex-1 overflow-y-auto px-8 pb-8">
        <div className="grid grid-cols-1 gap-4 max-w-2xl">

          {/* ── Figma ── */}
          <div className="bg-[var(--surface)] rounded-xl border border-[var(--border)] p-6 shadow-1">
            <div className="flex items-start justify-between gap-4 mb-5">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-xl bg-[var(--bg)] border border-[var(--border-2)] flex items-center justify-center flex-shrink-0">
                  <FigmaLogo />
                </div>
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="text-[var(--text)] text-base font-semibold">Figma</h3>
                    {figmaConnected ? (
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-[var(--green)] bg-[var(--green-soft)] px-2 py-0.5 rounded-full">
                        <CheckCircle2 size={10} /> Connected
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-[var(--text-3)] bg-[var(--border-2)] px-2 py-0.5 rounded-full">
                        Not configured
                      </span>
                    )}
                  </div>
                  <p className="text-[var(--text-2)] text-sm leading-relaxed">
                    Auto-discovers all files in your Figma team and syncs comments continuously.
                  </p>
                  {lastSynced && (
                    <p className="text-[var(--text-3)] text-xs mt-1">Last synced {relativeTime(lastSynced)}</p>
                  )}
                </div>
              </div>
              {figmaConnected && (
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    onClick={handleSync}
                    disabled={syncing}
                    className="flex items-center gap-1.5 text-sm font-medium text-[var(--text-2)] bg-[var(--surface)] border border-[var(--border)] hover:border-[var(--accent-border)] disabled:opacity-50 px-3 py-2 rounded-lg transition-colors"
                  >
                    {syncing ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                    {syncing ? "Syncing…" : "Sync now"}
                  </button>
                  <button
                    onClick={handleEnrichPreviews}
                    disabled={enriching}
                    title="Fetch frame preview images from Figma (rate-limited: ~1/sec)"
                    className="flex items-center gap-1.5 text-sm font-medium text-[var(--text-2)] bg-[var(--surface)] border border-[var(--border)] hover:border-[var(--accent-border)] disabled:opacity-50 px-3 py-2 rounded-lg transition-colors"
                  >
                    {enriching ? <Loader2 size={13} className="animate-spin" /> : <span className="text-xs">🖼</span>}
                    {enriching ? "Fetching…" : "Get Previews"}
                  </button>
                </div>
              )}
            </div>

            {syncMsg && (
              <p className={`text-xs mb-2 ${syncMsg.startsWith("✓") ? "text-[var(--green)]" : "text-[var(--amber)]"}`}>
                {syncMsg}
              </p>
            )}
            {enrichMsg && (
              <p className={`text-xs mb-3 ${enrichMsg.startsWith("✓") ? "text-[var(--green)]" : "text-[var(--amber)]"}`}>
                {enrichMsg}
              </p>
            )}

            {/* ── Preview metrics panel ── */}
            {figmaConnected && (
              <div className="mb-5 rounded-xl border border-[var(--border-2)] bg-[var(--bg)] overflow-hidden">
                <div className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--border-2)]">
                  <span className="font-mono text-[10px] font-semibold uppercase tracking-widest text-[var(--text-3)]">Frame Previews</span>
                  <button
                    onClick={loadMetrics}
                    disabled={metricsLoading}
                    className="text-[var(--text-3)] hover:text-[var(--text-2)] transition-colors"
                    title="Refresh metrics"
                  >
                    <RefreshCw size={11} className={metricsLoading ? "animate-spin" : ""} />
                  </button>
                </div>

                {metrics ? (
                  <div className="px-4 py-3 space-y-3">
                    {/* Stat row */}
                    <div className="grid grid-cols-4 gap-2">
                      {[
                        { label: "Total",   value: metrics.total,     color: "text-[var(--text-2)]" },
                        { label: "Ready",   value: metrics.ready,     color: "text-[var(--green)]" },
                        { label: "Pending", value: metrics.pending + metrics.generating, color: "text-[var(--amber)]" },
                        { label: "Failed",  value: metrics.failed,    color: "text-[var(--red)]" },
                      ].map(stat => (
                        <div key={stat.label} className="bg-[var(--surface)] rounded-lg border border-[var(--border-2)] px-3 py-2 text-center">
                          <p className={`text-lg font-bold ${stat.color}`}>{stat.value}</p>
                          <p className="font-mono text-[9px] font-semibold uppercase tracking-wider text-[var(--text-3)] mt-0.5">{stat.label}</p>
                        </div>
                      ))}
                    </div>

                    {/* Progress bar */}
                    {metrics.total > 0 && (
                      <div className="w-full h-1.5 bg-[var(--border)] rounded-full overflow-hidden">
                        <div
                          className="h-full bg-[var(--green)] rounded-full transition-all duration-500"
                          style={{ width: `${Math.round((metrics.ready / metrics.total) * 100)}%` }}
                        />
                      </div>
                    )}

                    {/* Error breakdown — only show if there are failures */}
                    {metrics.failed > 0 && Object.keys(metrics.errorBreakdown).length > 0 && (
                      <div className="space-y-1">
                        <p className="font-mono text-[9px] font-semibold uppercase tracking-widest text-[var(--red)] flex items-center gap-1">
                          <AlertTriangle size={9} /> Failure reasons
                        </p>
                        {Object.entries(metrics.errorBreakdown).map(([reason, count]) => (
                          <div key={reason} className="flex items-center justify-between">
                            <span className="text-xs text-[var(--text-2)]">{ERROR_LABELS[reason] ?? reason}</span>
                            <span className="text-xs font-semibold text-[var(--red)]">{count}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Next retry time */}
                    {metrics.nextRetryAt && (
                      <p className="text-[10px] text-[var(--text-3)]">
                        Next auto-retry: {new Date(metrics.nextRetryAt) > new Date()
                          ? relativeTime(metrics.nextRetryAt) + " from now"
                          : "due now"}
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="px-4 py-4 flex items-center justify-center">
                    <span className="text-xs text-[var(--text-3)]">{metricsLoading ? "Loading…" : "No data"}</span>
                  </div>
                )}
              </div>
            )}

            <div className="space-y-3 border-t border-[var(--border-2)] pt-5">
              <div>
                <label className="block text-xs font-medium text-[var(--text-2)] mb-1.5">
                  Personal Access Token (PAT)
                </label>
                <input
                  type="password"
                  value={figma.figma_pat}
                  onChange={e => setFigma(f => ({ ...f, figma_pat: e.target.value }))}
                  placeholder="figd_…"
                  className="w-full bg-[var(--bg)] border border-[var(--border)] rounded-lg px-4 py-2.5 text-[var(--text)] text-sm placeholder:text-[var(--text-3)] outline-none focus:border-[var(--accent-border)] transition-colors"
                />
                <p className="text-[var(--text-3)] text-xs mt-1">
                  Figma → Settings → Security → Personal access tokens. Scopes: files:read, file_comments:read
                </p>
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--text-2)] mb-1.5">
                  Team ID
                </label>
                <input
                  type="text"
                  value={figma.figma_team_id}
                  onChange={e => setFigma(f => ({ ...f, figma_team_id: e.target.value }))}
                  placeholder="1234567890"
                  className="w-full bg-[var(--bg)] border border-[var(--border)] rounded-lg px-4 py-2.5 text-[var(--text)] text-sm placeholder:text-[var(--text-3)] outline-none focus:border-[var(--accent-border)] transition-colors"
                />
                <p className="text-[var(--text-3)] text-xs mt-1">
                  From your Figma team URL: figma.com/files/team/<span className="text-[var(--text-2)]">TEAM_ID</span>/…
                </p>
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--text-2)] mb-1.5">
                  Your Figma User ID <span className="text-[var(--text-3)] font-normal">(optional — for @mention detection)</span>
                </label>
                <input
                  type="text"
                  value={figma.figma_user_id}
                  onChange={e => setFigma(f => ({ ...f, figma_user_id: e.target.value }))}
                  placeholder="976750381837408411"
                  className="w-full bg-[var(--bg)] border border-[var(--border)] rounded-lg px-4 py-2.5 text-[var(--text)] text-sm placeholder:text-[var(--text-3)] outline-none focus:border-[var(--accent-border)] transition-colors"
                />
                <p className="text-[var(--text-3)] text-xs mt-1">
                  Found at figma.com/api/v1/me → id field
                </p>
              </div>

              <div className="flex items-center gap-3 pt-1">
                <button
                  onClick={saveFigmaSettings}
                  disabled={figmaSaving || !figma.figma_team_id.trim() || !figma.figma_pat.trim()}
                  className="flex items-center gap-1.5 bg-[var(--accent)] hover:opacity-90 disabled:opacity-40 text-[var(--accent-ink)] text-sm font-medium px-4 py-2.5 rounded-lg transition-colors"
                >
                  {figmaSaving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                  Save settings
                </button>
                {figmaMsg && (
                  <p className={`text-xs ${figmaMsg.startsWith("✓") ? "text-[var(--green)]" : "text-[var(--red)]"}`}>
                    {figmaMsg}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* ── Slack ── */}
          <div className="bg-[var(--surface)] rounded-xl border border-[var(--border)] p-6 shadow-1">
            <div className="flex items-start gap-4 mb-5">
              <div className="w-12 h-12 rounded-xl bg-[var(--bg)] border border-[var(--border-2)] flex items-center justify-center flex-shrink-0">
                <SlackLogo />
              </div>
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="text-[var(--text)] text-base font-semibold">Slack</h3>
                  {slackConnected ? (
                    <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-[var(--green)] bg-[var(--green-soft)] px-2 py-0.5 rounded-full">
                      <CheckCircle2 size={10} /> Connected
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-[var(--text-3)] bg-[var(--border-2)] px-2 py-0.5 rounded-full">
                      <Clock size={10} /> Not connected
                    </span>
                  )}
                </div>
                <p className="text-[var(--text-2)] text-sm leading-relaxed">
                  Post design decisions to a dedicated Slack channel. Approve, request changes, or ask for clarification — directly from Slack.
                </p>
              </div>
            </div>

            <div className="space-y-3 border-t border-[var(--border-2)] pt-5">
              <div>
                <label className="block text-xs font-medium text-[var(--text-2)] mb-1.5">
                  Bot Token
                </label>
                <input
                  type="password"
                  value={slackBotToken}
                  onChange={e => { setSlackBotToken(e.target.value); setSlackMsg(null); }}
                  placeholder={slackConnected ? "••••••••••••••• (already saved)" : "xoxb-…"}
                  className="w-full bg-[var(--bg)] border border-[var(--border)] rounded-lg px-4 py-2.5 text-[var(--text)] text-sm placeholder:text-[var(--text-3)] outline-none focus:border-[var(--accent-border)] transition-colors"
                />
                <p className="text-[var(--text-3)] text-xs mt-1">
                  Slack app → OAuth & Permissions → Bot User OAuth Token
                </p>
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--text-2)] mb-1.5">
                  Channel ID
                </label>
                <input
                  type="text"
                  value={slackChannelId}
                  onChange={e => { setSlackChannelId(e.target.value); setSlackMsg(null); }}
                  placeholder="C0123ABCDEF"
                  className="w-full bg-[var(--bg)] border border-[var(--border)] rounded-lg px-4 py-2.5 text-[var(--text)] text-sm placeholder:text-[var(--text-3)] outline-none focus:border-[var(--accent-border)] transition-colors"
                />
                <p className="text-[var(--text-3)] text-xs mt-1">
                  Right-click your channel in Slack → Copy link → last segment is the ID
                </p>
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--text-2)] mb-1.5">
                  Signing Secret <span className="text-[var(--text-3)] font-normal">(for verifying button clicks)</span>
                </label>
                <input
                  type="password"
                  value={slackSigningSecret}
                  onChange={e => { setSlackSigningSecret(e.target.value); setSlackMsg(null); }}
                  placeholder={slackConnected ? "••••••••••••••• (already saved)" : "abc123…"}
                  className="w-full bg-[var(--bg)] border border-[var(--border)] rounded-lg px-4 py-2.5 text-[var(--text)] text-sm placeholder:text-[var(--text-3)] outline-none focus:border-[var(--accent-border)] transition-colors"
                />
                <p className="text-[var(--text-3)] text-xs mt-1">
                  Slack app → Basic Information → App Credentials → Signing Secret
                </p>
              </div>

              <div className="flex items-center gap-3 pt-1">
                <button
                  onClick={saveSlackBot}
                  disabled={slackSaving || (!slackBotToken.trim() && !slackConnected) || !slackChannelId.trim()}
                  className="flex items-center gap-1.5 bg-[var(--accent)] hover:opacity-90 disabled:opacity-40 text-[var(--accent-ink)] text-sm font-medium px-4 py-2.5 rounded-lg transition-colors"
                >
                  {slackSaving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                  {slackConnected ? "Update" : "Connect Slack"}
                </button>
                {slackMsg && (
                  <p className={`text-xs ${slackMsg.startsWith("✓") ? "text-[var(--green)]" : "text-[var(--red)]"}`}>
                    {slackMsg}
                  </p>
                )}
              </div>

              {/* Events URL — always show for setup */}
              <div className="bg-[var(--bg)] border border-[var(--border-2)] rounded-xl p-4 mt-1 space-y-3">
                {slackConnected && (
                  <p className="text-xs text-[var(--text-2)]">
                    Memry is now listening for decisions in your Slack workspace.
                    Add the bot to any channel with <span className="font-mono bg-[var(--surface)] border border-[var(--border)] rounded px-1">/invite @Memry</span>
                  </p>
                )}

                <div>
                  <p className="text-xs font-medium text-[var(--text-2)] mb-1.5">Event Subscription URL</p>
                  <div className="flex items-center gap-2">
                    <span className="flex-1 font-mono text-xs bg-[var(--surface)] border border-[var(--border)] rounded px-2 py-1 text-[var(--text-2)] truncate">
                      {process.env.NEXT_PUBLIC_APP_URL ?? "https://memry-team-opal.vercel.app"}/api/slack/events
                    </span>
                    <button
                      onClick={() => {
                        void navigator.clipboard.writeText(
                          `${process.env.NEXT_PUBLIC_APP_URL ?? "https://memry-team-opal.vercel.app"}/api/slack/events`
                        ).then(() => {
                          setEventsUrlCopied(true);
                          setTimeout(() => setEventsUrlCopied(false), 2000);
                        });
                      }}
                      className="flex items-center gap-1 text-xs text-[var(--text-2)] hover:text-[var(--text)] bg-[var(--surface)] border border-[var(--border)] rounded px-2 py-1 flex-shrink-0 transition-colors"
                    >
                      {eventsUrlCopied ? <Check size={11} /> : <Copy size={11} />}
                      {eventsUrlCopied ? "Copied" : "Copy"}
                    </button>
                  </div>
                </div>

                <div>
                  <p className="text-xs font-medium text-[var(--text-2)] mb-1.5">Setup checklist</p>
                  <ul className="text-xs text-[var(--text-3)] space-y-1">
                    <li className="flex items-start gap-1.5">
                      <span>{slackConnected ? "☑" : "☐"}</span>
                      Bot token saved
                    </li>
                    <li className="flex items-start gap-1.5">
                      <span>☐</span>
                      Event subscription URL added in Slack app settings
                    </li>
                    <li className="flex items-start gap-1.5">
                      <span>☐</span>
                      <span><span className="font-mono bg-[var(--border-2)] px-1 rounded">message.channels</span> event enabled</span>
                    </li>
                    <li className="flex items-start gap-1.5">
                      <span>☐</span>
                      Bot invited to at least one channel
                    </li>
                  </ul>
                </div>
              </div>
            </div>
          </div>

          {/* ── Coming soon ── */}
          {[
            { name: "Jira", desc: "Automatically create Jira tickets from flagged feedback items." },
            { name: "Notion", desc: "Export decisions and summaries to a Notion database." },
          ].map(item => (
            <div key={item.name} className="bg-[var(--surface)] rounded-xl border border-[var(--border)] p-6 shadow-1 opacity-60">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="text-[var(--text)] text-base font-semibold">{item.name}</h3>
                    <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-[var(--text-3)] bg-[var(--border-2)] px-2 py-0.5 rounded-full">
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
