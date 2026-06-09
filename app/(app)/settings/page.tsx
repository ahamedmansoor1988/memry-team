"use client";
import { useState, useEffect } from "react";
import { CheckCircle, AlertCircle, Loader2, Copy, Check, Users, Link2, Bell } from "lucide-react";

function scanTimeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

interface Member {
  id: string;
  user_id: string;
  role: string;
  email?: string;
  full_name?: string;
}

export default function SettingsPage() {
  const [pat, setPat] = useState("");
  const [patStatus, setPatStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [patError, setPatError] = useState("");
  const [figmaHandle, setFigmaHandle] = useState<string | null>(null);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [members, setMembers] = useState<Member[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviting, setInviting] = useState(false);
  const [inviteResult, setInviteResult] = useState<{ ok: boolean; msg: string } | null>(null);

  // Notification settings
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [lastScan, setLastScan] = useState<string | null>(null);
  const [scanStatus, setScanStatus] = useState<"idle" | "running" | "done">("idle");
  const [scanResult, setScanResult] = useState<{ notified: number; skipped: number } | null>(null);

  useEffect(() => {
    fetch("/api/notifications/test")
      .then(r => r.json())
      .then((d: { notifications_enabled?: boolean; notifications_last_scan?: string | null }) => {
        setNotificationsEnabled(d.notifications_enabled ?? true);
        setLastScan(d.notifications_last_scan ?? null);
      })
      .catch(() => {/* migration not run yet — keep defaults */});
  }, []);

  useEffect(() => {
    fetch("/api/settings").then(r => r.json()).then((d: {
      figma_pat?: string | null;
      figma_handle?: string | null;
      workspace_id?: string | null;
      members?: Member[];
    }) => {
      if (d.figma_pat) setPat("set");
      if (d.figma_handle) setFigmaHandle(d.figma_handle);
      if (d.workspace_id) setWorkspaceId(d.workspace_id);
      if (d.members) setMembers(d.members);
    });
  }, []);

  async function savePat() {
    if (pat === "set" || !pat.trim()) return;
    setPatStatus("saving");
    setPatError("");
    const res = await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ figma_pat: pat.trim() }),
    });
    const data = await res.json() as { error?: string; figma_handle?: string };
    if (!res.ok) {
      setPatStatus("error");
      setPatError(data.error ?? "Failed to save");
      return;
    }
    setPatStatus("saved");
    setPat("set");
    if (data.figma_handle) setFigmaHandle(data.figma_handle);
    setTimeout(() => setPatStatus("idle"), 3000);
  }

  const shareUrl = workspaceId
    ? `${typeof window !== "undefined" ? window.location.origin : "https://memry-team-opal.vercel.app"}/share/${workspaceId}`
    : null;

  async function copyShareLink() {
    if (!shareUrl) return;
    await navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function inviteMember() {
    if (!inviteEmail.trim()) return;
    setInviting(true);
    setInviteResult(null);
    const res = await fetch("/api/invite", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: inviteEmail.trim() }),
    });
    const data = await res.json() as { error?: string };
    if (res.ok) {
      setInviteResult({ ok: true, msg: `Invite sent to ${inviteEmail}` });
      setInviteEmail("");
    } else {
      setInviteResult({ ok: false, msg: data.error ?? "Failed to invite" });
    }
    setInviting(false);
  }

  async function toggleNotifications(enabled: boolean) {
    setNotificationsEnabled(enabled);
    await fetch("/api/notifications/test", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notifications_enabled: enabled }),
    }).catch(() => {/* non-fatal */});
  }

  async function runTestScan() {
    setScanStatus("running");
    setScanResult(null);
    try {
      const res  = await fetch("/api/notifications/test", { method: "POST" });
      const data = await res.json() as {
        notified?: number;
        skipped?: number;
        notifications_last_scan?: string;
      };
      setScanResult({ notified: data.notified ?? 0, skipped: data.skipped ?? 0 });
      if (data.notifications_last_scan) setLastScan(data.notifications_last_scan);
    } catch {
      setScanResult({ notified: 0, skipped: 0 });
    } finally {
      setScanStatus("done");
    }
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-[#f5f5f7]">
      <div className="px-8 pt-7 pb-5">
        <h1 className="text-gray-900 text-2xl font-bold tracking-tight mb-0.5">Settings</h1>
        <p className="text-gray-400 text-sm">Configure your workspace and integrations</p>
      </div>

      <div className="flex-1 overflow-y-auto px-8 pb-8 space-y-5 max-w-2xl">

        {/* Figma PAT */}
        <div className="bg-white rounded-2xl border border-gray-100 p-6 shadow-sm">
          <h2 className="text-gray-900 font-bold text-base mb-1">Figma Integration</h2>
          <p className="text-gray-400 text-sm mb-5">
            Connect your Figma account to sync comments automatically.
            Go to Figma → Settings → Security → Personal access tokens.
            Enable <strong className="text-gray-600">current_user: Read</strong>, <strong className="text-gray-600">File content: Read</strong> and <strong className="text-gray-600">Comments: Read + Write</strong>.
          </p>

          {figmaHandle && pat === "set" && (
            <div className="flex items-center gap-2 mb-4 text-zinc-700">
              <CheckCircle size={14} />
              <span className="text-sm font-medium">Connected as @{figmaHandle}</span>
            </div>
          )}

          <input
            value={pat === "set" ? "••••••••••••••••••••" : pat}
            onFocus={() => pat === "set" && setPat("")}
            onChange={e => { setPat(e.target.value); setPatStatus("idle"); }}
            placeholder="figd_…"
            type={pat === "set" ? "password" : "text"}
            className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-gray-700 text-sm placeholder:text-gray-300 outline-none focus:border-gray-400 transition-colors mb-3"
          />

          {patError && (
            <div className="flex items-center gap-2 mb-3">
              <AlertCircle size={13} className="text-red-400 flex-shrink-0" />
              <p className="text-red-400 text-xs">{patError}</p>
            </div>
          )}

          <div className="flex items-center gap-3">
            <button
              onClick={savePat}
              disabled={patStatus === "saving" || pat === "set" || !pat.trim()}
              className="flex items-center gap-2 bg-gray-900 hover:bg-black disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold px-4 py-2 rounded-xl transition-colors"
            >
              {patStatus === "saving" && <Loader2 size={13} className="animate-spin" />}
              {patStatus === "saved" ? "✓ Saved" : patStatus === "saving" ? "Validating…" : "Save token"}
            </button>
            {pat === "set" && (
              <button
                onClick={() => { setPat(""); setPatStatus("idle"); setFigmaHandle(null); }}
                className="text-gray-400 hover:text-gray-600 text-xs transition-colors"
              >
                Replace
              </button>
            )}
          </div>
        </div>

        {/* Share link */}
        <div className="bg-white rounded-2xl border border-gray-100 p-6 shadow-sm">
          <div className="flex items-center gap-2 mb-1">
            <Link2 size={16} className="text-gray-400" />
            <h2 className="text-gray-900 font-bold text-base">Stakeholder Share Link</h2>
          </div>
          <p className="text-gray-400 text-sm mb-4">
            Share a public read-only view of your project status with stakeholders — no login required.
          </p>

          {shareUrl ? (
            <div className="flex items-center gap-2">
              <div className="flex-1 bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-gray-500 text-sm truncate">
                {shareUrl}
              </div>
              <button
                onClick={copyShareLink}
                className="flex items-center gap-1.5 bg-gray-900 hover:bg-black text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition-colors flex-shrink-0"
              >
                {copied ? <Check size={13} /> : <Copy size={13} />}
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>
          ) : (
            <div className="bg-gray-50 rounded-xl px-4 py-3">
              <p className="text-gray-400 text-sm">Loading…</p>
            </div>
          )}
        </div>

        {/* Team Members */}
        <div className="bg-white rounded-2xl border border-gray-100 p-6 shadow-sm">
          <div className="flex items-center gap-2 mb-1">
            <Users size={16} className="text-gray-400" />
            <h2 className="text-gray-900 font-bold text-base">Team Members</h2>
          </div>
          <p className="text-gray-400 text-sm mb-5">
            Invite your team to collaborate on feedback and decisions.
          </p>

          {/* Current members */}
          {members.length > 0 && (
            <div className="space-y-2 mb-5">
              {members.map(m => {
                const initial = (m.full_name ?? m.email ?? "?")[0]?.toUpperCase();
                return (
                  <div key={m.id} className="flex items-center gap-3 py-2.5 border-b border-gray-50 last:border-0">
                    <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center flex-shrink-0">
                      <span className="text-gray-600 font-bold text-sm">{initial}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-gray-700 text-sm font-medium">{m.full_name ?? m.email ?? "Unknown"}</p>
                      {m.email && m.full_name && <p className="text-gray-400 text-xs">{m.email}</p>}
                    </div>
                    <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full capitalize">{m.role}</span>
                  </div>
                );
              })}
            </div>
          )}

          {/* Invite form */}
          <div className="flex items-center gap-2">
            <input
              value={inviteEmail}
              onChange={e => { setInviteEmail(e.target.value); setInviteResult(null); }}
              onKeyDown={e => e.key === "Enter" && inviteMember()}
              placeholder="colleague@company.com"
              type="email"
              className="flex-1 bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-gray-700 text-sm placeholder:text-gray-300 outline-none focus:border-gray-400 transition-colors"
            />
            <button
              onClick={inviteMember}
              disabled={inviting || !inviteEmail.trim()}
              className="flex items-center gap-1.5 bg-gray-900 hover:bg-black disabled:opacity-40 text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition-colors flex-shrink-0"
            >
              {inviting ? <Loader2 size={13} className="animate-spin" /> : null}
              {inviting ? "Sending…" : "Invite"}
            </button>
          </div>
          {inviteResult && (
            <p className={`text-xs mt-2 ${inviteResult.ok ? "text-zinc-700" : "text-red-400"}`}>
              {inviteResult.msg}
            </p>
          )}
        </div>

        {/* Notifications */}
        <div className="bg-white rounded-2xl border border-gray-100 p-6 shadow-sm">
          <div className="flex items-center gap-2 mb-1">
            <Bell size={16} className="text-gray-400" />
            <h2 className="text-gray-900 font-bold text-base">Notifications</h2>
          </div>
          <p className="text-gray-400 text-sm mb-5">
            Proactive Slack DMs to authors when their feedback needs attention.
          </p>

          {/* Toggle */}
          <div className="flex items-center justify-between mb-5">
            <div>
              <p className="text-gray-700 text-sm font-medium">Stale comment alerts (48h)</p>
              <p className="text-gray-400 text-xs mt-0.5">
                DM authors when comments haven&apos;t been updated in 48 hours
              </p>
            </div>
            <button
              onClick={() => void toggleNotifications(!notificationsEnabled)}
              aria-label={notificationsEnabled ? "Disable notifications" : "Enable notifications"}
              className={`relative w-10 h-6 rounded-full transition-colors flex-shrink-0 ${
                notificationsEnabled ? "bg-gray-900" : "bg-gray-200"
              }`}
            >
              <span
                className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${
                  notificationsEnabled ? "translate-x-4" : "translate-x-0"
                }`}
              />
            </button>
          </div>

          {/* Last scan timestamp */}
          {lastScan && (
            <p className="text-gray-400 text-xs mb-4">
              Last scan: {scanTimeAgo(lastScan)}
            </p>
          )}

          {/* Test scan button */}
          <button
            onClick={() => void runTestScan()}
            disabled={scanStatus === "running"}
            className="flex items-center gap-2 bg-gray-100 hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed text-gray-700 text-sm font-medium px-4 py-2 rounded-xl transition-colors"
          >
            {scanStatus === "running"
              ? <Loader2 size={13} className="animate-spin" />
              : <Bell size={13} />}
            {scanStatus === "running" ? "Running scan…" : "Test scan now"}
          </button>

          {scanResult && (
            <p className="text-sm mt-2 text-gray-500">
              ✓ Notified {scanResult.notified}{" "}
              {scanResult.notified === 1 ? "person" : "people"}
              {scanResult.skipped > 0 ? `, skipped ${scanResult.skipped}` : ""}
            </p>
          )}
        </div>

      </div>
    </div>
  );
}
