import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";

type ItemRow = {
  id:                string;
  status:            string;
  ai_classification: string | null;
  ai_risk_flag:      boolean | null;
  waiting_since:     string | null;
  blocked_since:     string | null;
  created_at:        string;
  project_id:        string | null;
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
  if (!workspaceId) return NextResponse.json({ projects: [] });

  const { data: projects } = await admin
    .from("projects")
    .select("id, name")
    .eq("workspace_id", workspaceId)
    .is("deleted_at", null);

  if (!projects?.length) return NextResponse.json({ projects: [] });

  const { data: items } = await admin
    .from("feedback_items")
    .select("id, status, ai_classification, ai_risk_flag, waiting_since, blocked_since, created_at, project_id")
    .eq("workspace_id", workspaceId)
    .is("deleted_at", null);

  const now = Date.now();
  const allItems = (items ?? []) as ItemRow[];

  const result = projects.map(project => {
    const pItems   = allItems.filter(i => i.project_id === project.id);
    const open     = pItems.filter(i => i.status === "open" || i.status === "needs_decision");
    const resolved = pItems.filter(i => i.status === "resolved");
    const blocked  = pItems.filter(i => i.ai_classification === "Blocked");
    const risks    = pItems.filter(i => i.ai_risk_flag);

    const avgWaitMs = open.length > 0
      ? open.reduce((sum, i) => {
          const since = i.waiting_since ?? i.created_at;
          return sum + (now - new Date(since).getTime());
        }, 0) / open.length
      : 0;
    const avgWaitDays = Math.floor(avgWaitMs / (1000 * 60 * 60 * 24));

    const resolutionRate = pItems.length > 0
      ? Math.round((resolved.length / pItems.length) * 100)
      : 0;

    const health = Math.max(
      0,
      100 - (blocked.length * 20) - (risks.length * 10) - (avgWaitDays > 7 ? 15 : 0)
    );

    return {
      id:              project.id,
      name:            project.name,
      total:           pItems.length,
      open:            open.length,
      resolved:        resolved.length,
      blocked:         blocked.length,
      risk_flags:      risks.length,
      avg_wait_days:   avgWaitDays,
      resolution_rate: resolutionRate,
      health,
    };
  }).sort((a, b) => a.health - b.health);

  return NextResponse.json({ projects: result });
}
