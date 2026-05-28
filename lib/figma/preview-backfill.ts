/**
 * Backfills design_references + figma_preview_url for existing feedback_items.
 *
 * Covers two cases:
 *   1. Items with figma_preview_url but no design_reference_id  → create design_reference (status: ready)
 *   2. Items with no figma_preview_url at all                   → fetch from Figma Images API, then create design_reference
 *
 * Groups by file key to minimise Figma API calls.
 */
import { createAdminClient } from "@/lib/supabase/server";
import { figmaHeaders } from "./api";

const FIGMA_API = "https://api.figma.com/v1";

interface BackfillItem {
  id: string;
  figma_node_id: string | null;
  figma_preview_url: string | null;
  design_reference_id: string | null;
  workspace_id: string;
  figma_comment: {
    page_name: string | null;
    frame_name: string | null;
    figma_file: { figma_file_key: string; figma_pat: string } | null;
  } | null;
}

export async function backfillPreviews(workspaceId: string, pat: string): Promise<number> {
  const admin = createAdminClient();

  // Fetch items that either:
  //  - have no design_reference_id (need linking), OR
  //  - have no figma_preview_url (need thumbnail fetch)
  const { data: rawItems } = await admin
    .from("feedback_items")
    .select(`
      id, figma_node_id, figma_preview_url, design_reference_id, workspace_id,
      figma_comment:figma_comments(
        page_name, frame_name,
        figma_file:figma_files(figma_file_key, figma_pat)
      )
    `)
    .eq("workspace_id", workspaceId)
    .or("design_reference_id.is.null,figma_preview_url.is.null");

  if (!rawItems?.length) return 0;

  // Normalise joins
  const items: BackfillItem[] = rawItems.map(item => {
    const commentRaw = item.figma_comment;
    const comment = (Array.isArray(commentRaw) ? commentRaw[0] : commentRaw) as {
      page_name?: string | null; frame_name?: string | null;
      figma_file?: unknown;
    } | null;
    const fileRaw = comment?.figma_file;
    const file = (Array.isArray(fileRaw) ? fileRaw[0] : fileRaw) as {
      figma_file_key?: string; figma_pat?: string;
    } | null;

    return {
      id: item.id,
      figma_node_id: item.figma_node_id ?? null,
      figma_preview_url: item.figma_preview_url ?? null,
      design_reference_id: item.design_reference_id ?? null,
      workspace_id: item.workspace_id,
      figma_comment: file?.figma_file_key ? {
        page_name: comment?.page_name ?? null,
        frame_name: comment?.frame_name ?? null,
        figma_file: {
          figma_file_key: file.figma_file_key!,
          figma_pat: file.figma_pat ?? pat,
        },
      } : null,
    };
  });

  // Group by file key
  const byFile = new Map<string, BackfillItem[]>();
  for (const item of items) {
    const fileKey = item.figma_comment?.figma_file?.figma_file_key;
    if (!fileKey) continue;
    if (!byFile.has(fileKey)) byFile.set(fileKey, []);
    byFile.get(fileKey)!.push(item);
  }

  let updated = 0;

  for (const fileKey of Array.from(byFile.keys())) {
    const fileItems = byFile.get(fileKey)!;

    // ── Step 1: fetch node-level PNGs for items that need preview URL ──
    const needsImage = fileItems.filter(i => !i.figma_preview_url && i.figma_node_id);
    const imageMap = new Map<string, string>(); // nodeId → url

    if (needsImage.length > 0) {
      try {
        const nodeIds = Array.from(new Set(needsImage.map(i => i.figma_node_id!)));
        const chunks = chunkArray(nodeIds, 100);
        for (const chunk of chunks) {
          const res = await fetch(
            `${FIGMA_API}/images/${fileKey}?ids=${encodeURIComponent(chunk.join(","))}&format=png&scale=1`,
            { headers: figmaHeaders(pat) },
          );
          if (res.ok) {
            const data = await res.json() as { images?: Record<string, string | null> };
            for (const [nid, url] of Object.entries(data.images ?? {})) {
              if (url) imageMap.set(nid, url);
            }
          }
        }
      } catch (e) {
        console.warn("[backfill] node images fetch failed:", e);
      }
    }

    // ── Step 2: fallback to file thumbnail for items still missing a URL ──
    let fileThumbnail: string | null = null;
    const stillMissing = needsImage.filter(i => !imageMap.has(i.figma_node_id!));
    if (stillMissing.length > 0) {
      try {
        const fileRes = await fetch(`${FIGMA_API}/files/${fileKey}?depth=0`, { headers: figmaHeaders(pat) });
        if (fileRes.ok) {
          const fileMeta = await fileRes.json() as { thumbnailUrl?: string };
          fileThumbnail = fileMeta.thumbnailUrl ?? null;
        }
      } catch { /* non-blocking */ }
    }

    // ── Step 3: upsert design_references + update feedback_items ──
    for (const item of fileItems) {
      const nodeId = item.figma_node_id;
      const pageName = item.figma_comment?.page_name ?? null;
      const frameName = item.figma_comment?.frame_name ?? null;

      // Resolve thumbnail URL
      const thumbUrl = item.figma_preview_url
        ?? (nodeId ? imageMap.get(nodeId) ?? null : null)
        ?? fileThumbnail
        ?? null;

      // Upsert design_reference if node_id is available
      let designRefId = item.design_reference_id;
      if (nodeId) {
        const { data: dr } = await admin
          .from("design_references")
          .upsert({
            workspace_id: workspaceId,
            file_key: fileKey,
            node_id: nodeId,
            frame_name: frameName,
            page_name: pageName,
            thumbnail_url: thumbUrl,
            preview_status: thumbUrl ? "ready" : "failed",
            updated_at: new Date().toISOString(),
          }, { onConflict: "workspace_id,file_key,node_id" })
          .select("id")
          .single();

        if (dr) designRefId = (dr as { id: string }).id;
      }

      // Update feedback_item
      const patch: Record<string, unknown> = {};
      if (!item.figma_preview_url && thumbUrl) patch.figma_preview_url = thumbUrl;
      if (!item.design_reference_id && designRefId) patch.design_reference_id = designRefId;

      if (Object.keys(patch).length > 0) {
        await admin.from("feedback_items").update(patch).eq("id", item.id);
        updated++;
      }
    }
  }

  return updated;
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}
