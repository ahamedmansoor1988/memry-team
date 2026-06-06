/**
 * GET /api/decisions
 * Lists all extracted decisions for the authenticated user's workspace,
 * newest first, with feedback item and owner profile joins.
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";

export async function GET(_req: NextRequest) {
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

  if (!membership) return NextResponse.json({ error: "No workspace" }, { status: 400 });

  const { data: decisions, error } = await admin
    .from("decisions")
    .select(`
      id, decision_text, reason, owner_name, source, decided_at, feedback_item_id,
      feedback_item:feedback_items(
        id, project_id, ai_key_question,
        project:projects(id, name)
      ),
      owner_profile:profiles(display_name, figma_handle)
    `)
    .eq("workspace_id", (membership as { workspace_id: string }).workspace_id)
    .order("decided_at", { ascending: false });

  if (error) {
    // Table may not exist yet if migration hasn't been run — return empty gracefully
    console.error("[decisions] fetch error:", error.message);
    return NextResponse.json({ decisions: [] });
  }

  return NextResponse.json({ decisions: decisions ?? [] });
}
