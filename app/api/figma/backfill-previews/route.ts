/**
 * POST /api/figma/backfill-previews
 * Fetches Figma node thumbnail URLs for any feedback_items missing figma_preview_url.
 * Safe to call multiple times — skips items that already have a URL.
 */
import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { figmaHeaders } from "@/lib/figma/api";

const FIGMA_API = "https://api.figma.com/v1";

export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();

  // Find all items missing preview URLs that have a node_id
  const { data: items } = await admin
    .from("feedback_items")
    .select(`
      id, figma_node_id,
      figma_comment:figma_comments(
        figma_file:figma_files(figma_file_key, figma_pat)
      )
    `)
    .is("figma_preview_url", null)
    .not("figma_node_id", "is", null);

  if (!items?.length) return NextResponse.json({ updated: 0 });

  // Group by file key so we can batch the Figma Images API calls
  const byFile = new Map<string, { pat: string; items: { id: string; nodeId: string }[] }>();

  for (const item of items) {
    const commentRaw = item.figma_comment;
    const comment = Array.isArray(commentRaw) ? commentRaw[0] : commentRaw;
    const fileRaw = (comment as { figma_file?: unknown })?.figma_file;
    const file = (Array.isArray(fileRaw) ? fileRaw[0] : fileRaw) as { figma_file_key?: string; figma_pat?: string } | null;

    const fileKey = file?.figma_file_key;
    const pat = file?.figma_pat;
    if (!fileKey || !pat || !item.figma_node_id) continue;

    if (!byFile.has(fileKey)) byFile.set(fileKey, { pat, items: [] });
    byFile.get(fileKey)!.items.push({ id: item.id, nodeId: item.figma_node_id });
  }

  let updated = 0;

  for (const fileKey of Array.from(byFile.keys())) {
    const { pat, items: fileItems } = byFile.get(fileKey)!;
    // Batch up to 100 node IDs per request
    const nodeIds = fileItems.map(i => i.nodeId);
    try {
      const res = await fetch(
        `${FIGMA_API}/images/${fileKey}?ids=${encodeURIComponent(nodeIds.join(","))}&format=png&scale=1`,
        { headers: figmaHeaders(pat) },
      );
      if (!res.ok) {
        console.error("[backfill-previews] Figma API error", res.status, await res.text());
        continue;
      }
      const data = await res.json() as { images?: Record<string, string | null>; err?: string };
      const images = data.images ?? {};

      for (const item of fileItems) {
        const url = images[item.nodeId];
        if (!url) continue;
        await admin.from("feedback_items").update({ figma_preview_url: url }).eq("id", item.id);
        updated++;
      }
    } catch (e) {
      console.error("[backfill-previews] error for file", fileKey, e);
    }
  }

  return NextResponse.json({ updated });
}
