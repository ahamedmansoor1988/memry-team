/**
 * POST /api/figma/enrich-previews
 *
 * Two callers:
 *
 * 1. Background trigger (internal) — called by sync/route.ts after each file sync.
 *    Auth: CRON_SECRET header.
 *    Body: { workspaceId: string }
 *    Processes up to 5 pending records so the call fits within Vercel's 10s budget.
 *    Respects preview_next_retry_at — skips records inside a back-off window.
 *
 * 2. Manual trigger (user) — "Generate Frame Preview" button in item detail.
 *    Auth: user session.
 *    Body: empty.
 *    Processes up to 20 records.
 *    Bypasses preview_next_retry_at — explicit user action overrides retry windows.
 *
 * Safe to call concurrently — records are locked as "generating" before processing.
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { enrichPreviews, getPreviewMetrics } from "@/lib/figma/enrich-previews";

// Background trigger: small limit so each call fits in Vercel's 10s budget.
// Remaining records are picked up on the next sync cycle (~5 min later).
const BACKGROUND_LIMIT = 5;

// Manual trigger: user can afford to wait a bit longer.
const MANUAL_LIMIT = 20;

export async function POST(req: NextRequest) {
  const admin = createAdminClient();
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization");
  const isCron = cronSecret && authHeader === `Bearer ${cronSecret}`;
  console.log(`[enrich-previews] received request isCron=${!!isCron} hasAuth=${!!authHeader}`);

  let workspaceId: string;
  let pat: string;

  if (isCron) {
    // ── Internal background trigger ───────────────────────────────────────────
    const body = await req.json() as { workspaceId?: string };
    if (!body.workspaceId) {
      return NextResponse.json({ error: "workspaceId required" }, { status: 400 });
    }
    workspaceId = body.workspaceId;

    const { data: ws } = await admin
      .from("workspaces")
      .select("figma_pat")
      .eq("id", workspaceId)
      .single();

    const wsPat = (ws as { figma_pat?: string } | null)?.figma_pat;
    if (!wsPat) {
      // No PAT — workspace not configured; silently skip
      return NextResponse.json({ ok: true, message: "No PAT configured", processed: 0 });
    }
    pat = wsPat;

  } else {
    // ── Manual trigger (user session) ─────────────────────────────────────────
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { data: member } = await admin
      .from("workspace_members")
      .select("workspace_id")
      .eq("user_id", user.id)
      .single();

    if (!member) return NextResponse.json({ error: "No workspace" }, { status: 404 });
    workspaceId = (member as { workspace_id: string }).workspace_id;

    const { data: ws } = await admin
      .from("workspaces")
      .select("figma_pat")
      .eq("id", workspaceId)
      .single();

    const wsPat = (ws as { figma_pat?: string } | null)?.figma_pat;
    if (!wsPat) return NextResponse.json({ error: "Figma PAT not configured" }, { status: 400 });
    pat = wsPat;
  }

  // ── Reset stale rate-limited records ─────────────────────────────────────
  // Records that were rate-limited with the old 1-hour backoff get reset to
  // pending so they're retried on the next sync cycle (now capped at 5 min).
  const fiveMinutesFromNow = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  await admin
    .from("design_references")
    .update({ preview_status: "pending", preview_next_retry_at: null })
    .eq("workspace_id", workspaceId)
    .eq("preview_status", "failed")
    .eq("preview_error_reason", "rate_limited")
    .gt("preview_next_retry_at", fiveMinutesFromNow);

  // ── Check whether anything is due for processing ──────────────────────────
  // Manual requests bypass the retry window: count ALL actionable records
  // regardless of preview_next_retry_at.  Cron/background requests respect it.
  const now = new Date().toISOString();

  const gateQuery = admin
    .from("design_references")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .in("preview_status", ["pending", "failed", "stale"]);

  const { count: pendingCount } = await (isCron
    ? gateQuery.or(`preview_next_retry_at.is.null,preview_next_retry_at.lte.${now}`)
    : gateQuery   // manual: no retry-window filter
  );

  if (!pendingCount) {
    if (isCron) {
      return NextResponse.json({ ok: true, message: "Nothing to process", processed: 0 });
    }
    const metrics = await getPreviewMetrics(workspaceId);
    return NextResponse.json({ ok: true, message: "Nothing to process", processed: 0, metrics });
  }

  // ── Run enrichment ────────────────────────────────────────────────────────
  const limit = isCron ? BACKGROUND_LIMIT : MANUAL_LIMIT;
  // bypassRetryWindow=true for manual so enrichPreviews() also skips the filter
  const bypassRetryWindow = !isCron;
  if (bypassRetryWindow) {
    console.log(
      `[enrich-previews] manual override activated` +
      ` workspace=${workspaceId} eligible=${pendingCount}`,
    );
  }
  const result = await enrichPreviews(workspaceId, pat, limit, bypassRetryWindow);

  // Background calls don't need metrics — save the extra DB query
  if (isCron) {
    return NextResponse.json({ ok: true, ...result });
  }

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
