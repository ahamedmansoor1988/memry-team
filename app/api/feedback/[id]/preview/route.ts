/**
 * GET /api/feedback/:id/preview
 * Lazily fetches and caches the Figma frame preview for a feedback item.
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { fetchFramePreviews } from "@/lib/figma/sync";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();

  // Load the feedback item
  const { data: item } = await admin
    .from("feedback_items")
    .select("id, figma_node_id, figma_preview_url, figma_comment:figma_comments(figma_file:figma_files(figma_file_key, figma_pat))")
    .eq("id", id)
    .single();

  if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Already cached
  if (item.figma_preview_url) {
    return NextResponse.json({ url: item.figma_preview_url });
  }

  if (!item.figma_node_id) {
    return NextResponse.json({ url: null });
  }

  // Get PAT + file key from nested relation
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const comment = item.figma_comment as any;
  const rawFile = comment?.figma_file;
  const figmaFile = (Array.isArray(rawFile) ? rawFile[0] : rawFile) as { figma_file_key: string; figma_pat: string } | null;
  if (!figmaFile?.figma_pat || !figmaFile?.figma_file_key) {
    return NextResponse.json({ url: null });
  }

  try {
    const previews = await fetchFramePreviews(
      figmaFile.figma_file_key,
      [item.figma_node_id],
      figmaFile.figma_pat
    );

    const url = previews[item.figma_node_id] ?? null;

    if (url) {
      // Cache in DB so we never call Figma again for this item
      await admin.from("feedback_items")
        .update({ figma_preview_url: url })
        .eq("id", id);
    }

    return NextResponse.json({ url });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "RATE_LIMITED") {
      // Don't cache — tell the client to retry
      return NextResponse.json({ url: null, rate_limited: true }, { status: 429 });
    }
    console.error("[preview] error", e);
    return NextResponse.json({ url: null });
  }
}
