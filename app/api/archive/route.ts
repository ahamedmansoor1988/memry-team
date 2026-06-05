import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";

export async function GET() {
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

  const { data: items, error } = await admin
    .from("feedback_items")
    .select(`
      id, deleted_at, ai_classification, status, created_at,
      figma_comment:figma_comments(
        author_name, raw_content, figma_created_at,
        figma_file:figma_files(name)
      ),
      project:projects(id, name)
    `)
    .eq("workspace_id", membership.workspace_id)
    .not("deleted_at", "is", null)
    .order("deleted_at", { ascending: false });

  if (error) {
    console.error("[archive] query failed:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Normalize figma_comment (Supabase returns FK joins as array or object)
  const normalized = (items ?? []).map(item => {
    const fc = Array.isArray(item.figma_comment) ? item.figma_comment[0] : item.figma_comment;
    const fcWithFile = fc ? {
      ...fc,
      figma_file: Array.isArray(fc.figma_file) ? fc.figma_file[0] : fc.figma_file,
    } : null;
    return { ...item, figma_comment: fcWithFile ?? null };
  });

  return NextResponse.json({ items: normalized });
}
