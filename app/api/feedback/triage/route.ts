import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";

type RawItem = {
  id:                string;
  status:            string;
  priority:          string;
  ai_classification: string | null;
  ai_key_question:   string | null;
  ai_summary:        string | null;
  ai_risk_flag:      boolean | null;
  waiting_since:     string | null;
  blocked_since:     string | null;
  created_at:        string;
  updated_at:        string;
  owner_name:        string | null;
  project_id:        string | null;
  project:           { name: string } | { name: string }[] | null;
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
  if (!workspaceId) return NextResponse.json({ triage: [] });

  const { data: rows } = await admin
    .from("feedback_items")
    .select(`
      id, status, priority, ai_classification, ai_key_question, ai_summary,
      ai_risk_flag, waiting_since, blocked_since, created_at, updated_at,
      owner_name, project_id,
      project:projects!project_id(name)
    `)
    .eq("workspace_id", workspaceId)
    .in("status", ["open", "needs_decision"])
    .is("deleted_at", null)
    .order("updated_at", { ascending: true })
    .limit(50);

  const now = Date.now();

  const scored = (rows ?? []).map((item: RawItem) => {
    const project = item.project
      ? (Array.isArray(item.project) ? item.project[0] : item.project)
      : null;

    let score = 0;

    // Classification score
    if (item.ai_classification === "Blocked")        score += 40;
    if (item.ai_classification === "Needs Decision") score += 25;
    if (item.ai_classification === "Risk")           score += 20;

    // Priority score
    if (item.priority === "high")   score += 20;
    if (item.priority === "medium") score += 10;

    // Risk flag
    if (item.ai_risk_flag) score += 15;

    // Age score — older unresolved = more urgent
    const ageDays = Math.floor((now - new Date(item.created_at).getTime()) / (1000 * 60 * 60 * 24));
    score += Math.min(ageDays * 2, 20);

    // Waiting/blocked time bonus
    if (item.waiting_since) {
      const waitDays = Math.floor((now - new Date(item.waiting_since).getTime()) / (1000 * 60 * 60 * 24));
      score += Math.min(waitDays * 3, 15);
    }
    if (item.blocked_since) {
      const blockDays = Math.floor((now - new Date(item.blocked_since).getTime()) / (1000 * 60 * 60 * 24));
      score += Math.min(blockDays * 5, 20);
    }

    return {
      id:                item.id,
      score,
      status:            item.status,
      priority:          item.priority,
      ai_classification: item.ai_classification,
      ai_key_question:   item.ai_key_question,
      ai_summary:        item.ai_summary,
      ai_risk_flag:      item.ai_risk_flag,
      owner_name:        item.owner_name,
      project_id:        item.project_id,
      project_name:      (project as { name?: string } | null)?.name ?? null,
      age_days:          ageDays,
    };
  });

  const triage = scored
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  return NextResponse.json({ triage });
}
