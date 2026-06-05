import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ replies: [] });

  const admin = createAdminClient();

  // Get the figma_comment_id for this feedback item
  const { data: item } = await admin
    .from("feedback_items")
    .select("figma_comment:figma_comments(id)")
    .eq("id", id)
    .single();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const commentId = (item?.figma_comment as any)?.id;
  if (!commentId) return NextResponse.json({ replies: [] });

  // Fetch replies where parent_figma_comment_id = commentId, excluding soft-deleted rows
  const { data: replies } = await admin
    .from("figma_comments")
    .select("id, author_name, raw_content, figma_created_at")
    .eq("parent_figma_comment_id", commentId)
    .is("deleted_at", null)
    .order("figma_created_at", { ascending: true });

  return NextResponse.json({ replies: replies ?? [] });
}
