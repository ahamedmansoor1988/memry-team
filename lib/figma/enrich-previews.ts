/**
 * Preview enrichment job — populates design_references with:
 *   - frame_name + page_name  (from /files/{key}/nodes?ids={node_id})
 *   - thumbnail_url           (from /images/{key}?ids={node_id})
 *
 * Production-safe contract:
 *   - NEVER called during comment sync
 *   - Always async / background
 *   - Records are locked with preview_status = "generating" before processing
 *     to prevent double-runs if the job fires twice
 *   - Failed records get exponential backoff via preview_next_retry_at
 *   - Error reason is categorized and stored for admin visibility
 *   - After MAX_RETRIES failures the record stays "failed" permanently
 *     (manual re-trigger sets it back to "pending")
 *
 * Error categories (stored in preview_error_reason):
 *   rate_limited        → Figma Images API 429
 *   node_missing        → 404 or null URL in images response
 *   permission_denied   → 403
 *   images_api_error    → other 4xx/5xx from Figma
 *   unknown             → network error or unexpected exception
 */

import { createAdminClient } from "@/lib/supabase/server";
import { figmaHeaders } from "./api";

const FIGMA_API = "https://api.figma.com/v1";

// Delay between each node-image request (~50/min; Figma limit is 60/min)
const INTER_REQUEST_MS = 1200;

// Maximum lifetime retries before giving up permanently
const MAX_RETRIES = 5;

// Backoff schedule in hours: retry_count → hours until next attempt
const BACKOFF_HOURS = [1, 2, 4, 8, 24];

// ── Error categorization ──────────────────────────────────────────────────────

export type PreviewErrorReason =
  | "rate_limited"
  | "node_missing"
  | "permission_denied"
  | "images_api_error"
  | "unknown";

function categorizeHttpError(status: number): PreviewErrorReason {
  if (status === 429) return "rate_limited";
  if (status === 404) return "node_missing";
  if (status === 403) return "permission_denied";
  return "images_api_error";
}

