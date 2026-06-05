/**
 * POST /api/feedback/classify
 * Backfills AI classification for items missing ai_classification,
 * and populates ai_suggested_action for items where it is NULL.
 */
import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { classifyComment } from "@/lib/ai/classify";

export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();

  const { data: membership } = await admin
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", user.id)
    .limit(1)
    .single();

  if (!membership) return NextResponse.json({ error: "No workspace" }, { status: 400 });

  // Find all items missing ai_classification OR missing the newer ai_suggested_action field
  const { data: items } = await admin
    .from("feedback_items")
    .select("id, created_at, figma_comment:figma_comments(raw_content)")
    .eq("workspace_id", membership.workspace_id)
    .or("ai_classification.is.null,ai_suggested_action.is.null");

  if (!items || items.length === 0) {
    return NextResponse.json({ classified: 0, message: "All items already classified" });
  }

  let classified = 0;
  for (const item of items) {
    const raw = item.figma_comment;
    const comment = (Array.isArray(raw) ? raw[0] : raw) as { raw_content: string } | null;
    if (!comment?.raw_content) continue;

    // Pass item created_at so the classifier can apply age-based suggested-action rules
    const ai = await classifyComment(comment.raw_content, item.created_at ?? undefined);
    if (!ai) continue;

    await admin.from("feedback_items").update({
      priority: ai.priority,
      ai_summary: ai.summary,
      ai_classification: ai.classification,
      ai_confidence: ai.confidence,
      ai_key_question: ai.key_question,
      ai_tags: ai.tags,
      ai_risk_flag: ai.risk_flag,
      ai_vague_flag: ai.vague_flag,
      ai_vague_reason: ai.vague_reason,
      ai_suggested_action: ai.suggested_action,
    }).eq("id", item.id);

    classified++;
  }

  return NextResponse.json({ classified, total: items.length });
}
