import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";

// ─── Types ────────────────────────────────────────────────────────────────────

type RawItem = {
  id: string;
  status: string;
  ai_classification: string | null;
  ai_risk_flag: boolean | null;
  ai_vague_flag: boolean | null;
  ai_key_question: string | null;
  created_at: string;
  project: { id: string; name: string } | { id: string; name: string }[] | null;
};

type NormalizedItem = Omit<RawItem, "project"> & {
  project: { id: string; name: string } | null;
};

type SignalItem = {
  id: string;
  ai_key_question: string | null;
  created_at: string;
  project_id: string | null;
  project_name: string | null;
};

function toSignalItems(items: NormalizedItem[]): SignalItem[] {
  return items.slice(0, 3).map(i => ({
    id: i.id,
    ai_key_question: i.ai_key_question,
    created_at: i.created_at,
    project_id: i.project?.id ?? null,
    project_name: i.project?.name ?? null,
  }));
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

  if (!membership) return NextResponse.json({ error: "No workspace" }, { status: 400 });

  const { data: rawRows, error } = await admin
    .from("feedback_items")
    .select("id, status, ai_classification, ai_risk_flag, ai_vague_flag, ai_key_question, created_at, project:projects(id, name)")
    .eq("workspace_id", membership.workspace_id)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[pulse] query failed:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Normalize FK join — Supabase may return project as array or object
  const items: NormalizedItem[] = ((rawRows ?? []) as RawItem[]).map(item => ({
    ...item,
    project: Array.isArray(item.project) ? (item.project[0] ?? null) : item.project,
  }));

  const now = Date.now();
  const FIVE_DAYS_MS  = 5 * 24 * 60 * 60 * 1000;
  const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

  // Active items: not resolved and not archived
  const active = items.filter(i => i.status !== "resolved" && i.status !== "archived");

  // 1. Stalled Decisions — Needs Decision (AI or status) AND older than 5 days
  const stalledDecisions = active.filter(
    i =>
      (i.ai_classification === "Needs Decision" || i.status === "needs_decision") &&
      now - new Date(i.created_at).getTime() > FIVE_DAYS_MS,
  );

  // 2. Unresolved Blocks
  const unresolvedBlocks = active.filter(i => i.ai_classification === "Blocked");

  // 3. Risk Flags
  const riskFlags = active.filter(i => i.ai_risk_flag === true);

  // 4. Vague Comments
  const vagueComments = active.filter(i => i.ai_vague_flag === true);

  // 5. Feedback Spikes — projects with >= 3 open items created in the last 7 days
  const sevenDaysAgo = now - SEVEN_DAYS_MS;
  const spikeCounts: Record<string, { projectName: string; count: number }> = {};
  for (const item of items) {
    if (item.status !== "open" && item.status !== "needs_decision") continue;
    if (new Date(item.created_at).getTime() < sevenDaysAgo) continue;
    const pid   = item.project?.id;
    const pname = item.project?.name;
    if (!pid || !pname) continue;
    if (!spikeCounts[pid]) spikeCounts[pid] = { projectName: pname, count: 0 };
    spikeCounts[pid].count++;
  }
  const feedbackSpikes = Object.values(spikeCounts)
    .filter(s => s.count >= 3)
    .sort((a, b) => b.count - a.count);

  // 6. Health Score
  let score = 100;
  score -= stalledDecisions.length * 10;
  score -= unresolvedBlocks.length * 15;
  score -= riskFlags.length        * 8;
  score -= vagueComments.length    * 5;
  score = Math.max(0, score);

  const healthLabel =
    score >= 90 ? "Healthy" :
    score >= 70 ? "Needs Attention" :
    score >= 50 ? "At Risk" :
    "Critical";

  // ── 7. Top Waiting On ────────────────────────────────────────────────────────
  // Optional — silently skipped if owner_name column doesn't exist yet.
  let topWaitingOn: { owner_name: string; count: number }[] = [];
  try {
    const { data: waitingRows } = await admin
      .from("feedback_items")
      .select("owner_name")
      .eq("workspace_id", membership.workspace_id)
      .in("status", ["open", "needs_decision"])
      .not("owner_name", "is", null);

    if (waitingRows) {
      const counts: Record<string, number> = {};
      for (const row of waitingRows) {
        const name = (row as { owner_name: string }).owner_name;
        counts[name] = (counts[name] ?? 0) + 1;
      }
      topWaitingOn = Object.entries(counts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([owner_name, count]) => ({ owner_name, count }));
    }
  } catch {
    // owner_name column doesn't exist yet — silently skip
  }

  return NextResponse.json({
    health: { score, label: healthLabel },
    stalledDecisions: { count: stalledDecisions.length, items: toSignalItems(stalledDecisions) },
    unresolvedBlocks: { count: unresolvedBlocks.length, items: toSignalItems(unresolvedBlocks) },
    riskFlags:        { count: riskFlags.length,        items: toSignalItems(riskFlags)        },
    vagueComments:    { count: vagueComments.length,    items: toSignalItems(vagueComments)    },
    feedbackSpikes,
    topWaitingOn,
    generatedAt: new Date().toISOString(),
  });
}
