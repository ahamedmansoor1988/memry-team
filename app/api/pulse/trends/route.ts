import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";

type ItemRow = {
  id:                string;
  status:            string;
  ai_classification: string | null;
  ai_risk_flag:      boolean | null;
  ai_vague_flag:     boolean | null;
  created_at:        string;
  updated_at:        string;
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
  if (!workspaceId) return NextResponse.json({ error: "No workspace" }, { status: 400 });

  const now = Date.now();
  const oneWeekAgo  = new Date(now - 7  * 24 * 60 * 60 * 1000).toISOString();
  const twoWeeksAgo = new Date(now - 14 * 24 * 60 * 60 * 1000).toISOString();

  const { data: rows } = await admin
    .from("feedback_items")
    .select("id, status, ai_classification, ai_risk_flag, ai_vague_flag, created_at, updated_at")
    .eq("workspace_id", workspaceId)
    .is("deleted_at", null)
    .gte("created_at", twoWeeksAgo);

  const items = (rows ?? []) as ItemRow[];

  const thisWeek = items.filter(i => i.created_at >= oneWeekAgo);
  const lastWeek = items.filter(i => i.created_at < oneWeekAgo);

  function snapshot(set: ItemRow[]) {
    return {
      total:          set.length,
      resolved:       set.filter(i => i.status === "resolved").length,
      blocked:        set.filter(i => i.ai_classification === "Blocked").length,
      risk_flags:     set.filter(i => i.ai_risk_flag).length,
      needs_decision: set.filter(i => i.ai_classification === "Needs Decision" || i.status === "needs_decision").length,
    };
  }

  const current  = snapshot(thisWeek);
  const previous = snapshot(lastWeek);

  function trend(curr: number, prev: number): "up" | "down" | "flat" {
    if (prev === 0) return curr > 0 ? "up" : "flat";
    const pct = (curr - prev) / prev;
    if (pct >  0.1) return "up";
    if (pct < -0.1) return "down";
    return "flat";
  }

  function delta(curr: number, prev: number): number {
    return curr - prev;
  }

  return NextResponse.json({
    current,
    previous,
    trends: {
      total:          { direction: trend(current.total,          previous.total),          delta: delta(current.total,          previous.total) },
      resolved:       { direction: trend(current.resolved,       previous.resolved),       delta: delta(current.resolved,       previous.resolved) },
      blocked:        { direction: trend(current.blocked,        previous.blocked),        delta: delta(current.blocked,        previous.blocked) },
      risk_flags:     { direction: trend(current.risk_flags,     previous.risk_flags),     delta: delta(current.risk_flags,     previous.risk_flags) },
      needs_decision: { direction: trend(current.needs_decision, previous.needs_decision), delta: delta(current.needs_decision, previous.needs_decision) },
    },
    period: "7d",
    generated_at: new Date().toISOString(),
  });
}
