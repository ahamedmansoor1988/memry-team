/**
 * POST /api/archive/:id/restore
 *
 * Restores a soft-deleted feedback item and its linked figma_comment back to
 * active state (status: "open", deleted_at: null).
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

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
  if (!workspaceId) return NextResponse.json({ error: "No workspace" }, { status: 400 });

  // Load the item to get the linked figma_comment_id
  const { data: item } = await admin
    .from("feedback_items")
    .select("figma_comment_id")
    .eq("id", id)
    .eq("workspace_id", workspaceId)
    .single();

  // Restore the feedback_item
  const { error: updateErr } = await admin
    .from("feedback_items")
    .update({ deleted_at: null, status: "open", updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("workspace_id", workspaceId);

  if (updateErr) {
    console.error("[archive/restore] update failed:", updateErr.message);
    return NextResponse.json({ error: "Restore failed" }, { status: 500 });
  }

  // Also restore the linked figma_comment (best-effort)
  const figmaCommentId = (item as { figma_comment_id?: string | null } | null)?.figma_comment_id;
  if (figmaCommentId) {
    await admin
      .from("figma_comments")
      .update({ deleted_at: null })
      .eq("id", figmaCommentId);
  }

  return NextResponse.json({ ok: true });
}
