/**
 * Embedding pipeline for the Linker Agent.
 * Jina AI jina-embeddings-v3 (1024 dims, free tier). Embeddings are stored in
 * item_embeddings and skipped when the source text hash is unchanged.
 */
import { createHash } from "crypto";
import { createAdminClient } from "@/lib/supabase/server";

const EMBED_MODEL = "jina-embeddings-v3";
const EMBED_DIMS  = 1024;

export interface LinkableItem {
  item_type: "feedback_item" | "decision";
  item_id:   string;
  text:      string;
  created_at: string;
}

function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 32);
}

export async function embedText(text: string): Promise<number[]> {
  const apiKey = process.env.JINA_API_KEY;
  if (!apiKey) throw new Error("JINA_API_KEY is not set — the Linker needs it for embeddings");

  const res = await fetch("https://api.jina.ai/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model:           EMBED_MODEL,
      dimensions:      EMBED_DIMS,
      task:            "retrieval.passage",
      input:           [text.slice(0, 8000)],
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Embedding request failed (${res.status}): ${body.slice(0, 200)}`);
  }
  const data = await res.json() as { data: { embedding: number[] }[] };
  return data.data[0].embedding;
}

/**
 * Embed an item and persist it. Returns the embedding.
 * Skips the API call when the stored hash matches.
 */
export async function ensureEmbedding(
  workspaceId: string,
  item: LinkableItem,
): Promise<number[] | null> {
  const admin = createAdminClient();
  const hash  = hashText(item.text);

  const { data: existing } = await admin
    .from("item_embeddings")
    .select("embedded_text_hash, embedding")
    .eq("item_type", item.item_type)
    .eq("item_id", item.item_id)
    .maybeSingle();

  const row = existing as { embedded_text_hash: string; embedding: unknown } | null;
  if (row?.embedded_text_hash === hash) {
    // pgvector returns the vector as a string like "[0.1,0.2,...]"
    if (typeof row.embedding === "string") {
      try { return JSON.parse(row.embedding) as number[]; } catch { /* re-embed */ }
    }
  }

  const embedding = await embedText(item.text);
  const { error } = await admin.from("item_embeddings").upsert({
    workspace_id:       workspaceId,
    item_type:          item.item_type,
    item_id:            item.item_id,
    embedding:          JSON.stringify(embedding),
    embedded_text_hash: hash,
  }, { onConflict: "item_type,item_id" });

  if (error) {
    console.error("[linker] embedding upsert failed:", error.message);
    return null;
  }
  return embedding;
}

/** Build the embeddable text for a feedback item row. */
export function feedbackItemText(item: {
  ai_key_question?: string | null;
  ai_summary?: string | null;
  raw_content?: string | null;
  project_name?: string | null;
}): string {
  const parts = [
    item.ai_key_question && item.ai_key_question !== "None" ? item.ai_key_question : null,
    item.ai_summary,
    item.raw_content,
    item.project_name ? `Project: ${item.project_name}` : null,
  ].filter(Boolean);
  return parts.join("\n");
}

/** Build the embeddable text for a decision row. */
export function decisionText(d: {
  decision_text: string;
  reason?: string | null;
  slack_channel_name?: string | null;
}): string {
  const parts = [
    d.decision_text,
    d.reason,
    d.slack_channel_name ? `Channel: #${d.slack_channel_name}` : null,
  ].filter(Boolean);
  return parts.join("\n");
}
