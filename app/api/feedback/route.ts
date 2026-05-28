import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("projectId");

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

  if (!membership) return NextResponse.json({ items: [] });

  let query = admin
    .from("feedback_items")
    .select(`
      id, status, priority, ai_summary, ai_classification,
      ai_key_question, ai_tags, ai_risk_flag, ai_vague_flag,
      figma_node_id, figma_preview_url, created_at,
      design_reference:design_references(
        id, file_key, node_id, frame_name, page_name,
        thumbnail_url, preview_status
      ),
      figma_comment:figma_comments(
        id, author_name, author_avatar, raw_content,
        figma_created_at, parent_figma_comment_id,
        figma_comment_id, figma_order_id, page_name, frame_name,
        figma_file:figma_files(id, name, figma_file_key)
      ),
      project:projects(id, name)
    `)
    .eq("workspace_id", membership.workspace_id)
    .order("created_at", { ascending: false });

  if (projectId) {
    query = query.eq("project_id", projectId);
  }

  const { data: items } = await query;

  if (!items?.length) return NextResponse.json({ items: [] });

  // Batch-fetch replies
  const figmaCommentIds = items
    .map(i => {
      const fc = Array.isArray(i.figma_comment) ? i.figma_comment[0] : i.figma_comment;
      return (fc as { id?: string } | null)?.id;
    })
    .filter(Boolean) as string[];

  const { data: replies } = figmaCommentIds.length > 0
    ? await admin
        .from("figma_comments")
        .select("id, author_name, raw_content, figma_created_at, parent_figma_comment_id")
        .in("parent_figma_comment_id", figmaCommentIds)
        .order("figma_created_at", { ascending: true })
    : { data: [] };

  const itemsWithReplies = items.map(item => {
    // Normalize joins — Supabase can return them as array or object
    const fc = Array.isArray(item.figma_comment) ? item.figma_comment[0] : item.figma_comment;
    const dr = Array.isArray(item.design_reference) ? item.design_reference[0] : item.design_reference;
    const fcId = (fc as { id?: string } | null)?.id;
    const itemReplies = (replies ?? []).filter(r => r.parent_figma_comment_id === fcId);

    // Resolve best preview URL: design_reference thumbnail > figma_preview_url
    const drAny = dr as Record<string, unknown> | null;
    const resolvedPreviewUrl =
      (drAny?.preview_status === "ready" && drAny?.thumbnail_url)
        ? String(drAny.thumbnail_url)
        : (item.figma_preview_url ?? null);

    return {
      ...item,
      figma_comment: fc,          // always a single object, never array
      design_reference: dr ?? null,
      figma_preview_url: resolvedPreviewUrl,
      replies: itemReplies,
    };
  });

  return NextResponse.json({ items: itemsWithReplies });
}
