import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();

  const { data } = await admin
    .from("feedback_items")
    .select(`
      id,
      figma_comment:figma_comments(
        figma_comment_id,
        figma_order_id,
        parent_figma_comment_id,
        raw_content
      )
    `)
    .limit(5)
    .order("created_at", { ascending: false });

  return NextResponse.json(data);
}
