import { NextRequest, NextResponse } from "next/server";
import { getWorkspace } from "@/lib/workspace";

const SLACK_SCOPES = [
  "channels:history",
  "chat:write",
  "commands",
  "users:read",
  "channels:read",
].join(",");

export async function GET(req: NextRequest) {
  const ctx = await getWorkspace();
  if (!ctx) return NextResponse.redirect("/login");

  const returnTo = new URL(req.url).searchParams.get("returnTo") ?? "";
  const state = Buffer.from(JSON.stringify({ wid: ctx.workspace.id, rt: returnTo })).toString("base64url");

  // Derive redirect URI from the actual incoming request so it always matches
  // what's registered in Slack regardless of which domain the app is accessed from.
  const origin = new URL(req.url).origin;
  const redirectUri = `${origin}/api/integrations/slack/oauth/callback`;

  const url = new URL("https://slack.com/oauth/v2/authorize");
  url.searchParams.set("client_id", process.env.SLACK_CLIENT_ID!);
  url.searchParams.set("scope", SLACK_SCOPES);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);

  return NextResponse.redirect(url.toString());
}
