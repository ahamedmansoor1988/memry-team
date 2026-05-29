/**
 * Preview enrichment job — populates design_references with:
 *   - frame_name + page_name  (from /files/{key}?depth=2)
 *   - thumbnail_url           (from /images/{key}?ids={node_id})
 *
 * Runs SEPARATELY from sync. Called via POST /api/figma/enrich-previews.
 * Fetches 1 node per second with exponential backoff on 429.
 * Never blocks or rate-limits the main sync.
 */
import { createAdminClient } from "@/lib/supabase/server";
import { figmaHeaders } from "./api";

const FIGMA_API = "https://api.figma.com/v1";
const DELAY_MS = 1200;        // 1.2s between node-image requests (~50/min, Figma limit is 60)
const MAX_RETRIES = 3;
const RETRY_BACKOFF_MS = 5000; // 5s on first retry, 10s on second, 20s on third

// ── Helpers ───────────────────────────────────────────────────────────────────

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function figmaGetWithRetry<T>(
  path: string,
  pat: string,
  retries = MAX_RETRIES,
): Promise<T | null> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(`${FIGMA_API}${path}`, { headers: figmaHeaders(pat) });
    if (res.ok) return res.json() as Promise<T>;
    if (res.status === 429) {
      if (attempt < retries) {
        const wait = RETRY_BACKOFF_MS * Math.pow(2, attempt);
        console.log(`[enrich-previews] rate limited, waiting ${wait}ms before retry ${attempt + 1}`);
        await sleep(wait);
        continue;
      }
      console.warn(`[enrich-previews] rate limited after ${retries} retries on ${path}`);
      return null;
    }
    console.warn(`[enrich-previews] Figma ${res.status} on ${path}`);
    return null;
  }
  return null;
}

// ── Main export ───────────────────────────────────────────────────────────────

export interface EnrichResult {
  processed: number;
  enriched: number;
  failed: number;
  skipped: number;
}

export async function enrichPreviews(
  workspaceId: string,
  pat: string,
  limit = 20, // process at most this many pending records per run
): Promise<EnrichResult> {
  const admin = createAdminClient();
  const result: EnrichResult = { processed: 0, enriched: 0, failed: 0, skipped: 0 };

  // Fetch pending/stale design_references for this workspace
  const { data: pending } = await admin
    .from("design_references")
    .select("id, file_key, node_id, frame_name, page_name, thumbnail_url, preview_status")
    .eq("workspace_id", workspaceId)
    .in("preview_status", ["pending", "stale"])
    .order("updated_at", { ascending: true })
    .limit(limit);

  if (!pending?.length) return result;

  // Group by file_key to minimise file-structure calls
  const byFile = new Map<string, typeof pending>();
  for (const dr of pending) {
    const key = dr.file_key;
    if (!byFile.has(key)) byFile.set(key, []);
    byFile.get(key)!.push(dr);
  }

  for (const fileKey of Array.from(byFile.keys())) {
    const records = byFile.get(fileKey)!;

    // ── Step A: Fetch file structure for frame + page names ─────────────────
    const nodeToPage = new Map<string, string>();
    const nodeToFrame = new Map<string, string>();

    const fileDoc = await figmaGetWithRetry<{
      document?: { children?: { id: string; name: string; children?: { id: string; name: string }[] }[] }
    }>(`/files/${fileKey}?depth=2`, pat);

    if (fileDoc?.document?.children) {
      for (const page of fileDoc.document.children) {
        nodeToPage.set(page.id, page.name);
        for (const node of page.children ?? []) {
          nodeToPage.set(node.id, page.name);
          nodeToFrame.set(node.id, node.name);
        }
      }
    }

    await sleep(DELAY_MS); // space out after the file structure call

    // ── Step B: Fetch node images ONE AT A TIME ──────────────────────────────
    for (const dr of records) {
      result.processed++;

      const pageName = nodeToPage.get(dr.node_id) ?? dr.page_name ?? null;
      const frameName = nodeToFrame.get(dr.node_id) ?? dr.frame_name ?? null;

      // Fetch single node image with retry
      const imgData = await figmaGetWithRetry<{ images?: Record<string, string | null> }>(
        `/images/${fileKey}?ids=${encodeURIComponent(dr.node_id)}&format=png&scale=1`,
        pat,
      );

      const thumbnailUrl = imgData?.images?.[dr.node_id] ?? null;

      const status = thumbnailUrl ? "ready" : "failed";

      await admin
        .from("design_references")
        .update({
          frame_name: frameName,
          page_name: pageName,
          thumbnail_url: thumbnailUrl,
          preview_status: status,
          updated_at: new Date().toISOString(),
        })
        .eq("id", dr.id);

      // Also update feedback_items that reference this design_reference
      if (thumbnailUrl) {
        await admin
          .from("feedback_items")
          .update({ figma_preview_url: thumbnailUrl })
          .eq("design_reference_id", dr.id);
      }

      // Update figma_comments frame_name + page_name for display in breadcrumb
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

      if (thumbnailUrl) {
        result.enriched++;
        console.log(`[enrich-previews] ✓ ${fileKey}/${dr.node_id} → ${frameName ?? "unknown frame"}`);
      } else {
        result.failed++;
        console.warn(`[enrich-previews] ✗ ${fileKey}/${dr.node_id} — no image URL returned`);
      }

      // Rate limit: wait between each node image request
      await sleep(DELAY_MS);
    }
  }

  return result;
}
