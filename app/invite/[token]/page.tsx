"use client";
import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Loader2 } from "lucide-react";

interface InviteDetails {
  workspace_name: string;
  inviter_name:   string | null;
  email:          string;
  role:           string;
  expires_at:     string;
}

type State =
  | { type: "loading" }
  | { type: "invalid" }
  | { type: "unauthenticated"; invite: InviteDetails }
  | { type: "ready";           invite: InviteDetails }
  | { type: "wrong_email";     invite: InviteDetails; userEmail: string }
  | { type: "already_member";  invite: InviteDetails }
  | { type: "accepting" }
  | { type: "done" };

export default function InvitePage() {
  const router  = useRouter();
  const params  = useParams();
  const token   = params.token as string;

  const [state, setState] = useState<State>({ type: "loading" });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function init() {
      // Fetch invite details
      const res = await fetch(`/api/invites/${token}`);
      if (!res.ok) { setState({ type: "invalid" }); return; }
      const invite = await res.json() as InviteDetails;

      // Check auth status
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();

      if (!user) {
        setState({ type: "unauthenticated", invite });
        return;
      }

      if (user.email?.toLowerCase() !== invite.email.toLowerCase()) {
        setState({ type: "wrong_email", invite, userEmail: user.email ?? "" });
        return;
      }

      setState({ type: "ready", invite });
    }
    void init();
  }, [token]);

  async function acceptInvite() {
    setState({ type: "accepting" });
    setError(null);
    const res = await fetch(`/api/invites/${token}`, { method: "POST" });
    const data = await res.json() as { ok?: boolean; already_member?: boolean; error?: string };
    if (!res.ok) {
      setError(data.error ?? "Failed to accept invite");
      // Restore ready state
      const detailsRes = await fetch(`/api/invites/${token}`);
      const invite = await detailsRes.json() as InviteDetails;
      setState({ type: "ready", invite });
      return;
    }
    if (data.already_member) {
      const detailsRes = await fetch(`/api/invites/${token}`);
      const invite = await detailsRes.json() as InviteDetails;
      setState({ type: "already_member", invite });
      return;
    }
    setState({ type: "done" });
    setTimeout(() => router.push("/"), 1500);
  }

  function goToLogin() {
    router.push(`/login?redirect=/invite/${token}`);
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 px-4">
      <div className="bg-white border border-zinc-200 rounded-2xl p-8 w-full max-w-md shadow-sm text-center">

        {/* Logo */}
        <div className="w-12 h-12 rounded-xl bg-zinc-900 text-white text-xl font-bold flex items-center justify-center mx-auto mb-4">
          M
        </div>

        {state.type === "loading" && (
          <>
            <div className="animate-pulse bg-zinc-100 h-6 w-48 rounded mx-auto mb-2" />
            <div className="animate-pulse bg-zinc-100 h-4 w-64 rounded mx-auto mb-6" />
            <div className="animate-pulse bg-zinc-100 h-10 w-full rounded-lg" />
          </>
        )}

        {state.type === "invalid" && (
          <>
            <h1 className="text-xl font-semibold text-zinc-900 mb-1">Invite not found</h1>
            <p className="text-sm text-zinc-500 mb-6">
              This invite link is invalid or has expired.
            </p>
            <button
              onClick={() => router.push("/")}
              className="w-full bg-zinc-900 hover:bg-zinc-800 text-white text-sm font-medium py-2.5 rounded-lg transition-colors"
            >
              Go to app
            </button>
          </>
        )}

        {(state.type === "unauthenticated" || state.type === "ready" || state.type === "wrong_email" || state.type === "already_member") && (
          <>
            <h1 className="text-xl font-semibold text-zinc-900 mb-1">You&apos;re invited</h1>
            <p className="text-sm text-zinc-500 mb-6">
              {state.invite.inviter_name
                ? <><strong className="text-zinc-700">{state.invite.inviter_name}</strong> invited you to join a workspace on Memry</>
                : "You've been invited to join a workspace on Memry"
              }
            </p>

            {/* Workspace badge */}
            <div className="inline-flex items-center gap-2 bg-zinc-50 border border-zinc-200 rounded-lg px-4 py-2 mb-4">
              <span className="w-6 h-6 rounded-md bg-zinc-900 text-white text-[10px] font-bold flex items-center justify-center flex-shrink-0">
                {state.invite.workspace_name[0]?.toUpperCase() ?? "W"}
              </span>
              <span className="text-sm font-medium text-zinc-900">{state.invite.workspace_name}</span>
            </div>

            {/* Role badge */}
            <div className="mb-6">
              <span className="text-xs bg-zinc-100 text-zinc-600 px-2.5 py-1 rounded-full">
                Joining as {state.invite.role === "admin" ? "Admin" : "Member"}
              </span>
            </div>

            {error && (
              <p className="text-sm text-red-500 mb-4">{error}</p>
            )}

            {state.type === "unauthenticated" && (
              <>
                <p className="text-xs text-zinc-400 mb-4">
                  This invite was sent to <strong className="text-zinc-600">{state.invite.email}</strong>
                </p>
                <button
                  onClick={goToLogin}
                  className="w-full bg-zinc-900 hover:bg-zinc-800 text-white text-sm font-medium py-2.5 rounded-lg transition-colors"
                >
                  Sign up / Log in to accept
                </button>
              </>
            )}

            {state.type === "ready" && (
              <button
                onClick={acceptInvite}
                className="w-full bg-zinc-900 hover:bg-zinc-800 text-white text-sm font-medium py-2.5 rounded-lg transition-colors"
              >
                Accept invite
              </button>
            )}

            {state.type === "wrong_email" && (
              <p className="text-sm text-red-500">
                This invite was sent to <strong>{state.invite.email}</strong>.
                Please log in with that email address.
              </p>
            )}

            {state.type === "already_member" && (
              <>
                <p className="text-sm text-zinc-500 mb-4">
                  You&apos;re already in this workspace.
                </p>
                <button
                  onClick={() => router.push("/")}
                  className="w-full bg-zinc-900 hover:bg-zinc-800 text-white text-sm font-medium py-2.5 rounded-lg transition-colors"
                >
                  Go to workspace
                </button>
              </>
            )}
          </>
        )}

        {state.type === "accepting" && (
          <>
            <h1 className="text-xl font-semibold text-zinc-900 mb-1">Joining workspace…</h1>
            <p className="text-sm text-zinc-500 mb-6">Please wait a moment.</p>
            <div className="flex justify-center">
              <Loader2 className="w-6 h-6 animate-spin text-zinc-400" />
            </div>
          </>
        )}

        {state.type === "done" && (
          <>
            <h1 className="text-xl font-semibold text-zinc-900 mb-1">You&apos;re in!</h1>
            <p className="text-sm text-zinc-500 mb-6">Taking you to your workspace…</p>
            <div className="flex justify-center">
              <Loader2 className="w-6 h-6 animate-spin text-zinc-400" />
            </div>
          </>
        )}

      </div>
    </div>
  );
}
