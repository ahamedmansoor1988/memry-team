"use client";
import { useState, useEffect } from "react";
import {
  CheckCircle, AlertCircle, Loader2, Copy, Check,
  Link2, Bell, UserPlus, X,
} from "lucide-react";

// ── Helpers ───────────────────────────────────────────────────────────────────

function scanTimeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function daysUntil(iso: string): number {
  return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000));
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface Member {
  id:        string;
  user_id:   string;
  role:      string;
  email?:    string;
  full_name?: string;
}

interface PendingInvite {
  id:         string;
  email:      string;
  role:       string;
  expires_at: string;
  created_at: string;
}

type TabId = "workspace" | "team" | "notifications";

// ── Tab header ────────────────────────────────────────────────────────────────

function TabBar({ active, onChange }: { active: TabId; onChange: (t: TabId) => void }) {
  const tabs: { id: TabId; label: string }[] = [
    { id: "workspace",     label: "Workspace"     },
    { id: "team",          label: "Team"          },
    { id: "notifications", label: "Notifications" },
  ];
  return (
    <div className="flex gap-1 border-b border-[var(--border)] mb-6">
      {tabs.map(t => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={`px-4 py-2.5 text-sm font-medium transition-colors -mb-px border-b-2 ${
            active === t.id
              ? "border-zinc-900 text-[var(--text)]"
              : "border-transparent text-[var(--text-3)] hover:text-[var(--text-2)]"
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

// ── Workspace tab ─────────────────────────────────────────────────────────────

function WorkspaceTab() {
  const [pat,         setPat]         = useState("");
  const [patStatus,   setPatStatus]   = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [patError,    setPatError]    = useState("");
  const [figmaHandle, setFigmaHandle] = useState<string | null>(null);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [copied,      setCopied]      = useState(false);

  useEffect(() => {
    fetch("/api/settings").then(r => r.json()).then((d: {
      figma_pat?: string | null;
      figma_handle?: string | null;
      workspace_id?: string | null;
    }) => {
      if (d.figma_pat)    setPat("set");
      if (d.figma_handle) setFigmaHandle(d.figma_handle);
      if (d.workspace_id) setWorkspaceId(d.workspace_id);
    });
  }, []);

  async function savePat() {
    if (pat === "set" || !pat.trim()) return;
    setPatStatus("saving"); setPatError("");
    const res  = await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ figma_pat: pat.trim() }),
    });
    const data = await res.json() as { error?: string; figma_handle?: string };
    if (!res.ok) { setPatStatus("error"); setPatError(data.error ?? "Failed to save"); return; }
    setPatStatus("saved"); setPat("set");
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

  return (
    <div className="space-y-5">
      {/* Figma PAT */}
      <div className="bg-white rounded-2xl border border-[var(--border)] p-6">
        <h2 className="text-[var(--text)] font-semibold text-base mb-1">Figma Integration</h2>
        <p className="text-[var(--text-2)] text-sm mb-5">
          Connect your Figma account to sync comments automatically.
          Go to Figma → Settings → Security → Personal access tokens.
          Enable <strong className="text-[var(--text-2)]">current_user: Read</strong>,{" "}
          <strong className="text-[var(--text-2)]">File content: Read</strong> and{" "}
          <strong className="text-[var(--text-2)]">Comments: Read + Write</strong>.
        </p>
        {figmaHandle && pat === "set" && (
          <div className="flex items-center gap-2 mb-4 text-[var(--text-2)]">
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
          className="w-full bg-[var(--bg)] border border-[var(--border)] rounded-xl px-4 py-2.5 text-[var(--text-2)] text-sm placeholder:text-[var(--text-3)] outline-none focus:border-zinc-400 transition-colors mb-3"
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
            className="flex items-center gap-2 bg-[var(--accent)] hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium px-4 py-2 rounded-xl transition-colors"
          >
            {patStatus === "saving" && <Loader2 size={13} className="animate-spin" />}
            {patStatus === "saved" ? "✓ Saved" : patStatus === "saving" ? "Validating…" : "Save token"}
          </button>
          {pat === "set" && (
            <button
              onClick={() => { setPat(""); setPatStatus("idle"); setFigmaHandle(null); }}
              className="text-[var(--text-3)] hover:text-[var(--text-2)] text-xs transition-colors"
            >
              Replace
            </button>
          )}
        </div>
      </div>

      {/* Share link */}
      <div className="bg-white rounded-2xl border border-[var(--border)] p-6">
        <div className="flex items-center gap-2 mb-1">
          <Link2 size={16} className="text-[var(--text-3)]" />
          <h2 className="text-[var(--text)] font-semibold text-base">Stakeholder Share Link</h2>
        </div>
        <p className="text-[var(--text-2)] text-sm mb-4">
          Share a public read-only view of your project status with stakeholders — no login required.
        </p>
        {shareUrl ? (
          <div className="flex items-center gap-2">
            <div className="flex-1 bg-[var(--bg)] border border-[var(--border)] rounded-xl px-4 py-2.5 text-[var(--text-2)] text-sm truncate">
              {shareUrl}
            </div>
            <button
              onClick={copyShareLink}
              className="flex items-center gap-1.5 bg-[var(--accent)] hover:opacity-90 text-white text-sm font-medium px-4 py-2.5 rounded-xl transition-colors flex-shrink-0"
            >
              {copied ? <Check size={13} /> : <Copy size={13} />}
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>
        ) : (
          <div className="bg-[var(--bg)] rounded-xl px-4 py-3">
            <p className="text-[var(--text-3)] text-sm">Loading…</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Team tab ──────────────────────────────────────────────────────────────────

function TeamTab() {
  const [members,        setMembers]        = useState<Member[]>([]);
  const [pendingInvites, setPendingInvites] = useState<PendingInvite[]>([]);
  const [inviteEmail,    setInviteEmail]    = useState("");
  const [inviteRole,     setInviteRole]     = useState<"member" | "admin">("member");
  const [inviting,       setInviting]       = useState(false);
  const [inviteResult,   setInviteResult]   = useState<{ ok: boolean; msg: string } | null>(null);
  const [revoking,       setRevoking]       = useState<string | null>(null);
  const [currentUserId,  setCurrentUserId]  = useState<string | null>(null);
  const [isAdmin,        setIsAdmin]        = useState(false);

  useEffect(() => {
    // Load members + current user context
    fetch("/api/settings").then(r => r.json()).then((d: {
      members?: Member[];
      current_user_id?: string;
      current_role?: string;
    }) => {
      if (d.members)        setMembers(d.members);
      if (d.current_user_id) setCurrentUserId(d.current_user_id);
      if (d.current_role === "admin") setIsAdmin(true);
    });

    // Load pending invites
    fetch("/api/invites").then(r => r.json()).then((d: { invites?: PendingInvite[] }) => {
      setPendingInvites(d.invites ?? []);
    }).catch(() => {});
  }, []);

  async function handleInvite() {
    if (!inviteEmail.trim()) return;
    setInviting(true); setInviteResult(null);
    const res  = await fetch("/api/invites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole }),
    });
    const data = await res.json() as { ok?: boolean; error?: string };
    if (res.ok) {
      setInviteResult({ ok: true, msg: `Invite sent to ${inviteEmail}` });
      setInviteEmail("");
      // Refresh pending list
      const inv = await fetch("/api/invites").then(r => r.json()) as { invites?: PendingInvite[] };
      setPendingInvites(inv.invites ?? []);
    } else {
      setInviteResult({ ok: false, msg: data.error ?? "Failed to invite" });
    }
    setInviting(false);
  }

  async function handleRevoke(id: string) {
    setRevoking(id);
    await fetch(`/api/invites/${id}/revoke`, { method: "DELETE" });
    setPendingInvites(p => p.filter(i => i.id !== id));
    setRevoking(null);
  }

  return (
    <div className="space-y-6">
      {/* Invite form */}
      <div className="bg-white rounded-2xl border border-[var(--border)] p-6">
        <div className="flex items-center gap-2 mb-1">
          <UserPlus size={16} className="text-[var(--text-3)]" />
          <h2 className="text-[var(--text)] font-semibold text-base">Invite team members</h2>
        </div>
        <p className="text-[var(--text-2)] text-sm mb-5">
          Team members get access to all projects and feedback in this workspace.
        </p>

        <div className="flex gap-2 mb-3">
          <input
            type="email"
            placeholder="colleague@company.com"
            value={inviteEmail}
            onChange={e => { setInviteEmail(e.target.value); setInviteResult(null); }}
            onKeyDown={e => e.key === "Enter" && void handleInvite()}
            className="flex-1 border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text-2)] placeholder:text-[var(--text-3)] focus:outline-none focus:ring-2 focus:ring-zinc-900"
          />
          <select
            value={inviteRole}
            onChange={e => setInviteRole(e.target.value as "member" | "admin")}
            className="border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text-2)] bg-white focus:outline-none focus:ring-2 focus:ring-zinc-900"
          >
            <option value="member">Member</option>
            <option value="admin">Admin</option>
          </select>
          <button
            onClick={() => void handleInvite()}
            disabled={inviting || !inviteEmail.trim()}
            className="bg-[var(--accent)] hover:opacity-90 disabled:opacity-40 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors flex-shrink-0 flex items-center gap-1.5"
          >
            {inviting && <Loader2 size={13} className="animate-spin" />}
            Send invite
          </button>
        </div>

        {inviteResult && (
          <p className={`text-xs ${inviteResult.ok ? "text-[var(--text-2)]" : "text-red-500"}`}>
            {inviteResult.msg}
          </p>
        )}
      </div>

      {/* Current members */}
      <div className="bg-white rounded-2xl border border-[var(--border)] p-6">
        <h2 className="text-[var(--text)] font-semibold text-base mb-4">
          Members ({members.length})
        </h2>
        {members.length === 0 ? (
          <p className="text-sm text-[var(--text-3)]">No members yet</p>
        ) : (
          <div>
            {members.map(m => {
              const initial = (m.full_name ?? m.email ?? "?")[0]?.toUpperCase();
              const isSelf  = m.user_id === currentUserId;
              return (
                <div key={m.id} className="flex items-center gap-3 py-3 border-b border-[var(--border-2)] last:border-0">
                  <div className="w-8 h-8 rounded-full bg-[var(--accent)] text-white text-xs font-bold flex items-center justify-center flex-shrink-0">
                    {initial}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-[var(--text)]">{m.full_name ?? m.email ?? "Unknown"}</p>
                    {m.email && m.full_name && <p className="text-xs text-[var(--text-3)]">{m.email}</p>}
                  </div>
                  <span className="text-xs bg-[var(--border-2)] text-[var(--text-2)] px-2 py-0.5 rounded-full capitalize ml-auto">
                    {m.role === "admin" ? "Admin" : "Member"}
                  </span>
                  {isAdmin && !isSelf && (
                    <button className="text-xs text-[var(--text-3)] hover:text-red-500 transition-colors ml-2">
                      Remove
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Pending invites */}
      {pendingInvites.length > 0 && (
        <div className="bg-white rounded-2xl border border-[var(--border)] p-6">
          <h2 className="text-[var(--text)] font-semibold text-base mb-4">
            Pending invites ({pendingInvites.length})
          </h2>
          <div>
            {pendingInvites.map(inv => (
              <div key={inv.id} className="flex items-center gap-3 py-3 border-b border-[var(--border-2)] last:border-0">
                <div className="w-8 h-8 rounded-full bg-[var(--border-2)] text-[var(--text-2)] text-xs font-bold flex items-center justify-center flex-shrink-0">
                  {inv.email[0]?.toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-[var(--text-2)]">{inv.email}</p>
                  <p className="text-xs text-[var(--text-3)]">
                    Expires in {daysUntil(inv.expires_at)}d · {inv.role === "admin" ? "Admin" : "Member"}
                  </p>
                </div>
                <span className="text-xs bg-[var(--border-2)] text-[var(--text-3)] px-2 py-0.5 rounded-full">
                  Pending
                </span>
                {isAdmin && (
                  <button
                    onClick={() => void handleRevoke(inv.id)}
                    disabled={revoking === inv.id}
                    className="text-zinc-300 hover:text-red-500 transition-colors ml-2 disabled:opacity-40"
                    aria-label="Revoke invite"
                  >
                    {revoking === inv.id
                      ? <Loader2 size={13} className="animate-spin" />
                      : <X size={13} />
                    }
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Notifications tab ─────────────────────────────────────────────────────────

function NotificationsTab() {
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [lastScan,   setLastScan]   = useState<string | null>(null);
  const [scanStatus, setScanStatus] = useState<"idle" | "running" | "done">("idle");
  const [scanResult, setScanResult] = useState<{ notified: number; skipped: number } | null>(null);

  useEffect(() => {
    fetch("/api/notifications/test")
      .then(r => r.json())
      .then((d: { notifications_enabled?: boolean; notifications_last_scan?: string | null }) => {
        setNotificationsEnabled(d.notifications_enabled ?? true);
        setLastScan(d.notifications_last_scan ?? null);
      })
      .catch(() => {});
  }, []);

  async function toggleNotifications(enabled: boolean) {
    setNotificationsEnabled(enabled);
    await fetch("/api/notifications/test", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notifications_enabled: enabled }),
    }).catch(() => {});
  }

  async function runTestScan() {
    setScanStatus("running"); setScanResult(null);
    try {
      const res  = await fetch("/api/notifications/test", { method: "POST" });
      const data = await res.json() as { notified?: number; skipped?: number; notifications_last_scan?: string };
      setScanResult({ notified: data.notified ?? 0, skipped: data.skipped ?? 0 });
      if (data.notifications_last_scan) setLastScan(data.notifications_last_scan);
    } catch {
      setScanResult({ notified: 0, skipped: 0 });
    } finally {
      setScanStatus("done");
    }
  }

  return (
    <div className="bg-white rounded-2xl border border-[var(--border)] p-6">
      <div className="flex items-center gap-2 mb-1">
        <Bell size={16} className="text-[var(--text-3)]" />
        <h2 className="text-[var(--text)] font-semibold text-base">Notifications</h2>
      </div>
      <p className="text-[var(--text-2)] text-sm mb-5">
        Proactive Slack DMs to authors when their feedback needs attention.
      </p>

      <div className="flex items-center justify-between mb-5">
        <div>
          <p className="text-[var(--text-2)] text-sm font-medium">Stale comment alerts (48h)</p>
          <p className="text-[var(--text-3)] text-xs mt-0.5">
            DM authors when comments haven&apos;t been updated in 48 hours
          </p>
        </div>
        <button
          onClick={() => void toggleNotifications(!notificationsEnabled)}
          className={`relative w-10 h-6 rounded-full transition-colors flex-shrink-0 ${
            notificationsEnabled ? "bg-[var(--accent)]" : "bg-zinc-200"
          }`}
        >
          <span
            className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${
              notificationsEnabled ? "translate-x-4" : "translate-x-0"
            }`}
          />
        </button>
      </div>

      {lastScan && (
        <p className="text-[var(--text-3)] text-xs mb-4">Last scan: {scanTimeAgo(lastScan)}</p>
      )}

      <button
        onClick={() => void runTestScan()}
        disabled={scanStatus === "running"}
        className="flex items-center gap-2 bg-[var(--border-2)] hover:bg-zinc-200 disabled:opacity-50 text-[var(--text-2)] text-sm font-medium px-4 py-2 rounded-xl transition-colors"
      >
        {scanStatus === "running" ? <Loader2 size={13} className="animate-spin" /> : <Bell size={13} />}
        {scanStatus === "running" ? "Running scan…" : "Test scan now"}
      </button>

      {scanResult && (
        <p className="text-sm mt-2 text-[var(--text-2)]">
          ✓ Notified {scanResult.notified}{" "}
          {scanResult.notified === 1 ? "person" : "people"}
          {scanResult.skipped > 0 ? `, skipped ${scanResult.skipped}` : ""}
        </p>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<TabId>("workspace");

  return (
    <div className="min-h-full bg-white">
      <div className="px-8 pt-7 pb-5 border-b border-[var(--border-2)]">
        <h1 className="text-[var(--text)] text-2xl font-semibold mb-0.5">Settings</h1>
        <p className="text-[var(--text-2)] text-sm">Configure your workspace and integrations</p>
      </div>

      <div className="px-8 pt-5 pb-8 max-w-2xl">
        <TabBar active={activeTab} onChange={setActiveTab} />

        {activeTab === "workspace"     && <WorkspaceTab />}
        {activeTab === "team"          && <TeamTab />}
        {activeTab === "notifications" && <NotificationsTab />}
      </div>
    </div>
  );
}
