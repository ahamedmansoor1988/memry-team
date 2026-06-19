import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";

export async function GET(req: NextRequest) {
  const reqUrl          = new URL(req.url);
  const origin          = reqUrl.origin;
  const redirectUri     = `${origin}/api/integrations/jira/oauth/callback`;
  const integrationsUrl = `${origin}/integrations`;

  const code  = reqUrl.searchParams.get("code");
  const state = reqUrl.searchParams.get("state");
  const err   = reqUrl.searchParams.get("error");

  if (err || !code || !state) {
    return NextResponse.redirect(`${integrationsUrl}?error=jira_denied`);
  }

  let workspaceId: string;
  try {
    workspaceId = JSON.parse(Buffer.from(state, "base64url").toString("utf8")).wid;
  } catch {
    return NextResponse.redirect(`${integrationsUrl}?error=jira_state`);
  }

  // Exchange code for tokens
  const tokenRes = await fetch("https://auth.atlassian.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type:    "authorization_code",
      client_id:     process.env.JIRA_CLIENT_ID!,
      client_secret: process.env.JIRA_CLIENT_SECRET!,
      code,
      redirect_uri:  redirectUri,
    }),
  });
  const tokenData = await tokenRes.json() as {
    access_token?: string;
    refresh_token?: string;
    error?: string;
  };

  if (!tokenData.access_token) {
    console.error("[jira-oauth] token exchange failed:", tokenData.error);
    return NextResponse.redirect(`${integrationsUrl}?error=jira_token`);
  }

  // Get the first accessible Jira cloud ID
  const resourcesRes = await fetch("https://api.atlassian.com/oauth/token/accessible-resources", {
    headers: { Authorization: `Bearer ${tokenData.access_token}`, Accept: "application/json" },
  });
  const resources = await resourcesRes.json() as Array<{ id: string; name: string }>;
  const cloudId = resources[0]?.id ?? null;

  const admin = createAdminClient();
  await admin.from("workspaces").update({
    jira_access_token:  tokenData.access_token,
    jira_refresh_token: tokenData.refresh_token ?? null,
    jira_cloud_id:      cloudId,
    jira_connected_at:  new Date().toISOString(),
  }).eq("id", workspaceId);

  return NextResponse.redirect(`${integrationsUrl}?connected=jira`);
}
