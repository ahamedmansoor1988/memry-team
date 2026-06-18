/**
 * POST /api/figma/preview-job
 *
 * Background job: processes pending/due-for-retry preview records across ALL workspaces.
 * Designed for Vercel Cron — runs every 30 minutes.
 *
 * Auth: CRON_SECRET header (not user session).
 *   Set CRON_SECRET in Vercel env vars.
 *   Vercel Cron automatically sends Authorization: Bearer <CRON_SECRET>.
 *
 * Safety guarantees:
 *   - Never called during sync
 *   - Records locked as "generating" before processing (prevents double-run)
 *   - Stops immediately if rate-limited (stores retry timestamp)
 *   - Processes at most 10 records per workspace per run to stay within Vercel's 10s limit
 */
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { enrichPreviews } from "@/lib/figma/enrich-previews";

const RECORDS_PER_WORKSPACE = 10;

export async function POST(req: NextRequest) {
  // Verify cron secret
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  // Allow if: secret matches, OR running locally (no secret configured)
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const startedAt = new Date().toISOString();
  const results: Array<{ workspaceId: string; processed: number; enriched: number; failed: number; rateLimited: boolean }> = [];

  // Find all workspaces that have pending/due-for-retry records
  const now = new Date().toISOString();
  const { data: workspaces } = await admin
    .from("design_references")
    .select("workspace_id")
    .in("preview_status", ["pending", "failed", "stale", "rate_limited"])
    .or(`preview_next_retry_at.is.null,preview_next_retry_at.lte.${now}`)
    .limit(100);

  if (!workspaces?.length) {
    return NextResponse.json({ ok: true, message: "Nothing to process", startedAt, results: [] });
  }

  // Deduplicate workspace IDs
  const workspaceIds = Array.from(new Set(workspaces.map(r => (r as { workspace_id: string }).workspace_id)));

  for (const workspaceId of workspaceIds) {
    // Get PAT for this workspace
    const { data: ws } = await admin
      .from("workspaces")
      .select("figma_pat")
      .eq("id", workspaceId)
      .single();

    const pat = (ws as { figma_pat?: string } | null)?.figma_pat;
    if (!pat) {
      console.warn(`[preview-job] workspace ${workspaceId} has no figma_pat — skipping`);
      continue;
    }

    const result = await enrichPreviews(workspaceId, pat, RECORDS_PER_WORKSPACE);
    results.push({
      workspaceId,
      processed: result.processed,
      enriched: result.enriched,
      failed: result.failed,
      rateLimited: !!result.rateLimitedUntil,
    });
  }

  const totalEnriched = results.reduce((s, r) => s + r.enriched, 0);
  const totalFailed = results.reduce((s, r) => s + r.failed, 0);

  console.log(`[preview-job] done — ${totalEnriched} enriched, ${totalFailed} failed across ${workspaceIds.length} workspaces`);

  return NextResponse.json({
    ok: true,
    startedAt,
    workspacesProcessed: workspaceIds.length,
    totalEnriched,
    totalFailed,
    results,
  });
}
