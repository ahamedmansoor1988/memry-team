"use client";
import { useState, useEffect } from "react";
import { Users, Pencil, X, Check, Loader2, UserPlus, Send } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Profile {
  id: string;
  display_name: string;
  email: string | null;
  avatar_url: string | null;
  figma_handle: string | null;
  slack_handle: string | null;
  slack_user_id: string | null;
  figma_user_id: string | null;
  created_at: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function initials(name: string): string {
  return name.split(/\s+/).map(w => w[0]?.toUpperCase() ?? "").slice(0, 2).join("");
}

// ─── Skeletons ────────────────────────────────────────────────────────────────

function ProfileSkeleton() {
  return (
    <div className="rounded-panel border border-border bg-paper p-4">
      <div className="flex items-start gap-3">
        <div className="skeleton w-10 h-10 rounded-full shrink-0" />
        <div className="flex-1 space-y-2 pt-0.5">
          <div className="skeleton h-4 w-1/3 rounded" />
          <div className="skeleton h-3 w-1/2 rounded" />
          <div className="flex gap-1.5 mt-2">
            <div className="skeleton h-5 w-24 rounded-full" />
            <div className="skeleton h-5 w-24 rounded-full" />
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Profile Card ─────────────────────────────────────────────────────────────

function ProfileCard({
  profile,
  onUpdate,
}: {
  profile: Profile;
  onUpdate: (updated: Profile) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [slackInput, setSlackInput] = useState(profile.slack_handle ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Invite state
  const [inviting, setInviting] = useState(false);
  const [inviteEmail, setInviteEmail] = useState(profile.email ?? "");
  const [inviteSending, setInviteSending] = useState(false);
  const [inviteResult, setInviteResult] = useState<{ ok: boolean; message: string } | null>(null);

  function startEdit() {
    setSlackInput(profile.slack_handle ?? "");
    setError(null);
    setInviting(false);
    setEditing(true);
  }

  function cancelEdit() {
    setEditing(false);
    setError(null);
  }

  async function saveEdit() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/profiles", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: profile.id,
          slack_handle: slackInput.replace(/^@/, "").trim() || null,
        }),
      });
      const data = await res.json() as { profile?: Profile; error?: string };
      if (!res.ok) { setError(data.error ?? "Save failed"); return; }
      if (data.profile) onUpdate(data.profile);
      setEditing(false);
    } catch {
      setError("Network error");
    } finally {
      setSaving(false);
    }
  }

  function startInvite() {
    setInviteEmail(profile.email ?? "");
    setInviteResult(null);
    setEditing(false);
    setInviting(true);
  }

  function cancelInvite() {
    setInviting(false);
    setInviteResult(null);
  }

  async function sendInvite() {
    if (!inviteEmail.includes("@")) return;
    setInviteSending(true);
    setInviteResult(null);
    try {
      const res = await fetch("/api/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: inviteEmail }),
      });
      const data = await res.json() as { ok?: boolean; error?: string; message?: string };
      if (res.ok && data.ok) {
        setInviteResult({ ok: true, message: data.message ?? "Invite sent!" });
      } else {
        setInviteResult({ ok: false, message: data.error ?? "Failed to send invite" });
      }
    } catch {
      setInviteResult({ ok: false, message: "Network error" });
    } finally {
      setInviteSending(false);
    }
  }

  return (
    <div className="rounded-panel border border-border bg-paper p-4 hover:border-ink/15 transition-colors">
      <div className="flex items-start gap-3">
        {/* Avatar */}
        {profile.avatar_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={profile.avatar_url}
            alt={profile.display_name}
            className="w-10 h-10 rounded-full object-cover shrink-0"
          />
        ) : (
          <span className="w-10 h-10 rounded-full bg-ink text-paper flex items-center justify-center text-[13px] font-bold shrink-0 select-none">
            {initials(profile.display_name)}
          </span>
        )}

        {/* Body */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2 mb-0.5">
            <p className="text-body font-semibold text-ink truncate">{profile.display_name}</p>
            {!editing && !inviting && (
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  onClick={startEdit}
                  title="Link Slack handle"
                  className="text-muted hover:text-ink transition-colors"
                >
                  <Pencil size={12} />
                </button>
                <button
                  onClick={startInvite}
                  title="Invite to Memry"
                  className="text-muted hover:text-ink transition-colors"
                >
                  <UserPlus size={12} />
                </button>
              </div>
            )}
          </div>

          {profile.email && (
            <p className="text-caption text-muted mb-2">{profile.email}</p>
          )}

          {/* Identity badges */}
          <div className="flex items-center gap-1.5 flex-wrap">
            {profile.figma_handle && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-orange-50 text-orange-600 border border-orange-200">
                {/* Mini Figma logo */}
                <svg width="7" height="10" viewBox="0 0 38 57" fill="none" className="shrink-0">
                  <path d="M19 28.5C19 23.8 22.8 20 27.5 20C32.2 20 36 23.8 36 28.5C36 33.2 32.2 37 27.5 37C22.8 37 19 33.2 19 28.5Z" fill="#1ABCFE"/>
                  <path d="M2 46C2 41.3 5.8 37.5 10.5 37.5H19V46C19 50.7 15.2 54.5 10.5 54.5C5.8 54.5 2 50.7 2 46Z" fill="#0ACF83"/>
                  <path d="M19 2V20H27.5C32.2 20 36 16.2 36 11.5C36 6.8 32.2 3 27.5 3H19V2Z" fill="#FF7262"/>
                  <path d="M2 11.5C2 16.2 5.8 20 10.5 20H19V3H10.5C5.8 3 2 6.8 2 11.5Z" fill="#F24E1E"/>
                  <path d="M2 28.5C2 33.2 5.8 37 10.5 37H19V20H10.5C5.8 20 2 23.8 2 28.5Z" fill="#FF7262"/>
                </svg>
                Figma · @{profile.figma_handle}
              </span>
            )}

            {profile.slack_handle ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-violet-50 text-violet-600 border border-violet-200">
                {/* Slack hash */}
                <span className="font-bold text-[9px]">#</span>
                Slack · @{profile.slack_handle}
              </span>
            ) : (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-surface text-muted border border-border">
                Slack not linked
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Inline Slack edit row */}
      {editing && (
        <div className="mt-3 pt-3 border-t border-border">
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted mb-2">Slack Handle</p>
          <div className="flex items-center gap-2">
            <input
              value={slackInput}
              onChange={e => setSlackInput(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") void saveEdit(); if (e.key === "Escape") cancelEdit(); }}
              placeholder="e.g. john.doe"
              autoFocus
              className="flex-1 bg-surface border border-border rounded-lg px-3 py-1.5 text-body text-ink placeholder:text-muted outline-none focus:border-ink/40 transition-colors"
            />
            <button
              onClick={() => void saveEdit()}
              disabled={saving}
              title="Save"
              className="w-8 h-8 rounded-lg bg-ink text-paper flex items-center justify-center hover:opacity-80 disabled:opacity-40 transition-opacity"
            >
              {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={13} />}
            </button>
            <button
              onClick={cancelEdit}
              title="Cancel"
              className="w-8 h-8 rounded-lg border border-border text-muted flex items-center justify-center hover:text-ink transition-colors"
            >
              <X size={13} />
            </button>
          </div>
          {error && <p className="text-caption text-red-500 mt-1.5">{error}</p>}
        </div>
      )}

      {/* Inline invite row */}
      {inviting && (
        <div className="mt-3 pt-3 border-t border-border">
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted mb-2">Invite to Memry</p>
          {inviteResult?.ok ? (
            <div className="flex items-center justify-between">
              <p className="text-caption text-green-600">✓ {inviteResult.message}</p>
              <button
                onClick={cancelInvite}
                className="text-caption text-muted hover:text-ink transition-colors"
              >
                Done
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <input
                type="email"
                value={inviteEmail}
                onChange={e => setInviteEmail(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") void sendInvite(); if (e.key === "Escape") cancelInvite(); }}
                placeholder="email@example.com"
                autoFocus
                className="flex-1 bg-surface border border-border rounded-lg px-3 py-1.5 text-body text-ink placeholder:text-muted outline-none focus:border-ink/40 transition-colors"
              />
              <button
                onClick={() => void sendInvite()}
                disabled={inviteSending || !inviteEmail.includes("@")}
                title="Send invite"
                className="w-8 h-8 rounded-lg bg-ink text-paper flex items-center justify-center hover:opacity-80 disabled:opacity-40 transition-opacity"
              >
                {inviteSending ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
              </button>
              <button
                onClick={cancelInvite}
                title="Cancel"
                className="w-8 h-8 rounded-lg border border-border text-muted flex items-center justify-center hover:text-ink transition-colors"
              >
                <X size={13} />
              </button>
            </div>
          )}
          {inviteResult && !inviteResult.ok && (
            <p className="text-caption text-red-500 mt-1.5">{inviteResult.message}</p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function TeamPage() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);

  // Header invite state
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [headerEmail, setHeaderEmail] = useState("");
  const [headerSending, setHeaderSending] = useState(false);
  const [headerResult, setHeaderResult] = useState<{ ok: boolean; message: string } | null>(null);

  useEffect(() => {
    fetch("/api/profiles")
      .then(r => r.json())
      .then((d: { profiles?: Profile[] }) => {
        setProfiles(d.profiles ?? []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  function handleUpdate(updated: Profile) {
    setProfiles(prev => prev.map(p => p.id === updated.id ? updated : p));
  }

  async function handleHeaderInvite() {
    if (!headerEmail.includes("@")) return;
    setHeaderSending(true);
    setHeaderResult(null);
    try {
      const res = await fetch("/api/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: headerEmail }),
      });
      const data = await res.json() as { ok?: boolean; error?: string; message?: string };
      if (res.ok && data.ok) {
        setHeaderResult({ ok: true, message: data.message ?? "Invite sent!" });
        setHeaderEmail("");
      } else {
        setHeaderResult({ ok: false, message: data.error ?? "Failed to send invite" });
      }
    } catch {
      setHeaderResult({ ok: false, message: "Network error" });
    } finally {
      setHeaderSending(false);
    }
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-paper">

      {/* ── Header ── */}
      <div className="px-6 pt-6 pb-5 border-b border-border shrink-0">
        <div className="flex items-start justify-between gap-4 mb-1">
          <div className="flex items-center gap-2">
            <Users size={18} className="text-muted shrink-0" />
            <h1 className="text-title font-semibold text-ink">Team</h1>
          </div>
          <button
            onClick={() => { setShowInviteForm(v => !v); setHeaderResult(null); }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-body text-ink hover:bg-surface transition-colors shrink-0"
          >
            <UserPlus size={13} />
            <span>Invite</span>
          </button>
        </div>
        <p className="text-body text-muted">Unified identities across Figma and Slack</p>

        {/* Inline header invite form */}
        {showInviteForm && (
          <div className="mt-4 p-4 rounded-panel border border-border bg-surface">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted mb-2">Invite someone to Memry</p>
            {headerResult?.ok ? (
              <div className="flex items-center justify-between">
                <p className="text-caption text-green-600">✓ {headerResult.message}</p>
                <button
                  onClick={() => { setShowInviteForm(false); setHeaderResult(null); }}
                  className="text-caption text-muted hover:text-ink transition-colors"
                >
                  Done
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <input
                  type="email"
                  value={headerEmail}
                  onChange={e => setHeaderEmail(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === "Enter") void handleHeaderInvite();
                    if (e.key === "Escape") setShowInviteForm(false);
                  }}
                  placeholder="colleague@company.com"
                  autoFocus
                  className="flex-1 bg-paper border border-border rounded-lg px-3 py-1.5 text-body text-ink placeholder:text-muted outline-none focus:border-ink/40 transition-colors"
                />
                <button
                  onClick={() => void handleHeaderInvite()}
                  disabled={headerSending || !headerEmail.includes("@")}
                  className="px-4 py-1.5 rounded-lg bg-ink text-paper text-body font-medium hover:opacity-80 disabled:opacity-40 transition-opacity flex items-center gap-1.5 shrink-0"
                >
                  {headerSending ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
                  {headerSending ? "Sending…" : "Send invite"}
                </button>
                <button
                  onClick={() => { setShowInviteForm(false); setHeaderResult(null); }}
                  className="w-8 h-8 rounded-lg border border-border text-muted flex items-center justify-center hover:text-ink transition-colors shrink-0"
                >
                  <X size={13} />
                </button>
              </div>
            )}
            {headerResult && !headerResult.ok && (
              <p className="text-caption text-red-500 mt-1.5">{headerResult.message}</p>
            )}
          </div>
        )}
      </div>

      {/* ── Content ── */}
      <div className="flex-1 overflow-y-auto px-6 py-5">
        {loading ? (
          <div className="space-y-3">
            <ProfileSkeleton /><ProfileSkeleton /><ProfileSkeleton />
          </div>
        ) : profiles.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 gap-3 text-center">
            <Users size={32} className="text-wash" />
            <p className="text-lead font-medium text-ink">No team members yet</p>
            <p className="text-body text-muted max-w-xs">
              Sync a Figma file to discover your team.
            </p>
          </div>
        ) : (
          <div className="space-y-3 fade-in">
            <p className="text-caption text-muted mb-1">
              {profiles.length} {profiles.length === 1 ? "member" : "members"} discovered
            </p>
            {profiles.map(profile => (
              <ProfileCard
                key={profile.id}
                profile={profile}
                onUpdate={handleUpdate}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
