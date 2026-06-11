import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";

type RawItem = {
  id:                  string;
  status:              string;
  priority:            string;
  ai_classification:   string | null;
  ai_key_question:     string | null;
  ai_summary:          string | null;
  ai_risk_flag:        boolean | null;
  ai_suggested_action: string | null;
  owner_name:          string | null;
  project_id:          string | null;
  created_at:          string;
  updated_at:          string;
  project:             { name: string } | { name: string }[] | null;
};

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const { data: membership } = await admin
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", user.id)
    .limit(1).single();

  const workspaceId = (membership as { workspace_id: string } | null)?.workspace_id;
  if (!workspaceId) return NextResponse.json({ items: [] });

  const { data: rows } = await admin
    .from("feedback_items")
    .select(`
      id, status, priority, ai_classification, ai_key_question, ai_summary,
      ai_risk_flag, ai_suggested_action, owner_name, project_id,
      created_at, updated_at,
      project:projects!project_id(name)
    `)
    .eq("workspace_id", workspaceId)
    .in("status", ["open", "needs_decision", "blocked"])
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(200);

  const items = (rows ?? []).map((item: RawItem) => {
    const project = item.project
      ? (Array.isArray(item.project) ? item.project[0] : item.project)
      : null;
    return {
      id:                  item.id,
      status:              item.status,
      priority:            item.priority,
      ai_classification:   item.ai_classification,
      ai_key_question:     item.ai_key_question,
      ai_summary:          item.ai_summary,
      ai_risk_flag:        item.ai_risk_flag,
      ai_suggested_action: item.ai_suggested_action,
      owner_name:          item.owner_name,
      project_id:          item.project_id,
      project_name:        (project as { name?: string } | null)?.name ?? null,
      created_at:          item.created_at,
      source:              "figma" as const,
    };
  });

  return NextResponse.json({ items });
}
