/**
 * GET /api/integrations/slack/oauth/start
 *
 * Kicks off the Slack OAuth v2 flow. Generates a CSRF state token (stored in an
 * httpOnly cookie), then redirects the user to Slack's authorize screen.
 *
 * Requires env: SLACK_CLIENT_ID
 * The redirect URI is derived from the request origin so it always matches the
 * domain the user is actually on — register that exact URL in the Slack app:
 *   {origin}/api/integrations/slack/oauth/callback
 */
import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";

// Bot scopes the capture pipeline needs (mirrors lib/slack/events + process-message).
const BOT_SCOPES = [
  "channels:history",
  "channels:read",
  "channels:join",
  "groups:history",
  "groups:read",
  "chat:write",
  "users:read",
  "reactions:read",
].join(",");

export async function GET(req: NextRequest) {
  const clientId = process.env.SLACK_CLIENT_ID;
  if (!clientId) {
    return NextResponse.redirect(`${req.nextUrl.origin}/integrations?slack=not_configured`);
  }

  const redirectUri = `${req.nextUrl.origin}/api/integrations/slack/oauth/callback`;
  const state = randomBytes(16).toString("hex");

  const authorizeUrl = new URL("https://slack.com/oauth/v2/authorize");
  authorizeUrl.searchParams.set("client_id", clientId);
  authorizeUrl.searchParams.set("scope", BOT_SCOPES);
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("state", state);

  const res = NextResponse.redirect(authorizeUrl.toString());
  res.cookies.set("slack_oauth_state", state, {
    httpOnly: true,
    secure:   true,
    sameSite: "lax",
    maxAge:   600, // 10 minutes
    path:     "/",
  });
  return res;
}
