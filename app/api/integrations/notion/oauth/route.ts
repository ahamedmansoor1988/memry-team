import { NextResponse } from "next/server";
import { getWorkspace } from "@/lib/workspace";

export async function GET() {
  const ctx = await getWorkspace();
  if (!ctx) return NextResponse.redirect("/login");

  const state = Buffer.from(JSON.stringify({ wid: ctx.workspace.id, n: Math.random() })).toString("base64url");
  const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL}/api/integrations/notion/oauth/callback`;

  const url = new URL("https://api.notion.com/v1/oauth/authorize");
  url.searchParams.set("client_id",    process.env.NOTION_CLIENT_ID!);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("owner",         "user");
  url.searchParams.set("redirect_uri",  redirectUri);
  url.searchParams.set("state",         state);

  return NextResponse.redirect(url.toString());
}
