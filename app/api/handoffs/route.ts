/**
 * GET /api/handoffs
 *
 * Returns feedback items that need a clear owner transition:
 * - needs_decision items with an owner assigned, OR
 * - open items with an owner that have been waiting > 3 days
 *
 * Results are ordered oldest-updated first so the most overdue items surface.
 */
import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";

type RawRow = {
  id:                string;
  status:            string;
  priority:          string | null;
  ai_classification: string | null;
  ai_key_question:   string | null;
  ai_summary:        string | null;
  owner_name:        string | null;
  waiting_since:     string | null;
  updated_at:        string;
  created_at:        string;
  project_id:        string | null;
  project:           { name: string } | { name: string }[] | null;
  comment:           { author_name: string | null; figma_created_at: string | null } | { author_name: string | null; figma_created_at: string | null }[] | null;
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
    .limit(1)
    .single();

  const workspaceId = (membership as { workspace_id: string } | null)?.workspace_id;
  if (!workspaceId) return NextResponse.json({ handoffs: [] });

  const { data: rows, error } = await admin
    .from("feedback_items")
    .select(`
      id, status, priority, ai_classification, ai_key_question, ai_summary,
      owner_name, waiting_since, updated_at, created_at, project_id,
      project:projects!project_id(name),
      comment:figma_comments!figma_comment_id(author_name, figma_created_at)
    `)
    .eq("workspace_id", workspaceId)
    .is("deleted_at", null)
    .in("status", ["open", "needs_decision"])
    .not("owner_name", "is", null)
    .order("updated_at", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const now = Date.now();
  const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;

  const handoffs = ((rows ?? []) as RawRow[])
    .map(r => {
      const project = r.project ? (Array.isArray(r.project) ? r.project[0] : r.project) : null;
      const comment = r.comment ? (Array.isArray(r.comment) ? r.comment[0] : r.comment) : null;
      const sinceMs  = r.waiting_since
        ? now - new Date(r.waiting_since).getTime()
        : now - new Date(r.created_at).getTime();
      const waitingDays = Math.floor(sinceMs / (1000 * 60 * 60 * 24));
      return {
        id:                r.id,
        status:            r.status,
        priority:          r.priority,
        ai_classification: r.ai_classification,
        ai_key_question:   r.ai_key_question,
        ai_summary:        r.ai_summary,
        owner_name:        r.owner_name,
        waiting_days:      waitingDays,
        updated_at:        r.updated_at,
        project_id:        r.project_id,
        project_name:      (project as { name?: string } | null)?.name ?? null,
        author_name:       (comment as { author_name?: string | null } | null)?.author_name ?? null,
      };
    })
    // Include needs_decision items regardless of wait time; only include open
    // items that have been waiting > 3 days
    .filter(h => h.status === "needs_decision" || h.waiting_days > 3);

  return NextResponse.json({ handoffs, total: handoffs.length });
}
