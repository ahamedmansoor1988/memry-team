/**
 * GET /api/integrations/slack/oauth/callback
 *
 * Slack redirects here after the user authorizes. We:
 *   1. Verify the CSRF state matches the cookie set in /start
 *   2. Exchange the code for a bot token via oauth.v2.access
 *   3. Save the bot token + team id onto the user's workspace
 *   4. Redirect back to /integrations with a status flag
 *
 * Requires env: SLACK_CLIENT_ID, SLACK_CLIENT_SECRET
 * Signature verification for incoming events uses the app-level
 * SLACK_SIGNING_SECRET env var (the events route already falls back to it).
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";

interface SlackOAuthResponse {
  ok:            boolean;
  error?:        string;
  access_token?: string;            // bot token (xoxb-…)
  token_type?:   string;
  scope?:        string;
  team?:         { id?: string; name?: string; };  // name stored as slack_team_name
}

export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin;
  const back = (status: string) => NextResponse.redirect(`${origin}/integrations?slack=${status}`);

  const code  = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const oauthError = req.nextUrl.searchParams.get("error");

  if (oauthError) return back("denied");     // user clicked "Cancel"
  if (!code)      return back("error");

  // ── 1. CSRF check ────────────────────────────────────────────────────────
  const cookieState = req.cookies.get("slack_oauth_state")?.value;
  if (!state || !cookieState || state !== cookieState) return back("state_mismatch");

  const clientId     = process.env.SLACK_CLIENT_ID;
  const clientSecret = process.env.SLACK_CLIENT_SECRET;
  if (!clientId || !clientSecret) return back("not_configured");

  // ── 2. Identify the workspace from the logged-in user ─────────────────────
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(`${origin}/login`);

  const admin = createAdminClient();
  const { data: member } = await admin
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", user.id)
    .single();
  const workspaceId = (member as { workspace_id: string } | null)?.workspace_id;
  if (!workspaceId) return back("no_workspace");

  // ── 3. Exchange the code for a bot token ──────────────────────────────────
  const redirectUri = `${origin}/api/integrations/slack/oauth/callback`;
  let tokenData: SlackOAuthResponse;
  try {
    const tokenRes = await fetch("https://slack.com/api/oauth.v2.access", {
      method:  "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body:    new URLSearchParams({
        code,
        client_id:     clientId,
        client_secret: clientSecret,
        redirect_uri:  redirectUri,
      }),
    });
    tokenData = await tokenRes.json() as SlackOAuthResponse;
  } catch {
    return back("exchange_failed");
  }

  if (!tokenData.ok || !tokenData.access_token) return back("exchange_failed");

  // ── 4. Persist token + team id ────────────────────────────────────────────
  const { error: updateError } = await admin
    .from("workspaces")
    .update({
      slack_bot_token:    tokenData.access_token,
      slack_team_id:      tokenData.team?.id   ?? null,
      slack_team_name:    tokenData.team?.name  ?? null,
      slack_connected_at: new Date().toISOString(),
    })
    .eq("id", workspaceId);

  if (updateError) return back("save_failed");

  const res = NextResponse.redirect(`${origin}/integrations?slack=connected`);
  res.cookies.delete("slack_oauth_state");
  return res;
}
