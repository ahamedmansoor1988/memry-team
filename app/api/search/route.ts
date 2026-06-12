/**
 * GET /api/search?q=query&limit=20
 * Semantic search (Jina embeddings + pgvector) across feedback_items and decisions.
 * Falls back to ilike substring matching when JINA_API_KEY is not set.
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";

const SEARCH_THRESHOLD = 0.35; // lower than linker (0.75) — search needs recall
const EMBED_MODEL      = "jina-embeddings-v3";
const EMBED_DIMS       = 1024;

type RawRow = {
  id:                string;
  status:            string;
  ai_classification: string | null;
  ai_key_question:   string | null;
  ai_summary:        string | null;
  priority:          string | null;
  ai_risk_flag:      boolean | null;
  updated_at:        string;
  project_id:        string | null;
  project:           { name: string } | { name: string }[] | null;
  comment:           { raw_content: string | null; author_name: string | null } | { raw_content: string | null; author_name: string | null }[] | null;
};

async function embedQuery(text: string): Promise<number[] | null> {
  const apiKey = process.env.JINA_API_KEY;
  if (!apiKey) return null;
  try {
    const res = await fetch("https://api.jina.ai/v1/embeddings", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body: JSON.stringify({
        model:      EMBED_MODEL,
        dimensions: EMBED_DIMS,
        task:       "retrieval.query",
        input:      [text.slice(0, 2000)],
      }),
    });
    if (!res.ok) return null;
    const data = await res.json() as { data: { embedding: number[] }[] };
    return data.data[0].embedding;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url   = new URL(req.url);
  const q     = url.searchParams.get("q")?.trim() ?? "";
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 20), 50);

  if (!q) return NextResponse.json({ results: [], query: "" });

  const admin = createAdminClient();

  const { data: membership } = await admin
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", user.id)
    .limit(1)
    .single();

  const workspaceId = (membership as { workspace_id: string } | null)?.workspace_id;
  if (!workspaceId) return NextResponse.json({ results: [], query: q });

  // ── Try semantic search first ──────────────────────────────────────────────
  const embedding = await embedQuery(q);

  if (embedding) {
    const { data: matches, error: rpcError } = await admin.rpc("match_items", {
      p_workspace_id: workspaceId,
      p_embedding:    JSON.stringify(embedding),
      p_threshold:    SEARCH_THRESHOLD,
      p_count:        limit * 2, // fetch extra — we'll split by type
      p_exclude_type: "",
      p_exclude_id:   "00000000-0000-0000-0000-000000000000",
    });

    if (!rpcError && matches) {
      const typedMatches = matches as { item_type: string; item_id: string; similarity: number }[];
      const feedbackIds  = typedMatches.filter(m => m.item_type === "feedback_item").slice(0, limit).map(m => m.item_id);
      const decisionIds  = typedMatches.filter(m => m.item_type === "decision").slice(0, limit).map(m => m.item_id);

      const [{ data: rows }, { data: decisionRows }] = await Promise.all([
        feedbackIds.length > 0
          ? admin
              .from("feedback_items")
              .select(`
                id, status, ai_classification, ai_key_question, ai_summary,
                priority, ai_risk_flag, updated_at, project_id,
                project:projects!project_id(name),
                comment:figma_comments!figma_comment_id(raw_content, author_name)
              `)
              .in("id", feedbackIds)
              .is("deleted_at", null)
          : Promise.resolve({ data: [] as RawRow[] }),
        decisionIds.length > 0
          ? admin
              .from("decisions")
              .select("id, decision_text, reason, owner_name, source, decided_at, feedback_item_id, project_id, slack_channel_name, slack_thread_url")
              .in("id", decisionIds)
          : Promise.resolve({ data: [] }),
      ]);

      // Re-order rows to match similarity rank from match_items
      const feedbackOrder = new Map(feedbackIds.map((id, i) => [id, i]));
      const sortedRows    = ((rows ?? []) as RawRow[]).sort((a, b) => (feedbackOrder.get(a.id) ?? 99) - (feedbackOrder.get(b.id) ?? 99));

      const results = sortedRows.map(r => {
        const project = r.project ? (Array.isArray(r.project) ? r.project[0] : r.project) : null;
        const comment = r.comment ? (Array.isArray(r.comment) ? r.comment[0] : r.comment) : null;
        return {
          id:                r.id,
          status:            r.status,
          ai_classification: r.ai_classification,
          ai_key_question:   r.ai_key_question,
          ai_summary:        r.ai_summary,
          priority:          r.priority,
          ai_risk_flag:      r.ai_risk_flag,
          updated_at:        r.updated_at,
          project_id:        r.project_id,
          project_name:      (project as { name?: string } | null)?.name ?? null,
          raw_content:       (comment as { raw_content?: string | null } | null)?.raw_content ?? null,
          author_name:       (comment as { author_name?: string | null } | null)?.author_name ?? null,
        };
      });

      const decisions = ((decisionRows ?? []) as {
        id: string; decision_text: string; reason: string | null; owner_name: string | null;
        source: string; decided_at: string; feedback_item_id: string | null; project_id: string | null;
        slack_channel_name: string | null; slack_thread_url: string | null;
      }[]).map(d => ({ ...d }));

      return NextResponse.json({ results, decisions, query: q, semantic: true });
    }
  }

  // ── Fallback: ilike substring matching ────────────────────────────────────
  const [{ data: rows, error }, { data: decisionRows }] = await Promise.all([
    admin
      .from("feedback_items")
      .select(`
        id, status, ai_classification, ai_key_question, ai_summary,
        priority, ai_risk_flag, updated_at, project_id,
        project:projects!project_id(name),
        comment:figma_comments!figma_comment_id(raw_content, author_name)
      `)
      .eq("workspace_id", workspaceId)
      .is("deleted_at", null)
      .or(`ai_key_question.ilike.%${q}%,ai_summary.ilike.%${q}%,ai_classification.ilike.%${q}%`)
      .order("updated_at", { ascending: false })
      .limit(limit),
    admin
      .from("decisions")
      .select("id, decision_text, reason, owner_name, source, decided_at, feedback_item_id, project_id, slack_channel_name, slack_thread_url")
      .eq("workspace_id", workspaceId)
      .or(`decision_text.ilike.%${q}%,reason.ilike.%${q}%`)
      .order("decided_at", { ascending: false })
      .limit(limit),
  ]);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const results = ((rows ?? []) as RawRow[]).map(r => {
    const project = r.project ? (Array.isArray(r.project) ? r.project[0] : r.project) : null;
    const comment = r.comment ? (Array.isArray(r.comment) ? r.comment[0] : r.comment) : null;
    return {
      id:                r.id,
      status:            r.status,
      ai_classification: r.ai_classification,
      ai_key_question:   r.ai_key_question,
      ai_summary:        r.ai_summary,
      priority:          r.priority,
      ai_risk_flag:      r.ai_risk_flag,
      updated_at:        r.updated_at,
      project_id:        r.project_id,
      project_name:      (project as { name?: string } | null)?.name ?? null,
      raw_content:       (comment as { raw_content?: string | null } | null)?.raw_content ?? null,
      author_name:       (comment as { author_name?: string | null } | null)?.author_name ?? null,
    };
  });

  const decisions = ((decisionRows ?? []) as {
    id: string; decision_text: string; reason: string | null; owner_name: string | null;
    source: string; decided_at: string; feedback_item_id: string | null; project_id: string | null;
    slack_channel_name: string | null; slack_thread_url: string | null;
  }[]).map(d => ({ ...d }));

  return NextResponse.json({ results, decisions, query: q, semantic: false });
}
