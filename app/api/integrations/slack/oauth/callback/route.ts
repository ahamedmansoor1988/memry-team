import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL!;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code  = searchParams.get("code");
  const state = searchParams.get("state");
  const err   = searchParams.get("error");

  if (err || !code || !state) {
    return NextResponse.redirect(`${APP_URL}/integrations?error=slack_denied`);
  }

  let workspaceId: string;
  try {
    workspaceId = Buffer.from(state, "base64url").toString("utf8");
  } catch {
    return NextResponse.redirect(`${APP_URL}/integrations?error=slack_state`);
  }

  const tokenRes = await fetch("https://slack.com/api/oauth.v2.access", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id:     process.env.SLACK_CLIENT_ID!,
      client_secret: process.env.SLACK_CLIENT_SECRET!,
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
    return NextResponse.redirect(`${APP_URL}/integrations?error=slack_token`);
  }

  const admin = createAdminClient();
  await admin.from("workspaces").update({
    slack_bot_token:    tokenData.access_token,
    slack_team_id:      tokenData.team?.id ?? null,
    slack_team_name:    tokenData.team?.name ?? null,
    slack_connected_at: new Date().toISOString(),
  }).eq("id", workspaceId);

  return NextResponse.redirect(`${APP_URL}/integrations?connected=slack`);
}
