import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";

export async function GET(req: NextRequest) {
  const reqUrl          = new URL(req.url);
  const origin          = reqUrl.origin;
  const redirectUri     = `${origin}/api/integrations/notion/oauth/callback`;
  const integrationsUrl = `${origin}/integrations`;

  const code  = reqUrl.searchParams.get("code");
  const state = reqUrl.searchParams.get("state");
  const err   = reqUrl.searchParams.get("error");

  if (err || !code || !state) {
    return NextResponse.redirect(`${integrationsUrl}?error=notion_denied`);
  }

  let workspaceId: string;
  try {
    workspaceId = JSON.parse(Buffer.from(state, "base64url").toString("utf8")).wid;
  } catch {
    return NextResponse.redirect(`${integrationsUrl}?error=notion_state`);
  }
  const credentials = Buffer.from(
    `${process.env.NOTION_CLIENT_ID!}:${process.env.NOTION_CLIENT_SECRET!}`
  ).toString("base64");

  const tokenRes = await fetch("https://api.notion.com/v1/oauth/token", {
    method: "POST",
    headers: {
      Authorization:  `Basic ${credentials}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      grant_type:   "authorization_code",
      code,
      redirect_uri: redirectUri,
    }),
  });
  const tokenData = await tokenRes.json() as {
    access_token?: string;
    error?: string;
  };

  if (!tokenData.access_token) {
    console.error("[notion-oauth] token exchange failed:", tokenData.error);
    return NextResponse.redirect(`${integrationsUrl}?error=notion_token`);
  }

  const admin = createAdminClient();
  await admin.from("workspaces").update({
    notion_access_token: tokenData.access_token,
    notion_connected_at: new Date().toISOString(),
  }).eq("id", workspaceId);

  return NextResponse.redirect(`${integrationsUrl}?connected=notion`);
}
