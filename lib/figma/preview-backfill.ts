/**
 * Backfills missing figma_preview_url for feedback_items.
 * Groups by file key so we make one Figma Images API call per file.
 */
import { createAdminClient } from "@/lib/supabase/server";
import { figmaHeaders } from "./api";

const FIGMA_API = "https://api.figma.com/v1";

export async function backfillPreviews(workspaceId: string, pat: string): Promise<number> {
  const admin = createAdminClient();

  const { data: items } = await admin
    .from("feedback_items")
    .select(`
      id, figma_node_id,
      figma_comment:figma_comments(
        figma_file:figma_files(figma_file_key, figma_pat)
      )
    `)
    .eq("workspace_id", workspaceId)
    .is("figma_preview_url", null);

  if (!items?.length) return 0;

  // Group by file key
  const byFile = new Map<string, { id: string; nodeId: string }[]>();
  for (const item of items) {
    const commentRaw = item.figma_comment;
    const comment = Array.isArray(commentRaw) ? commentRaw[0] : commentRaw;
    const fileRaw = (comment as { figma_file?: unknown })?.figma_file;
    const file = (Array.isArray(fileRaw) ? fileRaw[0] : fileRaw) as { figma_file_key?: string } | null;
    const fileKey = file?.figma_file_key;
    if (!fileKey || !item.figma_node_id) continue;

    if (!byFile.has(fileKey)) byFile.set(fileKey, []);
    byFile.get(fileKey)!.push({ id: item.id, nodeId: item.figma_node_id });
  }

  let updated = 0;

  for (const fileKey of Array.from(byFile.keys())) {
    const fileItems = byFile.get(fileKey)!;

    // 1. Try node-level PNGs (best quality, exact frame)
    const nodeItems = fileItems.filter(i => i.nodeId);
    if (nodeItems.length > 0) {
      try {
        const nodeIds = nodeItems.map(i => i.nodeId!);
        const res = await fetch(
          `${FIGMA_API}/images/${fileKey}?ids=${encodeURIComponent(nodeIds.join(","))}&format=png&scale=1`,
          { headers: figmaHeaders(pat) },
        );
        if (res.ok) {
          const data = await res.json() as { images?: Record<string, string | null> };
          const images = data.images ?? {};
          for (const item of nodeItems) {
            const url = images[item.nodeId!];
            if (!url) continue;
            await admin.from("feedback_items").update({ figma_preview_url: url }).eq("id", item.id);
            updated++;
          }
        }
      } catch { /* non-blocking */ }
    }

    // 2. For any still-missing items, fall back to the file's cover thumbnail
    const stillMissing = fileItems.filter(i => !nodeItems.find(n => n.id === i.id && updated > 0));
    if (stillMissing.length > 0) {
      try {
        const metaRes = await fetch(
          `${FIGMA_API}/files/${fileKey}/images`,
          { headers: figmaHeaders(pat) },
        );
        if (metaRes.ok) {
          // Just use the file thumbnail from the file metadata as last resort
          const fileRes = await fetch(`${FIGMA_API}/files/${fileKey}?depth=0`, { headers: figmaHeaders(pat) });
          if (fileRes.ok) {
            const fileMeta = await fileRes.json() as { thumbnailUrl?: string };
            if (fileMeta.thumbnailUrl) {
              for (const item of stillMissing) {
                await admin.from("feedback_items")
                  .update({ figma_preview_url: fileMeta.thumbnailUrl })
                  .eq("id", item.id);
                updated++;
              }
            }
          }
        }
      } catch { /* non-blocking */ }
    }
  }

  return updated;
}
