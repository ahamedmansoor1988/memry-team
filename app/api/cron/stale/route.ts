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

  if (!workspaces?.length) return NextResponse.json({ marked_stale: 0 });

  const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
  let totalStale = 0;

  for (const ws of workspaces) {
    const { data: items } = await admin
      .from("feedback_items")
      .select("id, workspace_id")
      .eq("workspace_id", ws.id)
      .eq("status", "open")
      .lt("updated_at", fourteenDaysAgo)
      .is("stale_at", null)
      .is("deleted_at", null);

    if (!items?.length) continue;

    for (const item of items) {
      const now = new Date().toISOString();

      await admin
        .from("feedback_items")
        .update({ stale_at: now, status: "stale" })
        .eq("id", item.id);

      await admin.from("feedback_item_status_history").insert({
        feedback_item_id: item.id,
        from_status: "open",
        to_status: "stale",
        reason: "Auto-marked stale: no activity for 14 days",
        changed_by: "system",
      });

      totalStale++;
    }
  }

  return NextResponse.json({ marked_stale: totalStale });
}
