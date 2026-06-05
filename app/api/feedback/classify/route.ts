/**
 * GET|POST /api/feedback/classify
 *
 * Pass 1 — items with no ai_classification: full Groq classify, writes all AI fields
 *           including ai_suggested_action.
 * Pass 2 — items already classified but missing ai_suggested_action: computed
 *           deterministically from existing fields (no Groq call, no schema-cache
 *           dependency in the WHERE clause).
 */
import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { classifyComment, deriveSuggestedAction, ClassifyResult } from "@/lib/ai/classify";

export async function GET() { return handler(); }
export async function POST() { return handler(); }

async function handler() {
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

  const wsId = membership.workspace_id as string;
  let classified = 0;

  // ── Pass 1: fully unclassified items → run Groq ───────────────────────────
  const { data: unclassified } = await admin
    .from("feedback_items")
    .select("id, created_at, figma_comment:figma_comments(raw_content)")
    .eq("workspace_id", wsId)
    .is("ai_classification", null)
    .is("deleted_at", null);

  for (const item of unclassified ?? []) {
    const raw = item.figma_comment;
    const comment = (Array.isArray(raw) ? raw[0] : raw) as { raw_content: string } | null;
    if (!comment?.raw_content) continue;

    const ai = await classifyComment(comment.raw_content, item.created_at ?? undefined);
    if (!ai) continue;

    await admin.from("feedback_items").update({
      priority:             ai.priority,
      ai_summary:           ai.summary,
      ai_classification:    ai.classification,
      ai_confidence:        ai.confidence,
      ai_key_question:      ai.key_question,
      ai_tags:              ai.tags,
      ai_risk_flag:         ai.risk_flag,
      ai_vague_flag:        ai.vague_flag,
      ai_vague_reason:      ai.vague_reason,
      ai_suggested_action:  ai.suggested_action,
    }).eq("id", item.id);

    classified++;
  }

  // ── Pass 2: already classified → fill ai_suggested_action deterministically ─
  // We don't filter on ai_suggested_action here (avoids PostgREST schema-cache
  // issues right after a migration). The update is idempotent — re-computing
  // the same value for already-populated items is harmless.
  const { data: alreadyClassified } = await admin
    .from("feedback_items")
    .select("id, created_at, ai_classification, ai_vague_flag")
    .eq("workspace_id", wsId)
    .not("ai_classification", "is", null)
    .is("deleted_at", null);

  for (const item of alreadyClassified ?? []) {
    const ageInDays = item.created_at
      ? Math.floor((Date.now() - new Date(item.created_at).getTime()) / 86_400_000)
      : 0;

    const action = deriveSuggestedAction(
      item.ai_classification as ClassifyResult["classification"],
      (item.ai_vague_flag as boolean | null) ?? false,
      ageInDays,
    );

    await admin
      .from("feedback_items")
      .update({ ai_suggested_action: action })
      .eq("id", item.id);

    classified++;
  }

  const total = (unclassified?.length ?? 0) + (alreadyClassified?.length ?? 0);
  return NextResponse.json({ classified, total });
}
