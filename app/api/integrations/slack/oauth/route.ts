import { NextResponse } from "next/server";
import { getWorkspace } from "@/lib/workspace";

const SLACK_SCOPES = [
  "channels:history",
  "chat:write",
  "commands",
  "users:read",
  "channels:read",
].join(",");

export async function GET() {
  const ctx = await getWorkspace();
  if (!ctx) return NextResponse.redirect("/login");

  const state = Buffer.from(ctx.workspace.id).toString("base64url");

  const url = new URL("https://slack.com/oauth/v2/authorize");
  url.searchParams.set("client_id", process.env.SLACK_CLIENT_ID!);
  url.searchParams.set("scope", SLACK_SCOPES);
  url.searchParams.set("state", state);

  return NextResponse.redirect(url.toString());
}
