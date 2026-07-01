import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  FIGMA_VISIBILITY_SNAPSHOT_CUTOFF,
  isRenderableFigmaNode,
  normalizeNodes,
} from "@/lib/figma-normalize";

export const maxDuration = 120;

function supabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

interface FigmaRateLimitInfo {
  retryAfterSec: number | null;
  planTier: string | null;
  limitType: string | null;
  limitInterval: string | null;
}

function extractRateLimitHeaders(res: Response): FigmaRateLimitInfo {
  const ra            = res.headers.get("Retry-After");
  const planTier      = res.headers.get("X-Figma-Plan-Tier");
  const limitType     = res.headers.get("X-Figma-Rate-Limit-Type");
  const limitInterval = res.headers.get("X-Figma-Rate-Limit-Interval");
  return {
    retryAfterSec: ra !== null ? parseInt(ra, 10) : null,
    planTier,
    limitType,
    limitInterval,
  };
}

function formatRateLimitError(info: FigmaRateLimitInfo): string {
  const { retryAfterSec, planTier, limitType, limitInterval } = info;

  const planMsg  = planTier      ? `Plan tier: ${planTier}`          : "";
  const typeMsg  = limitType     ? `Limit type: ${limitType}`        : "";
  const intMsg   = limitInterval ? `Interval: ${limitInterval}`      : "";
  const diagLine = [planMsg, typeMsg, intMsg].filter(Boolean).join(" · ");

  if (retryAfterSec !== null && retryAfterSec > 3600) {
    const hours = Math.round(retryAfterSec / 3600);
    const days  = Math.round(retryAfterSec / 86400);
    const wait  = days >= 1 ? `~${days} day${days !== 1 ? "s" : ""}` : `~${hours} hour${hours !== 1 ? "s" : ""}`;

    if (planTier === "starter" || limitInterval?.toLowerCase().includes("month")) {
      return `Monthly Figma API quota exhausted. Resets in ${wait}. ${diagLine}. Upgrade to Figma Professional to remove the monthly cap, or wait for the reset.`;
    }
    return `Figma rate limited for ${wait} (Retry-After: ${retryAfterSec}s). ${diagLine}.`;
  }

  if (retryAfterSec !== null) {
    return `Figma rate limited — wait ${retryAfterSec}s. ${diagLine}.`;
  }

  return `Figma rate limited. ${diagLine}.`;
}

// Shared figmaFetch with full rate-limit diagnostics
async function figmaFetch(pat: string, path: string): Promise<Response> {
  const reqId = Math.random().toString(36).slice(2, 10);

  async function doFetch(retried: boolean): Promise<Response> {
    const t0  = Date.now();
    const res = await fetch(`https://api.figma.com/v1${path}`, {
      headers: { "X-Figma-Token": pat },
    });
    const ms   = Date.now() - t0;
    const info = res.status === 429 ? extractRateLimitHeaders(res) : null;

    console.log(
      `[figma-sync] [${reqId}] GET ${path} → ${res.status} ${ms}ms` +
      (info ? ` retry-after:${info.retryAfterSec}s plan:${info.planTier} type:${info.limitType} interval:${info.limitInterval}` : "")
    );

    if (res.status === 429) {
      const rateInfo = extractRateLimitHeaders(res);

      // Monthly / long-duration quota: fail immediately, no retry
      if (rateInfo.retryAfterSec !== null && rateInfo.retryAfterSec > 300) {
        throw new Error(formatRateLimitError(rateInfo));
      }

      if (retried) throw new Error(formatRateLimitError(rateInfo));

      // Short per-minute limit: wait and retry once
      const waitSec = Math.min(rateInfo.retryAfterSec ?? 30, 30);
      await new Promise(r => setTimeout(r, waitSec * 1_000));
      return doFetch(true);
    }
    return res;
  }

  return doFetch(false);
}

function countTextNodes(node: any): number {
  if (!node) return 0;
  if (!isRenderableFigmaNode(node)) return 0;
  let n = node.type === "TEXT" && node.characters?.trim() ? 1 : 0;
  for (const child of node.children ?? []) n += countTextNodes(child);
  return n;
}

