import { NextResponse } from "next/server";
import { getWorkspace } from "@/lib/workspace";

const JIRA_SCOPES = "read:jira-work read:jira-user offline_access";

export async function GET() {
  const ctx = await getWorkspace();
  if (!ctx) return NextResponse.redirect("/login");

  const state = Buffer.from(JSON.stringify({ wid: ctx.workspace.id, n: Math.random() })).toString("base64url");
  const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL}/api/integrations/jira/oauth/callback`;

  const url = new URL("https://auth.atlassian.com/authorize");
  url.searchParams.set("audience",       "api.atlassian.com");
  url.searchParams.set("client_id",      process.env.JIRA_CLIENT_ID!);
  url.searchParams.set("scope",          JIRA_SCOPES);
  url.searchParams.set("redirect_uri",   redirectUri);
  url.searchParams.set("state",          state);
  url.searchParams.set("response_type",  "code");
  url.searchParams.set("prompt",         "consent");

  return NextResponse.redirect(url.toString());
}
