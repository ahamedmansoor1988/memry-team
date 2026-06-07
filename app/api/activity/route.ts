/**
 * GET /api/activity
 *
 * Returns real status-change events from feedback_item_status_history,
 * enriched with the item's AI metadata and project name.
 *
 * Query params:
 *   limit  — max rows (default 50, capped at 100)
 *   offset — pagination offset (default 0)
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();

  const { data: membership } = await admin
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", user.id)
    .limit(1)
    .single();

  const workspaceId = (membership as { workspace_id: string } | null)?.workspace_id;
  if (!workspaceId) return NextResponse.json({ events: [] });

  const url    = new URL(req.url);
  const limit  = Math.min(Number(url.searchParams.get("limit")  ?? 50), 100);
  const offset = Number(url.searchParams.get("offset") ?? 0);

  const { data: rows, error } = await admin
    .from("feedback_item_status_history")
    .select(`
      id, from_status, to_status, reason, changed_by, created_at,
      item:feedback_items!item_id(
        id, ai_key_question, ai_summary, ai_classification, project_id,
        project:projects!project_id(name)
      )
    `)
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  type RawRow = {
    id: string;
    from_status: string;
    to_status: string;
    reason: string | null;
    changed_by: string | null;
    created_at: string;
    item:
      | { id: string; ai_key_question: string | null; ai_summary: string | null; ai_classification: string | null; project_id: string | null; project: { name: string } | { name: string }[] | null }
      | { id: string; ai_key_question: string | null; ai_summary: string | null; ai_classification: string | null; project_id: string | null; project: { name: string } | { name: string }[] | null }[]
      | null;
  };

  const events = ((rows ?? []) as RawRow[]).map(r => {
    const item    = Array.isArray(r.item) ? r.item[0] : r.item;
    const project = item?.project
      ? Array.isArray(item.project) ? item.project[0] : item.project
      : null;
    return {
      id:                r.id,
      from_status:       r.from_status,
      to_status:         r.to_status,
      reason:            r.reason,
      changed_by:        r.changed_by,
      created_at:        r.created_at,
      item_id:           item?.id ?? null,
      ai_key_question:   item?.ai_key_question ?? null,
      ai_summary:        item?.ai_summary ?? null,
      ai_classification: item?.ai_classification ?? null,
      project_id:        item?.project_id ?? null,
      project_name:      (project as { name?: string } | null)?.name ?? null,
    };
  });

  return NextResponse.json({ events, total: events.length });
}
