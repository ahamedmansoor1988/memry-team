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
      figma_comment:figma_comments(
        id, author_name, author_avatar, raw_content,
        figma_created_at, parent_figma_comment_id,
        figma_comment_id, figma_order_id, page_name,
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
    const fc = Array.isArray(item.figma_comment) ? item.figma_comment[0] : item.figma_comment;
    const fcId = (fc as { id?: string } | null)?.id;
    const itemReplies = (replies ?? []).filter(r => r.parent_figma_comment_id === fcId);
    return { ...item, replies: itemReplies };
  });

  return NextResponse.json({ items: itemsWithReplies });
}
