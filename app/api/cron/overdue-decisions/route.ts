import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";

export async function GET(req: Request) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();

  const { data: workspaces } = await admin
    .from("workspaces")
    .select("id");

  if (!workspaces?.length) return NextResponse.json({ flagged: 0 });

  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
  let totalFlagged = 0;

  for (const ws of workspaces) {
    const { data: items } = await admin
      .from("feedback_items")
      .select("id, workspace_id, owner_profile_id, ai_key_question, ai_summary")
      .eq("workspace_id", ws.id)
      .eq("status", "needs_decision")
      .lt("updated_at", threeDaysAgo)
      .is("overdue_decision_at", null)
      .is("deleted_at", null);

    if (!items?.length) continue;

    for (const item of items) {
      const now = new Date().toISOString();

      await admin
        .from("feedback_items")
        .update({ overdue_decision_at: now })
        .eq("id", item.id);

      await admin.from("feedback_item_status_history").insert({
        item_id: item.id,
        workspace_id: item.workspace_id,
        from_status: "needs_decision",
        to_status: "needs_decision",
        reason: "Auto-flagged: decision overdue for 3+ days",
        changed_by: null, // system action — column is uuid FK to auth.users
      });

      if (item.owner_profile_id) {
        await admin.from("notifications").insert({
          type: "decision_overdue",
          title: "Decision overdue",
          body: item.ai_key_question ?? item.ai_summary ?? null,
          feedback_item_id: item.id,
          workspace_id: item.workspace_id,
          user_id: item.owner_profile_id,
        });
      }

      totalFlagged++;
    }
  }

  return NextResponse.json({ flagged: totalFlagged });
}
