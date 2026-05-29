/**
 * POST /api/figma/enrich-previews
 *
 * Manually trigger the preview enrichment job for the current user's workspace.
 * Processes up to 20 pending/failed records per call.
 *
 * Safe to call multiple times — records locked as "generating" prevent double-processing.
 * Never called during comment sync.
 */
import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { enrichPreviews, getPreviewMetrics } from "@/lib/figma/enrich-previews";

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

  const pat = (ws as { figma_pat?: string } | null)?.figma_pat;
  if (!pat) return NextResponse.json({ error: "Figma PAT not configured" }, { status: 400 });

  // Count pending before we start
  const { count: pendingCount } = await admin
    .from("design_references")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .in("preview_status", ["pending", "failed", "stale"])
    .or("preview_next_retry_at.is.null,preview_next_retry_at.lte." + new Date().toISOString());

  if (!pendingCount) {
    const metrics = await getPreviewMetrics(workspaceId);
    return NextResponse.json({ ok: true, message: "Nothing to process", processed: 0, metrics });
  }

  const result = await enrichPreviews(workspaceId, pat, 20);
  const metrics = await getPreviewMetrics(workspaceId);

  if (result.rateLimitedUntil) {
    const retryAfterMs = new Date(result.rateLimitedUntil).getTime() - Date.now();
    const retryAfterHours = Math.ceil(retryAfterMs / 3600000);
    return NextResponse.json({
      ok: false,
      rateLimited: true,
      retryAfterHours,
      retryAfterUntil: result.rateLimitedUntil,
      message: `Figma Images API rate limited. Retry in ~${retryAfterHours}h.`,
      ...result,
      metrics,
    });
  }

  return NextResponse.json({
    ok: true,
    pending_before: pendingCount,
    ...result,
    metrics,
  });
}
