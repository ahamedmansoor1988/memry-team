/**
 * POST /api/figma/enrich-previews
 * Fetches frame names + thumbnail URLs for pending design_references.
 * Rate-limited: 1 node per ~1.2s, retries on 429.
 * Call manually from Integrations or after sync.
 */
import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { enrichPreviews } from "@/lib/figma/enrich-previews";

export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const { data: member } = await admin
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", user.id)
    .single();

  if (!member) return NextResponse.json({ error: "No workspace" }, { status: 404 });
  const workspaceId = (member as { workspace_id: string }).workspace_id;

  const { data: ws } = await admin
    .from("workspaces")
    .select("figma_pat")
    .eq("id", workspaceId)
    .single();

  if (!(ws as { figma_pat?: string } | null)?.figma_pat) {
    return NextResponse.json({ error: "Figma PAT not configured" }, { status: 400 });
  }

  // Count how many are pending before we start
  const { count: pendingCount } = await admin
    .from("design_references")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .in("preview_status", ["pending", "stale"]);

  if (!pendingCount) {
    return NextResponse.json({ ok: true, message: "Nothing to enrich", processed: 0 });
  }

  const pat = (ws as { figma_pat: string }).figma_pat;

  // Quick check: is the Images API currently rate limited?
  const { data: firstDr } = await admin
    .from("design_references")
    .select("file_key, node_id")
    .eq("workspace_id", workspaceId)
    .in("preview_status", ["pending", "stale"])
    .limit(1)
    .single();

  if (firstDr) {
    const probeRes = await fetch(
      `https://api.figma.com/v1/images/${firstDr.file_key}?ids=${encodeURIComponent(firstDr.node_id)}&format=png&scale=1`,
      { headers: { "X-Figma-Token": pat } }
    );
    if (probeRes.status === 429) {
      const retryAfter = parseInt(probeRes.headers.get("retry-after") ?? "3600");
      const retryAfterHours = Math.ceil(retryAfter / 3600);
      return NextResponse.json({
        ok: false,
        retryAfterHours,
        message: `Figma Images API rate limited. Retry in ~${retryAfterHours} hour${retryAfterHours !== 1 ? "s" : ""}.`,
      });
    }
  }

  const result = await enrichPreviews(workspaceId, pat, 20);

  return NextResponse.json({
    ok: true,
    pending_before: pendingCount,
    ...result,
  });
}
