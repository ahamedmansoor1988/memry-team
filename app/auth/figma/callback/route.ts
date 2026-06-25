import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";

export async function GET(req: NextRequest) {
  const { searchParams, origin } = new URL(req.url);
  const code  = searchParams.get("code");
  const state = searchParams.get("state"); // user id

  if (!code || !state) {
    return NextResponse.redirect(`${origin}/agents?error=figma_auth_failed`);
  }

  // Exchange code for token
  const tokenRes = await fetch("https://api.figma.com/v1/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id:     process.env.FIGMA_CLIENT_ID!,
      client_secret: process.env.FIGMA_CLIENT_SECRET!,
      redirect_uri:  process.env.FIGMA_REDIRECT_URI!,
      code,
      grant_type:    "authorization_code",
    }),
  });

  if (!tokenRes.ok) {
    return NextResponse.redirect(`${origin}/agents?error=figma_token_failed`);
  }

  const token = await tokenRes.json() as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    user_id: string;
    email: string;
  };

  // Save token to workspace
  const admin = createAdminClient();
  const { data: member } = await admin
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", state)
    .maybeSingle();

  if (!member?.workspace_id) {
    return NextResponse.redirect(`${origin}/agents?error=no_workspace`);
  }

  await admin.from("workspaces").update({
    figma_access_token:    token.access_token,
    figma_refresh_token:   token.refresh_token,
    figma_token_expires_at: new Date(Date.now() + token.expires_in * 1000).toISOString(),
    figma_user_id:         token.user_id,
    figma_user_email:      token.email,
    figma_connected_at:    new Date().toISOString(),
  }).eq("id", member.workspace_id);

  return NextResponse.redirect(`${origin}/agents/figma-compare?figma_connected=1`);
}
