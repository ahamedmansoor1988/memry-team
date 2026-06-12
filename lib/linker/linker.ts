/**
 * Linker Agent core (Sprint 35).
 *
 * For one item (feedback_item or decision):
 *   1. embed it
 *   2. retrieve nearest neighbours via pgvector (cosine ≥ 0.75)
 *   3. ask the LLM whether the best candidate group is the same
 *      organizational topic (vectors find lookalikes; the LLM rejects
 *      false friends)
 *   4. act by confidence: ≥ 0.85 auto-link · 0.60–0.85 suggest · else drop
 *
 * The same function serves real-time ingestion and historical backfill —
 * backfill is just a chronological replay.
 */
import Groq from "groq-sdk";
import { createAdminClient } from "@/lib/supabase/server";
import {
  ensureEmbedding, feedbackItemText, decisionText, type LinkableItem,
} from "@/lib/linker/embeddings";

const VERDICT_MODEL    = "llama-3.3-70b-versatile";
const RETRIEVE_MIN     = 0.75;
const AUTO_LINK_MIN    = 0.85;
const SUGGEST_MIN      = 0.60;
const CANDIDATE_COUNT  = 6;

export type ItemType = "feedback_item" | "decision";

export interface LinkResult {
  action: "auto_linked" | "suggested" | "none" | "skipped" | "error";
  topic_id?: string;
  topic_title?: string;
  confidence?: number;
  cross_source?: boolean;
}

interface ItemContext {
  linkable:   LinkableItem;
  source:     "figma" | "slack" | "manual";
  label:      string;          // short description for the verdict prompt
  project:    string | null;
}

// ── Load an item with enough context for the verdict prompt ────────────────

