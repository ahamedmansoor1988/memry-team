import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getWorkspace } from "@/lib/workspace";

export async function POST(req: NextRequest) {
  const ctx = await getWorkspace();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { token } = await req.json() as { token?: string };
  if (!token?.trim()) {
    return NextResponse.json({ error: "Token is required" }, { status: 400 });
  }

  // Verify token by fetching the bot user
  const verifyRes = await fetch("https://api.notion.com/v1/users/me", {
    headers: {
      Authorization:    `Bearer ${token.trim()}`,
      "Notion-Version": "2022-06-28",
    },
  });
  if (!verifyRes.ok) {
    const body = await verifyRes.text();
    console.error("[notion/connect] token verify failed:", verifyRes.status, body);
    return NextResponse.json(
      { error: "Invalid Notion token — please check and try again" },
      { status: 400 },
    );
  }

  const admin = createAdminClient();
  const { error } = await admin.from("workspaces").update({
    notion_access_token: token.trim(),
    notion_connected_at: new Date().toISOString(),
  }).eq("id", ctx.workspace.id);

  if (error) {
    return NextResponse.json({ error: "Failed to save Notion token" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
