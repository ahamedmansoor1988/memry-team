/**
 * GET /api/feedback/:id/preview
 *
 * Lazily fetches and caches the Figma frame thumbnail for a feedback item.
 * Uses the Figma Images API via lib/figma/thumbnails.ts and stores the result
 * in feedback_items.preview_url so subsequent calls are instant.
 *
 * Returns: { preview_url: string | null }
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { getNodeThumbnail } from "@/lib/figma/thumbnails";

// ── Typed shapes for the nested PostgREST join ────────────────────────────────

interface FigmaFileJoin {
  figma_file_key: string;
  figma_pat: string;
}

interface FigmaCommentJoin {
  figma_file: FigmaFileJoin | FigmaFileJoin[] | null;
}

interface FeedbackItemRow {
  id: string;
  figma_node_id: string | null;
  preview_url: string | null;
  figma_comment: FigmaCommentJoin | FigmaCommentJoin[] | null;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();

  const { data: rawItem } = await admin
    .from("feedback_items")
    .select(`
      id, figma_node_id, preview_url,
      figma_comment:figma_comments(
        figma_file:figma_files(figma_file_key, figma_pat)
      )
    `)
    .eq("id", id)
    .single();

  if (!rawItem) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const item = rawItem as unknown as FeedbackItemRow;

  // ── Cache hit ─────────────────────────────────────────────────────────────
  if (item.preview_url) {
    return NextResponse.json({ preview_url: item.preview_url });
  }

  // No node ID → no image to fetch
  if (!item.figma_node_id) {
    return NextResponse.json({ preview_url: null });
  }

  // ── Unwrap nested PostgREST join (may be array or object) ─────────────────
  const commentRaw = item.figma_comment;
  const comment    = Array.isArray(commentRaw) ? commentRaw[0] : commentRaw;
  const fileRaw    = comment?.figma_file ?? null;
  const figmaFile  = Array.isArray(fileRaw) ? fileRaw[0] : fileRaw;

  if (!figmaFile?.figma_pat || !figmaFile?.figma_file_key) {
    return NextResponse.json({ preview_url: null });
  }

  // ── Fetch from Figma ───────────────────────────────────────────────────────
  const url = await getNodeThumbnail(
    figmaFile.figma_file_key,
    item.figma_node_id,
    figmaFile.figma_pat,
  );

  // Persist so the next request is a cache hit
  if (url) {
    await admin
      .from("feedback_items")
      .update({ preview_url: url })
      .eq("id", id);
  }

  return NextResponse.json({ preview_url: url });
}
