/**
 * GET /api/decisions/timeline
 *
 * Returns all workspace decisions grouped into chronological date buckets,
 * plus a deduplicated project list for the filter dropdown.
 *
 * Response shape:
 * {
 *   timeline: { date: string; label: string; decisions: DecisionItem[] }[]
 *   total:    number
 *   projects: { id: string; name: string }[]
 * }
 */

import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";

// ─── Types ────────────────────────────────────────────────────────────────────

type RawDecision = {
  id:               string;
  decision_text:    string;
  reason:           string | null;
  owner_name:       string | null;
  source:           string;
  decided_at:       string;
  feedback_item_id: string | null;
  feedback_item:
    | { id: string; project_id: string | null; ai_key_question: string | null; project: { id: string; name: string } | { id: string; name: string }[] | null }
    | { id: string; project_id: string | null; ai_key_question: string | null; project: { id: string; name: string } | { id: string; name: string }[] | null }[]
    | null;
};

export type DecisionItem = {
  id:               string;
  decision_text:    string;
  reason:           string | null;
  owner_name:       string | null;
  source:           string;
  decided_at:       string;
  feedback_item_id: string | null;
  project_id:       string | null;
  project_name:     string | null;
  ai_key_question:  string | null;
};

export type TimelineGroup = {
  date:      string;   // "2024-01-15"
  label:     string;   // "Today" | "Yesterday" | "Jan 15"
  decisions: DecisionItem[];
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toDateKey(iso: string): string {
  // Convert ISO timestamp to YYYY-MM-DD in local time
  return new Date(iso).toLocaleDateString("en-CA"); // "YYYY-MM-DD"
}

function toDateLabel(dateKey: string): string {
  const today     = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  const todayKey     = today.toLocaleDateString("en-CA");
  const yesterdayKey = yesterday.toLocaleDateString("en-CA");

  if (dateKey === todayKey)     return "Today";
  if (dateKey === yesterdayKey) return "Yesterday";

  // "Jun 5" / "Jan 15"
  const d = new Date(dateKey + "T12:00:00"); // noon to avoid DST edge
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function normalizeProject(raw: { id: string; name: string } | { id: string; name: string }[] | null): { id: string; name: string } | null {
  if (!raw) return null;
  return Array.isArray(raw) ? (raw[0] ?? null) : raw;
}

function normalizeFeedbackItem(raw: RawDecision["feedback_item"]) {
  if (!raw) return null;
  return Array.isArray(raw) ? (raw[0] ?? null) : raw;
}

// ─── Route ────────────────────────────────────────────────────────────────────

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

  const { data: rawRows, error } = await admin
    .from("decisions")
    .select(`
      id, decision_text, reason, owner_name, source, decided_at, feedback_item_id,
      feedback_item:feedback_items(
        id, project_id, ai_key_question,
        project:projects(id, name)
      )
    `)
    .eq("workspace_id", workspaceId)
    .order("decided_at", { ascending: false });

  if (error) {
    console.error("[timeline] fetch error:", error.message);
    return NextResponse.json({ timeline: [], total: 0, projects: [] });
  }

  const rows = (rawRows ?? []) as RawDecision[];

  // ── Normalize each row ────────────────────────────────────────────────────
  const decisions: DecisionItem[] = rows.map(row => {
    const fi      = normalizeFeedbackItem(row.feedback_item);
    const project = fi ? normalizeProject(fi.project) : null;
    return {
      id:               row.id,
      decision_text:    row.decision_text,
      reason:           row.reason,
      owner_name:       row.owner_name,
      source:           row.source,
      decided_at:       row.decided_at,
      feedback_item_id: row.feedback_item_id,
      project_id:       fi?.project_id ?? null,
      project_name:     project?.name ?? null,
      ai_key_question:  fi?.ai_key_question ?? null,
    };
  });

  // ── Group by date ─────────────────────────────────────────────────────────
  const groupMap = new Map<string, DecisionItem[]>();
  for (const d of decisions) {
    const key = toDateKey(d.decided_at);
    if (!groupMap.has(key)) groupMap.set(key, []);
    groupMap.get(key)!.push(d);
  }

  // Already ordered newest-first from DB; preserve that order for groups too
  const timeline: TimelineGroup[] = Array.from(groupMap.entries()).map(([date, grpDecisions]) => ({
    date,
    label:     toDateLabel(date),
    decisions: grpDecisions,
  }));

  // ── Project list for filter ───────────────────────────────────────────────
  const projectMap = new Map<string, string>();
  for (const d of decisions) {
    if (d.project_id && d.project_name && !projectMap.has(d.project_id)) {
      projectMap.set(d.project_id, d.project_name);
    }
  }
  const projects = Array.from(projectMap.entries())
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return NextResponse.json({ timeline, total: decisions.length, projects });
}
