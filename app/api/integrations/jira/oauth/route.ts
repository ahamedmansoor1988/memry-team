import { NextRequest, NextResponse } from "next/server";
import { getWorkspace } from "@/lib/workspace";

const JIRA_SCOPES = "read:jira-work read:jira-user offline_access";

export async function GET(req: NextRequest) {
  const ctx = await getWorkspace();
  if (!ctx) return NextResponse.redirect("/login");

  const origin      = new URL(req.url).origin;
  const redirectUri = `${origin}/api/integrations/jira/oauth/callback`;
  const returnTo    = new URL(req.url).searchParams.get("returnTo") ?? "";
  const state       = Buffer.from(JSON.stringify({ wid: ctx.workspace.id, rt: returnTo, n: Math.random() })).toString("base64url");

  const url = new URL("https://auth.atlassian.com/authorize");
  url.searchParams.set("audience",      "api.atlassian.com");
  url.searchParams.set("client_id",     process.env.JIRA_CLIENT_ID!);
  url.searchParams.set("scope",         JIRA_SCOPES);
  url.searchParams.set("redirect_uri",  redirectUri);
  url.searchParams.set("state",         state);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("prompt",        "consent");

  return NextResponse.redirect(url.toString());
}