export async function POST(req: NextRequest) {
  let fileKey: string, nodeId: string, pat: string;
  let skipNamePrefixes: string[] | undefined;
  let skipAncestorNames: string[] | undefined;
  try {
    ({ fileKey, nodeId, pat, skipNamePrefixes, skipAncestorNames } = await req.json() as {
      fileKey: string; nodeId: string; pat: string;
      skipNamePrefixes?: string[]; skipAncestorNames?: string[];
    });
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!fileKey || !nodeId || !pat) {
    return NextResponse.json({ error: "fileKey, nodeId, and pat are required" }, { status: 400 });
  }

  const db    = supabaseAdmin();
  const t0    = Date.now();
  let depthUsed = 10;

  // Content QA needs enough depth to include repeated cards and nested sections.
  // Start deeper so snapshots do not silently miss text nodes inside cards.
  let figmaData: any;
  try {
    const r10 = await figmaFetch(pat, `/files/${fileKey}/nodes?ids=${encodeURIComponent(nodeId)}&depth=10`);
    if (!r10.ok) {
      const txt = await r10.text().catch(() => "");
      return NextResponse.json({ error: `Figma API error ${r10.status}: ${txt.slice(0, 200)}` }, { status: r10.status >= 500 ? 502 : 422 });
    }
    figmaData = await r10.json();
    const rootDoc10 = figmaData?.nodes?.[nodeId]?.document;
    if (!rootDoc10) return NextResponse.json({ error: "Node not found in Figma response" }, { status: 404 });

    if (countTextNodes(rootDoc10) < 3) {
      // Retry with a little more depth for unusually nested files.
      const r12 = await figmaFetch(pat, `/files/${fileKey}/nodes?ids=${encodeURIComponent(nodeId)}&depth=12`);
      if (r12.ok) { figmaData = await r12.json(); depthUsed = 12; }
    }
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? String(e) }, { status: 503 });
  }

  const rootDoc = figmaData?.nodes?.[nodeId]?.document;
  if (!rootDoc) return NextResponse.json({ error: "Frame not found" }, { status: 404 });

  const normalized     = normalizeNodes(rootDoc, { skipNamePrefixes, skipAncestorNames });
  const syncDurationMs = Date.now() - t0;
  console.log("[figma-sync] visibility-filter", JSON.stringify(normalized.visibility_stats));

  // Insert a new snapshot row (append-only for versioning)
  const { data: snapRow, error: snapErr } = await db
    .from("figma_snapshots")
    .insert({
      file_key:         fileKey,
      node_id:          nodeId,
      frame_name:       normalized.frame_name,
      synced_at:        new Date().toISOString(),
      is_stale:         false,
      depth_used:       depthUsed,
      raw_node_count:   normalized.raw_node_count,
      text_node_count:  normalized.text_nodes.length,
      color_node_count: normalized.color_nodes.length,
      frame_bounds:     normalized.frame_bounds,
      sync_duration_ms: syncDurationMs,
    })
    .select("id")
    .single();

  if (snapErr || !snapRow) {
    return NextResponse.json({ error: snapErr?.message ?? "Failed to create snapshot" }, { status: 500 });
  }

  const snapshotId = snapRow.id as string;

  // Bulk-insert normalized rows
  if (normalized.text_nodes.length > 0) {
    const { error: te } = await db.from("snapshot_text").insert(
      normalized.text_nodes.map(n => ({ snapshot_id: snapshotId, ...n }))
    );
    if (te) console.error("[figma-sync] snapshot_text insert error:", te.message);
  }

  if (normalized.color_nodes.length > 0) {
    const { error: ce } = await db.from("snapshot_colors").insert(
      normalized.color_nodes.map(n => ({ snapshot_id: snapshotId, ...n }))
    );
    if (ce) console.error("[figma-sync] snapshot_colors insert error:", ce.message);
  }

  // Also upsert figma_node_cache for backward compatibility with existing scan fallback
  await db.from("figma_node_cache").upsert({
    file_key:    fileKey,
    node_id:     nodeId,
    figma_nodes: figmaData,
    style_map:   {},
    cached_at:   new Date().toISOString(),
  }, { onConflict: "file_key,node_id" });

  return NextResponse.json({
    snapshotId,
    frameName:       normalized.frame_name,
    textNodeCount:   normalized.text_nodes.length,
    colorNodeCount:  normalized.color_nodes.length,
    rawNodeCount:    normalized.raw_node_count,
    visibilityStats: normalized.visibility_stats,
    depthUsed,
    syncDurationMs,
  });
}

// GET: check if a valid snapshot exists without calling Figma
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const fileKey = searchParams.get("fileKey");
  const nodeId  = searchParams.get("nodeId");
  if (!fileKey || !nodeId) {
    return NextResponse.json({ error: "fileKey and nodeId are required" }, { status: 400 });
  }

  const db = supabaseAdmin();
  const { data } = await db
    .from("figma_snapshots")
    .select("id, frame_name, text_node_count, color_node_count, depth_used, synced_at, raw_node_count")
    .eq("file_key", fileKey)
    .eq("node_id", nodeId)
    .eq("is_stale", false)
    .gte("synced_at", FIGMA_VISIBILITY_SNAPSHOT_CUTOFF)
    .order("synced_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return NextResponse.json({ snapshot: data ?? null });
}
