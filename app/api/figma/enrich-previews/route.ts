/**
 * POST /api/figma/enrich-previews
 *
 * Two callers:
 *
 * 1. Background trigger (internal) — called by sync/route.ts after each file sync.
 *    Auth: CRON_SECRET header.
 *    Body: { workspaceId: string }
 *    Processes up to 5 pending records so the call fits within Vercel's 10s budget.
 *
 * 2. Manual trigger (user) — "Generate Frame Preview" button in item detail.
 *    Auth: user session.
 *    Body: empty.
 *    Processes up to 20 pending records.
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

  // ── Check whether anything is due for processing ──────────────────────────
  const now = new Date().toISOString();
  const { count: pendingCount } = await admin
    .from("design_references")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .in("preview_status", ["pending", "failed", "stale"])
    .or(`preview_next_retry_at.is.null,preview_next_retry_at.lte.${now}`);

  if (!pendingCount) {
    if (isCron) {
      return NextResponse.json({ ok: true, message: "Nothing to process", processed: 0 });
    }
    const metrics = await getPreviewMetrics(workspaceId);
    return NextResponse.json({ ok: true, message: "Nothing to process", processed: 0, metrics });
  }

  // ── Run enrichment ────────────────────────────────────────────────────────
  const limit = isCron ? BACKGROUND_LIMIT : MANUAL_LIMIT;
  const result = await enrichPreviews(workspaceId, pat, limit);

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
