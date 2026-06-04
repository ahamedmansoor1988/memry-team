/**
 * Preview enrichment job — populates design_references with:
 *   - frame_name + page_name  (from /files/{key}/nodes?ids={node_ids})
 *   - thumbnail_url           (from /images/{key}?ids={node_ids})
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

// Delay between each file-batch request (~50/min; Figma limit is 60/min)
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

/**
 * Figma Images API returns node IDs with colons (e.g. "1779:134") in the
 * response keys, but the request sometimes uses hyphens.  Try both forms.
 */
function resolveImageUrl(
  images: Record<string, string | null>,
  nodeId: string,
): string | null {
  const colon = nodeId.replace(/-/g, ":");
  const hyphen = nodeId.replace(/:/g, "-");
  return images[nodeId] ?? images[colon] ?? images[hyphen] ?? null;
}

// ── Batched Figma API fetchers ────────────────────────────────────────────────

interface FileImagesResult {
  /** Per-node image URLs; null for a specific node means that node is missing/invisible */
  urls: Record<string, string | null> | null;
  /** Batch-level error (applies to ALL nodes) */
  error: PreviewErrorReason | null;
  /** Only set when rate_limited — seconds to wait */
  retryAfterSeconds?: number;
}

/**
 * Fetch JPEG thumbnails for multiple nodes from the same file in a single
 * Figma Images API call.
 *
 * GET /v1/images/{key}?ids={id1},{id2},...&format=jpg&scale=0.5
 *
 * format=jpg  — lossy compression; ~10-20x smaller than PNG for UI frames
 * scale=0.5   — half linear resolution; a 1440px frame becomes 720px wide,
 *               a 375px mobile frame becomes 187px — still readable at card size
 *
 * Quota impact: 1 Images API call regardless of how many nodes are in nodeIds.
 */
async function fetchFileImages(
  fileKey: string,
  nodeIds: string[],
  pat: string,
): Promise<FileImagesResult> {
  try {
    // Figma accepts comma-separated IDs; do NOT encode the commas
    const idsParam = nodeIds.map(id => encodeURIComponent(id)).join(",");
    const res = await fetch(
      `${FIGMA_API}/images/${fileKey}?ids=${idsParam}&format=jpg&scale=0.5`,
      { headers: figmaHeaders(pat) },
    );

    if (res.status === 429) {
      const retryAfterSeconds = parseInt(res.headers.get("retry-after") ?? "3600");
      return { urls: null, error: "rate_limited", retryAfterSeconds };
    }

    if (!res.ok) {
      return { urls: null, error: categorizeHttpError(res.status) };
    }

    const data = await res.json() as {
      images?: Record<string, string | null>;
      err?: string;
    };

    if (data.err) {
      // Figma returns 200 with an err field for certain server-side failures
      return { urls: null, error: "images_api_error" };
    }

    return { urls: data.images ?? {}, error: null };
  } catch {
    return { urls: null, error: "unknown" };
  }
}

interface NodeInfoMap {
  [nodeId: string]: { frameName: string | null; pageName: string | null };
}

/**
 * Fetch frame/page names for multiple nodes from the same file in a single
 * Figma nodes API call.
 *
 * GET /v1/files/{key}/nodes?ids={id1},{id2},...&depth=1
 *
 * Returns a map of nodeId → { frameName, pageName }.
 * Missing nodes get null values; errors return an empty map.
 */
