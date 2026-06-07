/**
 * POST /api/memory/search
 *
 * Answers a natural-language question about the workspace's decision history.
 * Loads recent decisions + feedback as context, passes to Groq via searchMemory().
 *
 * Body:   { query: string }
 * Returns: MemoryAnswer
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { searchMemory } from "@/lib/ai/memory-search";

type DecisionRow = {
  decision_text: string;
  reason:        string | null;
  decided_at:    string;
  owner_name:    string | null;
  feedback_item:
    | { project: { name: string } | { name: string }[] | null }
    | { project: { name: string } | { name: string }[] | null }[]
    | null;
};

type FeedbackRow = {
  ai_key_question: string | null;
  ai_summary:      string | null;
  status:          string;
  project:
    | { name: string }
    | { name: string }[]
    | null;
};

function projectName(raw: { name: string } | { name: string }[] | null): string | null {
  if (!raw) return null;
  const p = Array.isArray(raw) ? raw[0] : raw;
  return (p as { name?: string } | null)?.name ?? null;
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json() as { query?: string };
  const query = (body.query ?? "").trim();
  if (!query) return NextResponse.json({ error: "query required" }, { status: 400 });

  const admin = createAdminClient();

  const { data: membership } = await admin
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", user.id)
    .limit(1)
    .single();

  const workspaceId = (membership as { workspace_id: string } | null)?.workspace_id;
  if (!workspaceId) return NextResponse.json({ error: "No workspace" }, { status: 400 });

  // ── Load context in parallel ──────────────────────────────────────────────
  const [decisionsRes, feedbackRes] = await Promise.all([
    admin
      .from("decisions")
      .select("decision_text, reason, decided_at, owner_name, feedback_item:feedback_items(project:projects(name))")
      .eq("workspace_id", workspaceId)
      .order("decided_at", { ascending: false })
      .limit(50),

    admin
      .from("feedback_items")
      .select("ai_key_question, ai_summary, status, project:projects(name)")
      .eq("workspace_id", workspaceId)
      .in("status", ["open", "needs_decision", "resolved"])
      .order("created_at", { ascending: false })
      .limit(30),
  ]);

  const decisionRows = (decisionsRes.data ?? []) as DecisionRow[];
  const feedbackRows = (feedbackRes.data  ?? []) as FeedbackRow[];

  const decisions = decisionRows.map(d => {
    const fi = Array.isArray(d.feedback_item) ? d.feedback_item[0] : d.feedback_item;
    return {
      decision_text: d.decision_text,
      reason:        d.reason,
      decided_at:    d.decided_at,
      owner_name:    d.owner_name,
      project_name:  fi ? projectName(fi.project) : null,
    };
  });

  const recentFeedback = feedbackRows.map(f => ({
    ai_key_question: f.ai_key_question,
    ai_summary:      f.ai_summary,
    status:          f.status,
    project_name:    projectName(f.project),
  }));

  const answer = await searchMemory(query, { decisions, recentFeedback });
  return NextResponse.json(answer);
}
