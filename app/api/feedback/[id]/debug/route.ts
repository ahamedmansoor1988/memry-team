import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();

  const { data: item } = await admin
    .from("feedback_items")
    .select(`
      id,
      figma_comment:figma_comments(
        id,
        figma_comment_id,
        figma_order_id,
        parent_figma_comment_id,
        raw_content
      )
    `)
    .eq("id", id)
    .single();

  return NextResponse.json(item);
}
