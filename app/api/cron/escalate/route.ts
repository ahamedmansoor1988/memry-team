import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";

export async function GET(req: Request) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();

  // Get all workspaces
  const { data: workspaces } = await admin
    .from("workspaces")
    .select("id");

  if (!workspaces?.length) return NextResponse.json({ escalated: 0 });

  const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
  let totalEscalated = 0;

  for (const ws of workspaces) {
    const { data: items } = await admin
      .from("feedback_items")
      .select("id, workspace_id, owner_profile_id, ai_key_question, ai_summary")
      .eq("workspace_id", ws.id)
      .eq("status", "blocked")
      .lt("blocked_since", fiveDaysAgo)
      .is("escalated_at", null)
      .is("deleted_at", null);

    if (!items?.length) continue;

    for (const item of items) {
      const now = new Date().toISOString();

      await admin
        .from("feedback_items")
        .update({ escalated_at: now, ai_classification: "critical" })
        .eq("id", item.id);

      await admin.from("feedback_item_status_history").insert({
        item_id: item.id,
        workspace_id: item.workspace_id,
        from_status: "blocked",
        to_status: "blocked",
        reason: "Auto-escalated: blocked for 5+ days",
        changed_by: null, // system action — column is uuid FK to auth.users
      });

      if (item.owner_profile_id) {
        await admin.from("notifications").insert({
          type: "escalated",
          title: "Item escalated to critical",
          body: item.ai_key_question ?? item.ai_summary ?? null,
          feedback_item_id: item.id,
          workspace_id: item.workspace_id,
          user_id: item.owner_profile_id,
        });
      }

      totalEscalated++;
    }
  }

  return NextResponse.json({ escalated: totalEscalated });
}