function hoursFromNow(hours: number): string {
  return new Date(Date.now() + hours * 3600 * 1000).toISOString();
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

interface ImagesFetchResult {
  url: string | null;
  error: PreviewErrorReason | null;
  /** Only set when rate_limited — seconds to wait */
  retryAfterSeconds?: number;
}

async function fetchNodeImage(
  fileKey: string,
  nodeId: string,
  pat: string,
): Promise<ImagesFetchResult> {
  try {
    const res = await fetch(
      `${FIGMA_API}/images/${fileKey}?ids=${encodeURIComponent(nodeId)}&format=png&scale=1`,
      { headers: figmaHeaders(pat) },
    );

    if (res.status === 429) {
      const retryAfterSeconds = parseInt(res.headers.get("retry-after") ?? "3600");
      return { url: null, error: "rate_limited", retryAfterSeconds };
    }

    if (!res.ok) {
      return { url: null, error: categorizeHttpError(res.status) };
    }

    const data = await res.json() as { images?: Record<string, string | null>; err?: string };

    // Figma can return 200 but with a null URL for the node (e.g. invisible/deleted node)
    const url = data.images?.[nodeId] ?? null;
    if (!url) {
      return { url: null, error: "node_missing" };
    }

    return { url, error: null };
  } catch {
    return { url: null, error: "unknown" };
  }
}

interface NodeInfoResult {
  frameName: string | null;
  pageName: string | null;
  error: PreviewErrorReason | null;
}

async function fetchNodeInfo(
  fileKey: string,
  nodeId: string,
  pat: string,
): Promise<NodeInfoResult> {
  try {
    const res = await fetch(
      `${FIGMA_API}/files/${fileKey}/nodes?ids=${encodeURIComponent(nodeId)}&depth=1`,
      { headers: figmaHeaders(pat) },
    );

    if (!res.ok) {
      return { frameName: null, pageName: null, error: categorizeHttpError(res.status) };
    }

    const data = await res.json() as {
      nodes?: Record<string, { document?: { name?: string; type?: string } }>;
      name?: string; // top-level = file name, not useful for page
    };

    const doc = data.nodes?.[nodeId]?.document;
    return {
      frameName: doc?.name ?? null,
      pageName: null, // /nodes endpoint doesn't expose parent page — populated by /files?depth=2 when quota allows
      error: null,
    };
  } catch {
    return { frameName: null, pageName: null, error: "unknown" };
  }
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface EnrichResult {
  processed: number;
  enriched: number;
  failed: number;
  skipped: number;
  /** Set when the Images API is globally rate-limited for this account */
  rateLimitedUntil?: string | null;
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function enrichPreviews(
  workspaceId: string,
  pat: string,
  limit = 20,
): Promise<EnrichResult> {
  const admin = createAdminClient();
  const result: EnrichResult = { processed: 0, enriched: 0, failed: 0, skipped: 0 };
  const now = new Date().toISOString();

  // ── 1. Claim records: select pending/failed records that are due ──────────
  //    Only pick up records where:
  //      - status is pending OR (failed with retry_count < MAX_RETRIES)
  //      - preview_next_retry_at is null (never attempted) OR <= now (due for retry)
  //
  //    NOTE: We select them and then immediately mark as "generating" to prevent
  //    a second job run from picking up the same records.

  const { data: candidates } = await admin
    .from("design_references")
    .select("id, file_key, node_id, frame_name, page_name, preview_retry_count, preview_status")
    .eq("workspace_id", workspaceId)
    .in("preview_status", ["pending", "failed", "stale"])
    .or(`preview_next_retry_at.is.null,preview_next_retry_at.lte.${now}`)
    .order("preview_next_retry_at", { ascending: true, nullsFirst: true })
    .limit(limit);

  if (!candidates?.length) return result;

  // Filter out records that have hit MAX_RETRIES
  const eligible = candidates.filter(r => (r.preview_retry_count ?? 0) < MAX_RETRIES);
  const exhausted = candidates.filter(r => (r.preview_retry_count ?? 0) >= MAX_RETRIES);

  // Mark exhausted records as permanently failed (no more retries)
  for (const r of exhausted) {
    await admin
      .from("design_references")
      .update({
        preview_status: "failed",
        preview_error_reason: r.preview_status === "failed" ? undefined : "unknown",
        updated_at: now,
      })
      .eq("id", r.id);
    result.skipped++;
  }

  if (!eligible.length) return result;

  // Lock all eligible records as "generating" in one batch
  const eligibleIds = eligible.map(r => r.id);
  await admin
    .from("design_references")
    .update({ preview_status: "generating", preview_last_attempt_at: now, updated_at: now })
    .in("id", eligibleIds);

  // ── 2. Process each record ────────────────────────────────────────────────

  for (const dr of eligible) {
    result.processed++;

    // ── 2a. Fetch frame/page names if missing ────────────────────────────
    let frameName = dr.frame_name;
    let pageName = dr.page_name;

    if (!frameName) {
      const info = await fetchNodeInfo(dr.file_key, dr.node_id, pat);
      if (info.frameName) frameName = info.frameName;
      if (info.pageName) pageName = info.pageName;
      await sleep(INTER_REQUEST_MS / 2); // small gap after metadata call
    }

    // ── 2b. Fetch the PNG thumbnail ──────────────────────────────────────
    const imgResult = await fetchNodeImage(dr.file_key, dr.node_id, pat);

    if (imgResult.url) {
      // ── SUCCESS ──────────────────────────────────────────────────────
      await admin
        .from("design_references")
        .update({
          frame_name: frameName,
          page_name: pageName,
          thumbnail_url: imgResult.url,
          preview_status: "ready",
          preview_error_reason: null,
          preview_retry_count: 0,
          preview_next_retry_at: null,
          updated_at: now,
        })
        .eq("id", dr.id);

      // Propagate to feedback_items
      await admin
        .from("feedback_items")
        .update({ figma_preview_url: imgResult.url })
        .eq("design_reference_id", dr.id);

      // Propagate frame/page names to figma_comments
      if (frameName || pageName) {
        await admin
          .from("figma_comments")
          .update({
            ...(frameName ? { frame_name: frameName } : {}),
            ...(pageName ? { page_name: pageName } : {}),
          })
          .eq("figma_node_id", dr.node_id)
          .eq("workspace_id", workspaceId);
      }

      result.enriched++;
      console.log(`[enrich-previews] ✓ ${dr.file_key}/${dr.node_id} → ${frameName ?? "?"}`);

    } else {
      // ── FAILURE ──────────────────────────────────────────────────────
      const retryCount = (dr.preview_retry_count ?? 0) + 1;
      const isExhausted = retryCount >= MAX_RETRIES;
      const backoffHours = BACKOFF_HOURS[Math.min(retryCount - 1, BACKOFF_HOURS.length - 1)];
      const nextRetryAt = isExhausted ? null : hoursFromNow(backoffHours);

      // If rate-limited, honour Figma's Retry-After header
      const rateLimitedUntil = imgResult.error === "rate_limited" && imgResult.retryAfterSeconds
        ? new Date(Date.now() + imgResult.retryAfterSeconds * 1000).toISOString()
        : null;

      if (rateLimitedUntil) {
        // Override all records in this run to not retry until Figma says so
        result.rateLimitedUntil = rateLimitedUntil;
      }

      await admin
        .from("design_references")
        .update({
          frame_name: frameName ?? dr.frame_name,
          page_name: pageName ?? dr.page_name,
          preview_status: isExhausted ? "failed" : "failed",
          preview_error_reason: imgResult.error,
          preview_retry_count: retryCount,
          preview_next_retry_at: rateLimitedUntil ?? nextRetryAt,
          updated_at: now,
        })
        .eq("id", dr.id);

      result.failed++;
      console.warn(
        `[enrich-previews] ✗ ${dr.file_key}/${dr.node_id} — ${imgResult.error}` +
        (retryCount < MAX_RETRIES
          ? ` — retry ${retryCount}/${MAX_RETRIES} at ${nextRetryAt}`
          : ` — EXHAUSTED after ${retryCount} attempts`),
      );

      // If rate-limited, stop processing further records in this run —
      // the quota is account-level, so all subsequent calls will also 429.
      if (imgResult.error === "rate_limited") {
        // Mark remaining un-processed eligible records back to "pending"
        const remainingIds = eligible.slice(eligible.indexOf(dr) + 1).map(r => r.id);
        if (remainingIds.length) {
          await admin
            .from("design_references")
            .update({ preview_status: "pending", updated_at: now })
            .in("id", remainingIds);
        }
        break;
      }
    }

    // Rate-limit ourselves between requests
    await sleep(INTER_REQUEST_MS);
  }

  return result;
}

// ── Metrics export ────────────────────────────────────────────────────────────

export interface PreviewMetrics {
  total: number;
  ready: number;
  pending: number;
  generating: number;
  failed: number;
  stale: number;
  errorBreakdown: Partial<Record<PreviewErrorReason, number>>;
  nextRetryAt: string | null;
}

export async function getPreviewMetrics(workspaceId: string): Promise<PreviewMetrics> {
  const admin = createAdminClient();

  const { data } = await admin
    .from("design_references")
    .select("preview_status, preview_error_reason, preview_next_retry_at")
    .eq("workspace_id", workspaceId);

  const records = data ?? [];
  const counts = { total: records.length, ready: 0, pending: 0, generating: 0, failed: 0, stale: 0 };
  const errorBreakdown: Partial<Record<PreviewErrorReason, number>> = {};
  let nextRetryAt: string | null = null;

  for (const r of records) {
    const s = r.preview_status as keyof typeof counts;
    if (s in counts) counts[s]++;

    if (r.preview_error_reason) {
      const reason = r.preview_error_reason as PreviewErrorReason;
      errorBreakdown[reason] = (errorBreakdown[reason] ?? 0) + 1;
    }

    if (r.preview_next_retry_at) {
      if (!nextRetryAt || r.preview_next_retry_at < nextRetryAt) {
        nextRetryAt = r.preview_next_retry_at;
      }
    }
  }

  return { ...counts, errorBreakdown, nextRetryAt };
}
