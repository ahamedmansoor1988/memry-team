/**
 * PATCH /api/topics/links/[linkId]  { action: "accept" | "dismiss" | "unlink" }
 *
 * accept  — confirm a suggested link (status → active, linked_by → user)
 * dismiss — reject a suggested link (delete + remember the rejection)
 * unlink  — remove an active link   (delete + remember the rejection)
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";

export async function PATCH(
  req: NextRequest,
  { params }: { params: { linkId: string } },
) {
  const { linkId } = params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({})) as { action?: string };
  const action = body.action;
  if (!action || !["accept", "dismiss", "unlink"].includes(action)) {
    return NextResponse.json({ error: "action must be accept | dismiss | unlink" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: membership } = await admin
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", user.id)
    .limit(1).single();
  const workspaceId = (membership as { workspace_id: string } | null)?.workspace_id;
  if (!workspaceId) return NextResponse.json({ error: "No workspace" }, { status: 404 });

  const { data: link } = await admin
    .from("topic_links")
    .select("id, topic_id, item_type, item_id, workspace_id")
    .eq("id", linkId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (!link) return NextResponse.json({ error: "Link not found" }, { status: 404 });

  const l = link as { id: string; topic_id: string; item_type: string; item_id: string };

  if (action === "accept") {
    await admin.from("topic_links")
      .update({ status: "active", linked_by: "user" })
      .eq("id", l.id);
    return NextResponse.json({ ok: true, status: "active" });
  }

  // dismiss / unlink: remove + remember so the Linker never re-suggests it
  await admin.from("topic_link_rejections").upsert({
    workspace_id: workspaceId,
    item_type:    l.item_type,
    item_id:      l.item_id,
    topic_id:     l.topic_id,
  }, { onConflict: "workspace_id,item_type,item_id,topic_id" });
  await admin.from("topic_links").delete().eq("id", l.id);

  // If the topic now has fewer than 2 active members it's no longer a link —
  // clean it up so orphaned topics don't accumulate.
  const { count } = await admin
    .from("topic_links")
    .select("id", { count: "exact", head: true })
    .eq("topic_id", l.topic_id)
    .eq("status", "active");
  if ((count ?? 0) < 2) {
    await admin.from("topics").delete().eq("id", l.topic_id);
  }

  return NextResponse.json({ ok: true, status: "removed" });
}
