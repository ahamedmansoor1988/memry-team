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

  const admin = createAdminClient();
  const { error: upsertError } = await admin.from("figma_connections").upsert({
    user_id:           state,
    access_token:      token.access_token,
    refresh_token:     token.refresh_token,
    expires_at:        new Date(Date.now() + token.expires_in * 1000).toISOString(),
    figma_user_id:     token.user_id,
    figma_user_email:  token.email,
    connected_at:      new Date().toISOString(),
  });
  if (upsertError) {
    return NextResponse.redirect(`${origin}/agents/settings?error=figma_save_failed`);
  }

  return NextResponse.redirect(`${origin}/agents/settings?figma_connected=1`);
}
