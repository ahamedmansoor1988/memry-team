import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";

export async function GET(req: Request) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();

  const sevenDaysAgo   = new Date(Date.now() - 7  * 24 * 60 * 60 * 1000).toISOString();
  const thirtyDaysAgo  = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const now = new Date().toISOString();

  // 1. Archive resolved items older than 7 days
  const { data: resolvedItems } = await admin
    .from("feedback_items")
    .select("id")
    .eq("status", "resolved")
    .lt("updated_at", sevenDaysAgo)
    .is("deleted_at", null);

  let archivedResolved = 0;
  for (const item of resolvedItems ?? []) {
    await admin.from("feedback_items").update({ deleted_at: now }).eq("id", item.id);
    await admin.from("feedback_item_status_history").insert({
      feedback_item_id: item.id,
      from_status: "resolved",
      to_status: "archived",
      reason: "Auto-archived: resolved for 7+ days",
      changed_by: "system",
    });
    archivedResolved++;
  }

  // 2. Archive stale items older than 30 days
  const { data: staleItems } = await admin
    .from("feedback_items")
    .select("id")
    .eq("status", "stale")
    .lt("updated_at", thirtyDaysAgo)
    .is("deleted_at", null);

  let archivedStale = 0;
  for (const item of staleItems ?? []) {
    await admin.from("feedback_items").update({ deleted_at: now }).eq("id", item.id);
    await admin.from("feedback_item_status_history").insert({
      feedback_item_id: item.id,
      from_status: "stale",
      to_status: "archived",
      reason: "Auto-archived: stale for 30+ days",
      changed_by: "system",
    });
    archivedStale++;
  }

  return NextResponse.json({ archived_resolved: archivedResolved, archived_stale: archivedStale });
}
