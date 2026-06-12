/**
 * Slack bot Q&A: detects questions in incoming messages, searches Memry's
 * workspace memory semantically, and replies in-thread when an answer is found.
 * Silent when no answer exists — no "I don't know" noise.
 */
import Groq from "groq-sdk";
import { createAdminClient } from "@/lib/supabase/server";

const EMBED_MODEL     = "jina-embeddings-v3";
const EMBED_DIMS      = 1024;
const MATCH_THRESHOLD = 0.40;
const MATCH_COUNT     = 10;

const QUESTION_PATTERNS = [
  /\?/,
  /\bdid we\b/i,
  /\bwhat did we\b/i,
  /\bwhy did we\b/i,
  /\bshould we\b/i,
  /\bhave we decided\b/i,
  /\bwhat was decided\b/i,
  /\bdo we have\b/i,
  /\bhave we\b/i,
  /\bwhat('s| is) the\b/i,
];

export function looksLikeQuestion(text: string): boolean {
  return QUESTION_PATTERNS.some(p => p.test(text));
}

async function embedQuery(text: string): Promise<number[] | null> {
  const apiKey = process.env.JINA_API_KEY;
  if (!apiKey) return null;
  try {
    const res = await fetch("https://api.jina.ai/v1/embeddings", {
      method:  "POST",
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

async function postReply(botToken: string, channel: string, threadTs: string, text: string) {
  try {
    await fetch("https://slack.com/api/chat.postMessage", {
      method:  "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${botToken}` },
      body: JSON.stringify({ channel, thread_ts: threadTs, text, unfurl_links: false }),
    });
  } catch { /* non-fatal */ }
}

export async function answerQuestion({
  workspaceId,
  botToken,
  channelId,
  messageTs,
  messageText,
}: {
  workspaceId:  string;
  botToken:     string;
  channelId:    string;
  messageTs:    string;
  messageText:  string;
}) {
  if (!looksLikeQuestion(messageText)) return;

  const admin     = createAdminClient();
  const embedding = await embedQuery(messageText);
  if (!embedding) return;

  const { data: matches, error } = await admin.rpc("match_items", {
    p_workspace_id: workspaceId,
    p_embedding:    JSON.stringify(embedding),
    p_threshold:    MATCH_THRESHOLD,
    p_count:        MATCH_COUNT,
    p_exclude_type: "",
    p_exclude_id:   "00000000-0000-0000-0000-000000000000",
  });

  if (error || !matches?.length) return;

  const typedMatches = matches as { item_type: string; item_id: string; similarity: number }[];
  const feedbackIds  = typedMatches.filter(m => m.item_type === "feedback_item").map(m => m.item_id);
  const decisionIds  = typedMatches.filter(m => m.item_type === "decision").map(m => m.item_id);

  const [{ data: feedbackItems }, { data: decisions }] = await Promise.all([
    feedbackIds.length > 0
      ? admin.from("feedback_items")
          .select("ai_key_question, ai_summary, owner_name, created_at, project:projects!project_id(name)")
          .in("id", feedbackIds)
          .is("deleted_at", null)
      : Promise.resolve({ data: [] }),
    decisionIds.length > 0
      ? admin.from("decisions")
          .select("decision_text, reason, owner_name, decided_at, source, slack_channel_name, slack_thread_url")
          .in("id", decisionIds)
      : Promise.resolve({ data: [] }),
  ]);

  const evidence: string[] = [];

  for (const d of (decisions ?? []) as {
    decision_text: string; reason: string | null; owner_name: string | null;
    decided_at: string; source: string; slack_channel_name: string | null; slack_thread_url: string | null;
  }[]) {
    const line = `DECISION (${d.decided_at.slice(0, 10)}, via ${d.source}${d.owner_name ? `, by ${d.owner_name}` : ""}): ${d.decision_text}${d.reason ? ` — Reason: ${d.reason}` : ""}`;
    evidence.push(line);
  }

  for (const f of (feedbackItems ?? []) as {
    ai_key_question: string | null; ai_summary: string | null;
    owner_name: string | null; created_at: string;
    project: { name: string } | { name: string }[] | null;
  }[]) {
    const title = (f.ai_key_question && f.ai_key_question !== "None") ? f.ai_key_question : f.ai_summary;
    if (!title) continue;
    const proj = f.project ? (Array.isArray(f.project) ? f.project[0]?.name : (f.project as { name: string }).name) : null;
    evidence.push(`DISCUSSION (${f.created_at.slice(0, 10)}${f.owner_name ? `, by ${f.owner_name}` : ""}${proj ? `, in ${proj}` : ""}): ${title}`);
  }

  if (evidence.length === 0) return;

  let answer: string | null = null;
  let source: string | null = null;

  try {
    const groq       = new Groq({ apiKey: process.env.GROQ_API_KEY! });
    const completion = await groq.chat.completions.create({
      model:           "llama-3.1-8b-instant",
      temperature:     0.1,
      max_tokens:      250,
      response_format: { type: "json_object" },
      messages: [
        {
          role:    "system",
          content: `Answer questions using ONLY the evidence provided. Be brief and direct. JSON: {"answer": string|null, "source": string|null}.
- answer: 1-2 sentences. null if evidence does not contain the answer.
- source: short attribution e.g. "decided by Alex on 2026-01-15" or "discussed in Project X on 2026-01-10". null if no answer.
- Never invent facts. When unsure return {"answer":null,"source":null}.`,
        },
        {
          role:    "user",
          content: `Question: ${messageText}\n\nEvidence:\n${evidence.join("\n")}`,
        },
      ],
    });

    const parsed = JSON.parse(completion.choices[0]?.message?.content ?? "{}") as { answer?: string | null; source?: string | null };
    answer = typeof parsed.answer === "string" && parsed.answer.length > 0 ? parsed.answer : null;
    source = typeof parsed.source === "string" && parsed.source.length > 0 ? parsed.source : null;
  } catch {
    return;
  }

  if (!answer) return;

  const reply = source ? `*Memry:* ${answer}\n_${source}_` : `*Memry:* ${answer}`;
  await postReply(botToken, channelId, messageTs, reply);

  // Log the answered question — feeds the "X questions answered" dashboard
  // metric. Best-effort: a missing table must never break the reply itself.
  const { error: logError } = await admin.from("answered_questions").insert({
    workspace_id:     workspaceId,
    slack_channel_id: channelId,
    slack_message_ts: messageTs,
    question:         messageText.slice(0, 1000),
    answer:           answer.slice(0, 2000),
    source,
  });
  if (logError) console.error("[answer-question] log failed:", logError.message);
}