async function loadItem(
  workspaceId: string, itemType: ItemType, itemId: string,
): Promise<ItemContext | null> {
  const admin = createAdminClient();

  if (itemType === "feedback_item") {
    const { data } = await admin
      .from("feedback_items")
      .select(`
        id, ai_key_question, ai_summary, created_at,
        project:projects!project_id(name),
        figma_comment:figma_comments!figma_comment_id(raw_content)
      `)
      .eq("id", itemId)
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    if (!data) return null;
    const row = data as {
      id: string; ai_key_question: string | null; ai_summary: string | null;
      created_at: string;
      project: { name: string } | { name: string }[] | null;
      figma_comment: { raw_content: string | null } | { raw_content: string | null }[] | null;
    };
    const project = row.project ? (Array.isArray(row.project) ? row.project[0] : row.project) : null;
    const comment = row.figma_comment ? (Array.isArray(row.figma_comment) ? row.figma_comment[0] : row.figma_comment) : null;
    const text = feedbackItemText({
      ai_key_question: row.ai_key_question,
      ai_summary:      row.ai_summary,
      raw_content:     comment?.raw_content,
      project_name:    project?.name ?? null,
    });
    if (!text.trim()) return null;
    return {
      linkable: { item_type: "feedback_item", item_id: row.id, text, created_at: row.created_at },
      source:   "figma",
      label:    `Figma discussion (${project?.name ?? "no project"}, ${row.created_at.slice(0, 10)}): ${text.slice(0, 300)}`,
      project:  project?.name ?? null,
    };
  }

  const { data } = await admin
    .from("decisions")
    .select("id, decision_text, reason, source, slack_channel_name, decided_at, created_at")
    .eq("id", itemId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (!data) return null;
  const row = data as {
    id: string; decision_text: string; reason: string | null; source: string;
    slack_channel_name: string | null; decided_at: string; created_at: string;
  };
  const text = decisionText(row);
  return {
    linkable: { item_type: "decision", item_id: row.id, text, created_at: row.created_at ?? row.decided_at },
    source:   row.source === "slack" ? "slack" : "manual",
    label:    `Decision (${row.source === "slack" ? `Slack #${row.slack_channel_name ?? "?"}` : "from feedback"}, ${row.decided_at.slice(0, 10)}): ${text.slice(0, 300)}`,
    project:  null,
  };
}

// ── Verdict ─────────────────────────────────────────────────────────────────

interface Verdict { same_topic: boolean; confidence: number; title: string }

async function verdict(newItem: ItemContext, candidateLabels: string[]): Promise<Verdict | null> {
  const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  try {
    const completion = await groq.chat.completions.create({
      model: VERDICT_MODEL,
      temperature: 0,
      max_tokens: 200,
      response_format: { type: "json_object" },
      messages: [{
        role: "user",
        content: `You judge whether workplace discussions are about the SAME organizational topic (the same underlying question or decision), not merely similar subjects.

NEW ITEM:
${newItem.label}

EXISTING GROUP:
${candidateLabels.map((c, i) => `${i + 1}. ${c}`).join("\n")}

Same topic means: a person reading both would say "this is one conversation continued across tools" — e.g. a Figma question about fonts and a Slack decision choosing a font. Different projects discussing similar subjects (e.g. button colors in two unrelated apps) are NOT the same topic.

Reply with JSON only:
{"same_topic": true/false, "confidence": 0.0-1.0, "title": "short neutral title for the shared topic, max 8 words"}`,
      }],
    });
    const raw = completion.choices[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(raw) as Partial<Verdict>;
    if (typeof parsed.same_topic !== "boolean" || typeof parsed.confidence !== "number") return null;
    return {
      same_topic: parsed.same_topic,
      confidence: Math.max(0, Math.min(1, parsed.confidence)),
      title:      (parsed.title ?? "Linked discussion").slice(0, 80),
    };
  } catch (e) {
    console.error("[linker] verdict failed:", e instanceof Error ? e.message : e);
    return null;
  }
}

// ── Main entry ──────────────────────────────────────────────────────────────

export async function linkItem(
  workspaceId: string, itemType: ItemType, itemId: string,
): Promise<LinkResult> {
  const admin = createAdminClient();

  // Already actively linked → nothing to do
  const { data: existingLink } = await admin
    .from("topic_links")
    .select("id, status")
    .eq("workspace_id", workspaceId)
    .eq("item_type", itemType)
    .eq("item_id", itemId)
    .eq("status", "active")
    .limit(1).maybeSingle();
  if (existingLink) return { action: "skipped" };

  const ctx = await loadItem(workspaceId, itemType, itemId);
  if (!ctx) return { action: "skipped" };

  let embedding: number[] | null;
  try {
    embedding = await ensureEmbedding(workspaceId, ctx.linkable);
  } catch (e) {
    console.error("[linker]", e instanceof Error ? e.message : e);
    return { action: "error" };
  }
  if (!embedding) return { action: "error" };

  // Nearest neighbours
  const { data: matches, error: matchError } = await admin.rpc("match_items", {
    p_workspace_id: workspaceId,
    p_embedding:    JSON.stringify(embedding),
    p_threshold:    RETRIEVE_MIN,
    p_count:        CANDIDATE_COUNT,
    p_exclude_type: itemType,
    p_exclude_id:   itemId,
  });
  if (matchError) {
    console.error("[linker] match_items failed:", matchError.message);
    return { action: "error" };
  }
  const neighbours = (matches ?? []) as { item_type: ItemType; item_id: string; similarity: number }[];
  if (neighbours.length === 0) return { action: "none" };

  // Resolve the best candidate group: the topic of the closest neighbour,
  // or the bare neighbour itself if it has no topic yet.
  const best = neighbours[0];
  const { data: bestLink } = await admin
    .from("topic_links")
    .select("topic_id")
    .eq("workspace_id", workspaceId)
    .eq("item_type", best.item_type)
    .eq("item_id", best.item_id)
    .eq("status", "active")
    .limit(1).maybeSingle();
  const targetTopicId = (bestLink as { topic_id: string } | null)?.topic_id ?? null;

  // Rejection memory — never re-suggest a dismissed pairing
  if (targetTopicId) {
    const { data: rejected } = await admin
      .from("topic_link_rejections")
      .select("topic_id")
      .eq("workspace_id", workspaceId)
      .eq("item_type", itemType)
      .eq("item_id", itemId)
      .eq("topic_id", targetTopicId)
      .maybeSingle();
    if (rejected) return { action: "none" };
  }

  // Build candidate labels for the verdict (topic members, or the bare item)
  let candidateLabels: string[] = [];
  let candidateSources = new Set<string>();
  if (targetTopicId) {
    const { data: members } = await admin
      .from("topic_links")
      .select("item_type, item_id")
      .eq("topic_id", targetTopicId)
      .eq("status", "active")
      .limit(5);
    for (const m of (members ?? []) as { item_type: ItemType; item_id: string }[]) {
      const mc = await loadItem(workspaceId, m.item_type, m.item_id);
      if (mc) { candidateLabels.push(mc.label); candidateSources.add(mc.source); }
    }
  } else {
    const bc = await loadItem(workspaceId, best.item_type, best.item_id);
    if (bc) { candidateLabels = [bc.label]; candidateSources.add(bc.source); }
  }
  if (candidateLabels.length === 0) return { action: "none" };

  const v = await verdict(ctx, candidateLabels);
  if (!v || !v.same_topic || v.confidence < SUGGEST_MIN) return { action: "none" };

  const crossSource = !candidateSources.has(ctx.source) && candidateSources.size > 0;
  const isAuto = v.confidence >= AUTO_LINK_MIN;
  const status = isAuto ? "active" : "suggested";

  // Join existing topic, or create one (linking both the new item and the
  // bare neighbour that anchored the match)
  let topicId = targetTopicId;
  if (!topicId) {
    const { data: topic, error: topicError } = await admin
      .from("topics")
      .insert({ workspace_id: workspaceId, title: v.title })
      .select("id").single();
    if (topicError || !topic) {
      console.error("[linker] topic insert failed:", topicError?.message);
      return { action: "error" };
    }
    topicId = (topic as { id: string }).id;
    await admin.from("topic_links").insert({
      topic_id: topicId, workspace_id: workspaceId,
      item_type: best.item_type, item_id: best.item_id,
      confidence: v.confidence, status: "active", linked_by: "linker",
    });
  }

  const { error: linkError } = await admin.from("topic_links").insert({
    topic_id: topicId, workspace_id: workspaceId,
    item_type: itemType, item_id: itemId,
    confidence: v.confidence, status, linked_by: "linker",
  });
  if (linkError) {
    console.error("[linker] link insert failed:", linkError.message);
    return { action: "error" };
  }

  await admin.from("topics").update({ updated_at: new Date().toISOString() }).eq("id", topicId);

  // Visibility: workspace notification for confident cross-source links
  if (isAuto && crossSource) {
    await admin.from("notifications").insert({
      workspace_id: workspaceId,
      user_id: null,
      type: "discussions_linked",
      title: "Memry connected discussions",
      body: `A ${ctx.source === "slack" ? "Slack" : "Figma"} ${itemType === "decision" ? "decision" : "discussion"} was linked to "${v.title}" across tools.`,
      feedback_item_id: itemType === "feedback_item" ? itemId : null,
    });
  }

  return {
    action: isAuto ? "auto_linked" : "suggested",
    topic_id: topicId,
    topic_title: v.title,
    confidence: v.confidence,
    cross_source: crossSource,
  };
}

/**
 * Sweep: link every item that has no embedding yet (the idempotency marker),
 * oldest first — used by ingestion hooks and historical backfill alike.
 */
export async function linkUnprocessed(
  workspaceId: string, limit = 50,
): Promise<{ processed: number; auto_linked: number; suggested: number; errors: number }> {
  const admin = createAdminClient();
  const stats = { processed: 0, auto_linked: 0, suggested: 0, errors: 0 };

  const [{ data: items }, { data: decisions }, { data: embedded }] = await Promise.all([
    admin.from("feedback_items")
      .select("id, created_at")
      .eq("workspace_id", workspaceId)
      .is("deleted_at", null)
      .order("created_at", { ascending: true })
      .limit(500),
    admin.from("decisions")
      .select("id, created_at")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: true })
      .limit(500),
    admin.from("item_embeddings")
      .select("item_type, item_id")
      .eq("workspace_id", workspaceId),
  ]);

  const done = new Set(
    ((embedded ?? []) as { item_type: string; item_id: string }[])
      .map(e => `${e.item_type}:${e.item_id}`)
  );

  const queue: { item_type: ItemType; item_id: string; created_at: string }[] = [
    ...((items ?? []) as { id: string; created_at: string }[])
      .map(i => ({ item_type: "feedback_item" as const, item_id: i.id, created_at: i.created_at })),
    ...((decisions ?? []) as { id: string; created_at: string }[])
      .map(d => ({ item_type: "decision" as const, item_id: d.id, created_at: d.created_at })),
  ]
    .filter(q => !done.has(`${q.item_type}:${q.item_id}`))
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
    .slice(0, limit);

  for (const q of queue) {
    const result = await linkItem(workspaceId, q.item_type, q.item_id);
    stats.processed += 1;
    if (result.action === "auto_linked") stats.auto_linked += 1;
    if (result.action === "suggested")   stats.suggested += 1;
    if (result.action === "error")       stats.errors += 1;
  }
  return stats;
}