async function fetchFileNodeInfos(
  fileKey: string,
  nodeIds: string[],
  pat: string,
): Promise<NodeInfoMap> {
  try {
    const idsParam = nodeIds.map(id => encodeURIComponent(id)).join(",");
    const res = await fetch(
      `${FIGMA_API}/files/${fileKey}/nodes?ids=${idsParam}&depth=1`,
      { headers: figmaHeaders(pat) },
    );

    if (!res.ok) return {};

    const data = await res.json() as {
      nodes?: Record<string, { document?: { name?: string; type?: string } } | null>;
    };

    const result: NodeInfoMap = {};
    for (const nodeId of nodeIds) {
      const doc = data.nodes?.[nodeId]?.document;
      result[nodeId] = {
        frameName: doc?.name ?? null,
        pageName: null, // /nodes endpoint doesn't expose parent page
      };
    }
    return result;
  } catch {
    return {};
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
  /** When true, ignores preview_next_retry_at so manual triggers can process
   *  records that are still inside an automatic retry back-off window.
   *  Must NOT be set for cron jobs or background auto-enrich calls. */
  bypassRetryWindow = false,
): Promise<EnrichResult> {
  const admin = createAdminClient();
  const result: EnrichResult = { processed: 0, enriched: 0, failed: 0, skipped: 0 };
  const now = new Date().toISOString();

  // ── 1. Claim records: select pending/failed records that are due ──────────
  //    Normal (bypassRetryWindow=false):
  //      - status IN (pending, failed, stale)
  //      - preview_next_retry_at IS NULL OR <= now
  //
  //    Manual override (bypassRetryWindow=true):
  //      - status IN (pending, failed, stale)
  //      - preview_next_retry_at filter skipped entirely
  //
  //    NOTE: Records are immediately locked as "generating" to prevent a
  //    concurrent job from picking up the same records (TOCTOU mitigation).

  const baseQuery = admin
    .from("design_references")
    .select("id, file_key, node_id, frame_name, page_name, preview_retry_count, preview_status")
    .eq("workspace_id", workspaceId)
    .in("preview_status", ["pending", "failed", "stale"])
    .order("preview_next_retry_at", { ascending: true, nullsFirst: true })
    .limit(limit);

  const { data: candidates } = await (bypassRetryWindow
    ? baseQuery
    : baseQuery.or(`preview_next_retry_at.is.null,preview_next_retry_at.lte.${now}`)
  );

  if (bypassRetryWindow) {
    console.log(
      `[enrich-previews] manual override activated` +
      ` workspace=${workspaceId} candidates=${candidates?.length ?? 0} (retry window bypassed)`,
    );
  }

  if (!candidates?.length) return result;

  // Filter out records that have hit MAX_RETRIES
  const eligible = candidates.filter(r => (r.preview_retry_count ?? 0) < MAX_RETRIES);
  const exhausted = candidates.filter(r => (r.preview_retry_count ?? 0) >= MAX_RETRIES);

  console.log(
    `[enrich-previews] workspace=${workspaceId}` +
    ` eligible=${eligible.length} exhausted=${exhausted.length}` +
    ` bypassRetryWindow=${bypassRetryWindow}`,
  );

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

  // ── Atomic claim: UPDATE ... WHERE status IN eligible-statuses RETURNING id ──
  //
  // PostgreSQL guarantees that two concurrent workers cannot claim the same row:
  //   1. Worker A issues: UPDATE WHERE id IN [...] AND preview_status IN ('pending',...)
  //   2. Worker B issues the same UPDATE concurrently.
  //   3. PostgreSQL serialises per-row: A acquires a row lock, sets status='generating', commits.
  //   4. B then acquires the same row lock, re-evaluates the WHERE clause.
  //   5. status is now 'generating' — clause fails — B gets 0 rows for that row.
  //   6. B's claimedIds is empty → it processes nothing → 0 duplicate Figma API calls.
  //
  // This replaces the previous non-atomic SELECT → separate UPDATE pattern that
  // allowed concurrent workers to both observe the same pending records and both
  // call the Figma Images API for the same nodes.
  const eligibleIds = eligible.map(r => r.id);
  const { data: claimedRows } = await admin
    .from("design_references")
    .update({ preview_status: "generating", preview_last_attempt_at: now, updated_at: now })
    .in("id", eligibleIds)
    .in("preview_status", ["pending", "failed", "stale"]) // atomic guard: skip rows already claimed
    .select("id");

  const claimedIds = new Set((claimedRows ?? []).map(r => (r as { id: string }).id));
  const claimed = eligible.filter(r => claimedIds.has(r.id));

  if (claimed.length === 0) {
    // A concurrent worker already claimed all eligible records — nothing to do here.
    console.log(`[enrich-previews] workspace=${workspaceId} — 0 records claimed (concurrent worker beat us)`);
    return result;
  }

  console.log(`[enrich-previews] workspace=${workspaceId} claimed ${claimed.length}/${eligible.length} eligible records`);

  // ── 2. Group claimed records by file_key ──────────────────────────────────
  //    One Images API call per file instead of one per node.
  //    Typical saving: N nodes on K files → K calls (vs N calls before).

  const byFile = new Map<string, typeof claimed>();
  for (const dr of claimed) {
    const group = byFile.get(dr.file_key) ?? [];
    group.push(dr);
    byFile.set(dr.file_key, group);
  }

  const totalFiles = byFile.size;
  const totalNodes = claimed.length;
  const callsSaved = totalNodes - totalFiles;
  console.log(
    `[enrich-previews] batching workspace=${workspaceId}` +
    ` files=${totalFiles} nodes=${totalNodes} images_api_calls=1_per_file calls_saved=${callsSaved}`,
  );

  // ── 3. Process each file group ────────────────────────────────────────────
  // Convert to array so we can slice for remainder tracking without Map iteration.

  const fileEntries = Array.from(byFile.entries());

  for (let fileIdx = 0; fileIdx < fileEntries.length; fileIdx++) {
    const [fileKey, records] = fileEntries[fileIdx];
    const nodeIds = records.map(r => r.node_id);
    result.processed += records.length;

    console.log(
      `[enrich-previews] file=${fileKey}` +
      ` node_count=${nodeIds.length} images_api_calls=1 calls_saved=${nodeIds.length - 1}`,
    );

    // ── 3a. Batch-fetch frame names for nodes that are missing them ────────
    const missingInfoIds = records
      .filter(r => !r.frame_name)
      .map(r => r.node_id);

    let nodeInfoMap: NodeInfoMap = {};
    if (missingInfoIds.length > 0) {
      nodeInfoMap = await fetchFileNodeInfos(fileKey, missingInfoIds, pat);
      await sleep(INTER_REQUEST_MS / 2); // small gap after metadata call
    }

    // ── 3b. Batch-fetch PNG thumbnails for all nodes in this file ──────────
    const imgResult = await fetchFileImages(fileKey, nodeIds, pat);

    if (imgResult.error === "rate_limited") {
      // Account-level quota exhausted — stop all further processing
      const retryAfterSeconds = imgResult.retryAfterSeconds ?? 3600;
      const rateLimitedUntil = new Date(Date.now() + retryAfterSeconds * 1000).toISOString();
      result.rateLimitedUntil = rateLimitedUntil;

      console.warn(
        `[enrich-previews] rate-limited file=${fileKey}` +
        ` retry_after=${retryAfterSeconds}s until=${rateLimitedUntil}`,
      );

      // Write rate-limit failure for all nodes in this batch.
      // frame_name / page_name are persisted here even though image generation
      // failed — nodeInfoMap was populated by fetchFileNodeInfos before the
      // Images API call, so the name data is available regardless of quota state.
      for (const dr of records) {
        const retryCount = (dr.preview_retry_count ?? 0) + 1;
        const isExhausted = retryCount >= MAX_RETRIES;
        const backoffHours = BACKOFF_HOURS[Math.min(retryCount - 1, BACKOFF_HOURS.length - 1)];
        const frameName = nodeInfoMap[dr.node_id]?.frameName ?? dr.frame_name ?? null;
        const pageName  = nodeInfoMap[dr.node_id]?.pageName  ?? dr.page_name  ?? null;
        await admin
          .from("design_references")
          .update({
            frame_name: frameName,
            page_name: pageName,
            preview_status: "failed",
            preview_error_reason: "rate_limited",
            preview_retry_count: retryCount,
            preview_next_retry_at: isExhausted ? null : rateLimitedUntil ?? hoursFromNow(backoffHours),
            updated_at: now,
          })
          .eq("id", dr.id);

        // Propagate to figma_comments so the frame label is visible in the
        // inbox even when the thumbnail is unavailable.
        if (frameName || pageName) {
          await admin
            .from("figma_comments")
            .update({
              ...(frameName ? { frame_name: frameName } : {}),
              ...(pageName  ? { page_name:  pageName  } : {}),
            })
            .eq("figma_node_id", dr.node_id)
            .eq("workspace_id", workspaceId);
        }

        result.failed++;
      }

      // Mark all remaining file groups (not yet started) back to pending
      const remainingIds = fileEntries
        .slice(fileIdx + 1)
        .flatMap(([, recs]) => recs.map(r => r.id));
      if (remainingIds.length) {
        await admin
          .from("design_references")
          .update({ preview_status: "pending", updated_at: now })
          .in("id", remainingIds);
      }
      break;
    }

    if (imgResult.error && !imgResult.urls) {
      // Batch-level error (non-rate-limit): all nodes in file fail together
      console.warn(`[enrich-previews] batch error file=${fileKey} error=${imgResult.error}`);
      for (const dr of records) {
        const retryCount = (dr.preview_retry_count ?? 0) + 1;
        const isExhausted = retryCount >= MAX_RETRIES;
        const backoffHours = BACKOFF_HOURS[Math.min(retryCount - 1, BACKOFF_HOURS.length - 1)];
        const nextRetryAt = isExhausted ? null : hoursFromNow(backoffHours);
        const frameName = nodeInfoMap[dr.node_id]?.frameName ?? dr.frame_name;
        const pageName  = nodeInfoMap[dr.node_id]?.pageName  ?? dr.page_name;
        await admin
          .from("design_references")
          .update({
            frame_name: frameName,
            page_name: pageName,
            preview_status: "failed",
            preview_error_reason: imgResult.error,
            preview_retry_count: retryCount,
            preview_next_retry_at: nextRetryAt,
            updated_at: now,
          })
          .eq("id", dr.id);
        result.failed++;
        console.warn(
          `[enrich-previews] ✗ ${fileKey}/${dr.node_id} — ${imgResult.error}` +
          (retryCount < MAX_RETRIES
            ? ` — retry ${retryCount}/${MAX_RETRIES} at ${nextRetryAt}`
            : ` — EXHAUSTED after ${retryCount} attempts`),
        );
      }
      await sleep(INTER_REQUEST_MS);
      continue;
    }

    // ── 3c. Distribute per-node results from the batch response ───────────
    for (const dr of records) {
      const frameName = nodeInfoMap[dr.node_id]?.frameName ?? dr.frame_name ?? null;
      const pageName  = nodeInfoMap[dr.node_id]?.pageName  ?? dr.page_name  ?? null;
      const url = resolveImageUrl(imgResult.urls ?? {}, dr.node_id);

      if (url) {
        // ── SUCCESS ────────────────────────────────────────────────────
        await admin
          .from("design_references")
          .update({
            frame_name: frameName,
            page_name: pageName,
            thumbnail_url: url,
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
          .update({ figma_preview_url: url })
          .eq("design_reference_id", dr.id);

        // Propagate frame/page names to figma_comments
        if (frameName || pageName) {
          await admin
            .from("figma_comments")
            .update({
              ...(frameName ? { frame_name: frameName } : {}),
              ...(pageName  ? { page_name:  pageName  } : {}),
            })
            .eq("figma_node_id", dr.node_id)
            .eq("workspace_id", workspaceId);
        }

        result.enriched++;
        console.log(`[enrich-previews] ✓ ${fileKey}/${dr.node_id} → ${frameName ?? "?"}`);

      } else {
        // ── PER-NODE FAILURE (null URL — node missing/invisible) ───────
        const retryCount = (dr.preview_retry_count ?? 0) + 1;
        const isExhausted = retryCount >= MAX_RETRIES;
        const backoffHours = BACKOFF_HOURS[Math.min(retryCount - 1, BACKOFF_HOURS.length - 1)];
        const nextRetryAt = isExhausted ? null : hoursFromNow(backoffHours);

        await admin
          .from("design_references")
          .update({
            frame_name: frameName,
            page_name: pageName,
            preview_status: "failed",
            preview_error_reason: "node_missing",
            preview_retry_count: retryCount,
            preview_next_retry_at: nextRetryAt,
            updated_at: now,
          })
          .eq("id", dr.id);

        result.failed++;
        console.warn(
          `[enrich-previews] ✗ ${fileKey}/${dr.node_id} — node_missing` +
          (retryCount < MAX_RETRIES
            ? ` — retry ${retryCount}/${MAX_RETRIES} at ${nextRetryAt}`
            : ` — EXHAUSTED after ${retryCount} attempts`),
        );
      }
    }

    // Rate-limit ourselves between file-batch requests
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
