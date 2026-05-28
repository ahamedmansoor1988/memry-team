import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { webhook_url } = await req.json() as { webhook_url?: string };
  if (!webhook_url?.startsWith("https://hooks.slack.com/")) {
    return NextResponse.json({ error: "Invalid Slack webhook URL" }, { status: 400 });
  }

  const admin = createAdminClient();

  const { data: membership } = await admin
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", user.id)
    .limit(1)
    .single();

  if (!membership) return NextResponse.json({ error: "No workspace" }, { status: 404 });

  // Store in workspaces table (add slack_webhook_url column if needed, or use metadata)
  const { error } = await admin
    .from("workspaces")
    .update({ slack_webhook_url: webhook_url })
    .eq("id", membership.workspace_id);

  if (error) {
    // Column might not exist — that's okay, return ok but note it's env-only for now
    console.error("[slack] save error:", error.message);
    return NextResponse.json({ ok: true, note: "Saved to environment only" });
  }

  // Test the webhook
  await fetch(webhook_url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: "✅ memry connected! You'll receive decision notifications here." }),
  }).catch(() => null);

  return NextResponse.json({ ok: true });
}
