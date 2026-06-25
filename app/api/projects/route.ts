import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getWorkspace } from "@/lib/workspace";

export async function GET() {
  const ctx = await getWorkspace();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();

  const { data } = await admin
    .from("threads")
    .select("source, classification, created_at")
    .eq("workspace_id", ctx.workspace.id)
    .neq("status", "deleted");

  if (!data) return NextResponse.json([]);

  const map = new Map<string, {
    total: number; decision: number; blocker: number; risk: number; question: number; latest: string | null;
  }>();

  for (const row of data) {
    const src = (row.source as string) ?? "unknown";
    if (!map.has(src)) map.set(src, { total: 0, decision: 0, blocker: 0, risk: 0, question: 0, latest: null });
    const g = map.get(src)!;
    g.total++;
    const cls = row.classification as string | null;
    if (cls === "decision") g.decision++;
    else if (cls === "blocker") g.blocker++;
    else if (cls === "risk") g.risk++;
    else if (cls === "question") g.question++;
    const at = row.created_at as string | null;
    if (at && (!g.latest || at > g.latest)) g.latest = at;
  }

  const groups = Array.from(map.entries())
    .map(([source, counts]) => ({ source, ...counts }))
    .sort((a, b) => b.total - a.total);

  return NextResponse.json(groups);
}
