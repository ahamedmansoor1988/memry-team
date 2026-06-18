import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getWorkspace } from "@/lib/workspace";

export async function POST() {
  const ctx = await getWorkspace();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  await admin.from("workspaces").update({
    slack_bot_token:    null,
    slack_team_id:      null,
    slack_team_name:    null,
    slack_connected_at: null,
  }).eq("id", ctx.workspace.id);

  return NextResponse.json({ ok: true });
}
