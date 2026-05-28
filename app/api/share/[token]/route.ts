import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";

// Public endpoint — no auth required
// Token = workspace_id (simple approach, can be a real token later)
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const admin = createAdminClient();

  // Resolve token → workspace
  const { data: workspace } = await admin
    .from("workspaces")
    .select("id, name")
    .eq("id", token)
    .single();

  if (!workspace) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { data: items } = await admin
    .from("feedback_items")
    .select(`
      id, status, priority, ai_summary, ai_classification,
      ai_key_question, ai_tags, ai_risk_flag, ai_vague_flag, created_at,
      figma_comment:figma_comments(author_name, raw_content, figma_created_at,
        figma_file:figma_files(name)),
      project:projects(id, name)
    `)
    .eq("workspace_id", workspace.id)
    .order("created_at", { ascending: false });

  const { data: projects } = await admin
    .from("projects")
    .select("id, name")
    .eq("workspace_id", workspace.id);

  return NextResponse.json({
    workspace: { name: workspace.name },
    items: items ?? [],
    projects: projects ?? [],
  });
}
