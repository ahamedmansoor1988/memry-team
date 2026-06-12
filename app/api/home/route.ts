/**
 * GET /api/home
 * Dashboard data: stat counts, items needing attention, recent decisions.
 */
import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";

type RawItem = {
  id: string;
  status: string;
  priority: string;
  ai_classification: string | null;
  ai_key_question: string | null;
  ai_summary: string | null;
  ai_risk_flag: boolean | null;
  ai_suggested_action: string | null;
  owner_name: string | null;
  project_id: string | null;
  created_at: string;
  project: { name: string } | { name: string }[] | null;
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
  if (!workspaceId) return NextResponse.json({ error: "No workspace" }, { status: 404 });

  const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();

  const [
    { data: openItems },
    { data: recentDecisions },
    { count: weekItemCount },
    { count: weekDecisionCount },
    { count: totalDecisions },
    { count: commentsAnalyzed },
    { count: slackAnalyzed },
    { count: meetingsAnalyzed },
    { count: filesAnalyzed },
    { count: syncingFiles },
    { count: risksTotal },
  ] = await Promise.all([
    admin.from("feedback_items")
      .select(`
        id, status, priority, ai_classification, ai_key_question, ai_summary,
        ai_risk_flag, ai_suggested_action, owner_name, project_id, created_at,
        project:projects!project_id(name)
      `)
      .eq("workspace_id", workspaceId)
      .in("status", ["open", "needs_decision", "blocked"])
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(100),
    admin.from("decisions")
      .select("id, decision_text, owner_name, source, decided_at")
      .eq("workspace_id", workspaceId)
      .order("decided_at", { ascending: false })
      .limit(5),
    admin.from("feedback_items")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .gte("created_at", weekAgo),
    admin.from("decisions")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .gte("decided_at", weekAgo),
    admin.from("decisions")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId),
    admin.from("figma_comments")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId),
    admin.from("slack_processed_messages")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId),
    admin.from("decisions")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .eq("source", "meeting"),
    admin.from("figma_files")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId),
    admin.from("figma_files")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .eq("sync_status", "syncing"),
    admin.from("feedback_items")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .eq("ai_risk_flag", true),
  ]);

  const items = ((openItems ?? []) as RawItem[]).map(i => ({
    ...i,
    project_name: i.project
      ? ((Array.isArray(i.project) ? i.project[0] : i.project) as { name?: string })?.name ?? null
      : null,
    project: undefined,
  }));

  const needsReview = items.filter(i => i.status === "open").length;
  const risks       = items.filter(i => i.ai_risk_flag || i.status === "blocked" || i.ai_classification === "Blocked").length;
  const pending     = items.filter(i => i.status === "needs_decision" || i.ai_classification === "Needs Decision").length;

  // Attention: blocked/risk first, then needs_decision, then oldest open
  const score = (i: typeof items[number]) =>
    (i.ai_risk_flag || i.status === "blocked" || i.ai_classification === "Blocked" ? 100 : 0) +
    (i.status === "needs_decision" || i.ai_classification === "Needs Decision" ? 50 : 0) +
    (i.priority === "high" ? 20 : i.priority === "medium" ? 10 : 0);

  const attention = [...items]
    .sort((a, b) => score(b) - score(a))
    .slice(0, 4)
    .map(i => ({
      id: i.id,
      title: (i.ai_key_question && i.ai_key_question !== "None") ? i.ai_key_question : (i.ai_summary ?? "Untitled"),
      project_id: i.project_id,
      project_name: i.project_name,
      status: i.status,
      classification: i.ai_classification,
      risk: !!i.ai_risk_flag || i.status === "blocked" || i.ai_classification === "Blocked",
    }));

  return NextResponse.json({
    name: (user.user_metadata?.full_name as string | undefined)?.split(" ")[0] ?? user.email?.split("@")[0] ?? "there",
    stats: {
      needs_review: needsReview,
      risks,
      decisions_pending: pending,
      updates_week: (weekItemCount ?? 0) + (weekDecisionCount ?? 0),
      decisions_captured: totalDecisions ?? 0,
    },
    analyzed: {
      comments: commentsAnalyzed ?? 0,
      slack_messages: slackAnalyzed ?? 0,
      meetings: meetingsAnalyzed ?? 0,
      files: filesAnalyzed ?? 0,
      risks_total: risksTotal ?? 0,
      reconstructing: (syncingFiles ?? 0) > 0,
    },
    attention,
    recent_decisions: recentDecisions ?? [],
  });
}
