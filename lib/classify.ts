import Groq from "groq-sdk";
import { createAdminClient } from "@/lib/supabase/server";

export interface ClassifyResult {
  classification:        "decision" | "blocker" | "risk" | "question" | "vague" | "noise";
  confidence:            number;
  what:                  string;
  why:                   string | null;
  who:                   string | null;
  stakeholders:          string[];
  rejected_alternatives: string[];
  blockers:              string[];
  risks:                 string[];
  is_vague:              boolean;
  vague_reason:          string | null;
}

const VALID = ["decision", "blocker", "risk", "question", "vague", "noise"] as const;

export async function classifyThread(threadId: string): Promise<ClassifyResult | null> {
  const admin = createAdminClient();

  const [{ data: thread }, { data: comments }] = await Promise.all([
    admin
      .from("threads")
      .select("id, workspace_id, project_id, title, source")
      .eq("id", threadId)
      .single(),
    admin
      .from("comments")
      .select("author_name, body, sequence_order")
      .eq("thread_id", threadId)
      .is("deleted_at", null)
      .order("sequence_order", { ascending: true }),
  ]);

  if (!thread || !comments?.length) return null;

  const rows = comments as Array<{ author_name: string | null; body: string }>;
  const conversationText = rows
    .map((c, i) => `[${i + 1}] ${c.author_name ?? "Unknown"}: ${c.body}`)
    .join("\n\n");

  const t = thread as any;

  const prompt = `You are analyzing a ${t.source} comment thread for a product/design team.

Thread title: "${t.title ?? "Untitled"}"

Full conversation:
${conversationText}

Classify this thread and return ONLY valid JSON:
{
  "classification": "decision|blocker|risk|question|vague|noise",
  "confidence": 0-100,
  "what": "one sentence describing what is being discussed",
  "why": "one sentence explaining the rationale, or null",
  "who": "name of the decision maker if identifiable, or null",
  "stakeholders": ["names of people involved"],
  "rejected_alternatives": ["options explicitly rejected with reason"],
  "blockers": ["team or person blocking progress, if any"],
  "risks": ["risks identified, if any"],
  "is_vague": true or false,
  "vague_reason": "what is unclear, or null"
}

Classification rules:
- decision: a clear call was made — what was decided, by whom
- blocker: someone or something is explicitly blocking progress
- risk: a risk is identified but no decision yet
- question: needs an answer or decision before work can proceed
- vague: unclear intent — hard to understand
- noise: chitchat, emoji reactions, greetings, off-topic`;

  const groq = new Groq({ apiKey: process.env.GROQ_API_KEY! });

  let result: ClassifyResult;
  try {
    const completion = await groq.chat.completions.create({
      model:           "llama-3.3-70b-versatile",
      messages:        [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      temperature:     0.1,
      max_tokens:      600,
    });

    const raw = completion.choices[0]?.message?.content;
    if (!raw) return null;

    result = JSON.parse(raw) as ClassifyResult;

    if (!VALID.includes(result.classification as any)) result.classification = "noise";
    if (typeof result.confidence !== "number")           result.confidence = 50;
    if (!result.what || typeof result.what !== "string") result.what = "Discussion in progress";
    if (!Array.isArray(result.stakeholders))             result.stakeholders = [];
    if (!Array.isArray(result.rejected_alternatives))    result.rejected_alternatives = [];
    if (!Array.isArray(result.blockers))                 result.blockers = [];
    if (!Array.isArray(result.risks))                    result.risks = [];
    result.is_vague = Boolean(result.is_vague);
  } catch (err) {
    console.error("[classify] Groq error:", err);
    return null;
  }

  // Persist classification on thread
  await admin
    .from("threads")
    .update({ classification: result.classification, updated_at: new Date().toISOString() })
    .eq("id", threadId);

  // Upsert decision row (check-then-insert-or-update since UNIQUE may not be set yet)
  const { data: existing } = await admin
    .from("decisions")
    .select("id")
    .eq("thread_id", threadId)
    .maybeSingle();

  const payload = {
    thread_id:             threadId,
    workspace_id:          t.workspace_id,
    project_id:            t.project_id ?? null,
    what:                  result.what,
    why:                   result.why ?? null,
    who:                   result.who ?? null,
    stakeholders:          result.stakeholders,
    rejected_alternatives: result.rejected_alternatives,
    confidence_score:      result.confidence,
  };

  if ((existing as any)?.id) {
    await admin.from("decisions").update(payload).eq("id", (existing as any).id);
  } else {
    await admin.from("decisions").insert(payload);
  }

  return result;
}
