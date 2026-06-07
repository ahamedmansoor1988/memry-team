/**
 * GET /api/accountability
 *
 * Returns all active (open / needs_decision) feedback items enriched with
 * their computed AccountabilityState, sorted critical → high → medium → low.
 * Items with urgency "none" are excluded.
 */

import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { computeAccountability, AccountabilityUrgency } from "@/lib/accountability/tracker";

const URGENCY_ORDER: Record<AccountabilityUrgency, number> = {
  critical: 0,
  high:     1,
  medium:   2,
  low:      3,
  none:     4,
};

type ItemRow = {
  id: string;
  status: string;
  ai_classification: string | null;
  ai_key_question:   string | null;
  ai_summary:        string | null;
  waiting_since:     string | null;
  blocked_since:     string | null;
  escalation_count:  number | null;
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
    .limit(1)
    .single();

  const workspaceId = (membership as { workspace_id: string } | null)?.workspace_id;
  if (!workspaceId) return NextResponse.json({ error: "No workspace" }, { status: 400 });

  const { data: rows, error } = await admin
    .from("feedback_items")
    .select(`
      id, status, ai_classification, ai_key_question, ai_summary,
      waiting_since, blocked_since, escalation_count, updated_at,
      owner_name, project_id,
      project:projects!project_id(name)
    `)
    .eq("workspace_id", workspaceId)
    .in("status", ["open", "needs_decision"]);

  if (error || !rows) {
    console.error("[accountability] query failed:", error?.message);
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }

  const items = rows as ItemRow[];

  const enriched = items
    .map(item => {
      const projectRaw = item.project;
      const project = Array.isArray(projectRaw) ? projectRaw[0] : projectRaw;
      const project_name = (project as { name?: string } | null)?.name ?? null;

      const accountability = computeAccountability({
        status:            item.status,
        ai_classification: item.ai_classification,
        waiting_since:     item.waiting_since,
        blocked_since:     item.blocked_since,
        escalation_count:  item.escalation_count,
        updated_at:        item.updated_at,
      });

      return {
        id:                item.id,
        status:            item.status,
        ai_classification: item.ai_classification,
        ai_key_question:   item.ai_key_question,
        ai_summary:        item.ai_summary,
        owner_name:        item.owner_name,
        project_id:        item.project_id,
        project_name,
        updated_at:        item.updated_at,
        ...accountability,
      };
    })
    .filter(item => item.urgency !== "none")
    .sort((a, b) => URGENCY_ORDER[a.urgency] - URGENCY_ORDER[b.urgency]);

  return NextResponse.json({ items, total: enriched.length });
}
