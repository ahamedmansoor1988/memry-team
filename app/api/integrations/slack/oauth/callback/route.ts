import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";

export async function GET(req: NextRequest) {
  const reqUrl       = new URL(req.url);
  const origin       = reqUrl.origin;
  const redirectUri  = `${origin}/api/integrations/slack/oauth/callback`;
  const integrationsUrl = `${origin}/integrations`;

  const code  = reqUrl.searchParams.get("code");
  const state = reqUrl.searchParams.get("state");
  const err   = reqUrl.searchParams.get("error");

  if (err || !code || !state) {
    return NextResponse.redirect(`${integrationsUrl}?error=slack_denied`);
  }

  let workspaceId: string;
  let returnTo = "";
  try {
    const decoded = Buffer.from(state, "base64url").toString("utf8");
    try {
      const parsed = JSON.parse(decoded);
      workspaceId = parsed.wid;
      returnTo = parsed.rt ?? "";
    } catch {
      // legacy format — plain workspace ID
      workspaceId = decoded;
    }
  } catch {
    return NextResponse.redirect(`${integrationsUrl}?error=slack_state`);
  }

  const tokenRes = await fetch("https://slack.com/api/oauth.v2.access", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id:     process.env.SLACK_CLIENT_ID!,
      client_secret: process.env.SLACK_CLIENT_SECRET!,
      redirect_uri:  redirectUri,
      code,
    }),
  });
  const tokenData = await tokenRes.json() as {
    ok: boolean;
    access_token?: string;
    team?: { id: string; name: string };
    error?: string;
  };

  if (!tokenData.ok || !tokenData.access_token) {
    console.error("[slack-oauth] token exchange failed:", tokenData.error);
    return NextResponse.redirect(`${integrationsUrl}?error=slack_token`);
  }

  const admin = createAdminClient();
  await admin.from("workspaces").update({
    slack_bot_token:     tokenData.access_token,
    slack_team_id:       tokenData.team?.id ?? null,
    slack_team_name:     tokenData.team?.name ?? null,
    slack_connected_at:  new Date().toISOString(),
    slack_signing_secret: process.env.SLACK_SIGNING_SECRET ?? null,
  }).eq("id", workspaceId);

  const successUrl = returnTo ? `${origin}${returnTo}?connected=slack` : `${integrationsUrl}?connected=slack`;
  return NextResponse.redirect(successUrl);
}
