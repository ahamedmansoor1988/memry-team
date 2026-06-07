/**
 * Organizational memory search — answers natural-language questions about a
 * team's decision history using Groq llama-3.1-8b-instant.
 *
 * Never throws: all errors return a safe fallback MemoryAnswer.
 */

import Groq from "groq-sdk";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MemoryContextDecision {
  decision_text: string;
  reason:        string | null;
  decided_at:    string;
  owner_name:    string | null;
  project_name:  string | null;
}

export interface MemoryContextFeedback {
  ai_key_question: string | null;
  ai_summary:      string | null;
  status:          string;
  project_name:    string | null;
}

export interface MemoryContext {
  decisions:      MemoryContextDecision[];
  recentFeedback: MemoryContextFeedback[];
}

export interface MemoryAnswer {
  answer:      string;
  confidence:  "high" | "medium" | "low";
  sources:     string[];     // decision_text snippets used as evidence
  suggestions: string[];     // 2-3 follow-up questions
}

// ─── Fallback ─────────────────────────────────────────────────────────────────

const FALLBACK: MemoryAnswer = {
  answer:      "I couldn't find relevant context for that question.",
  confidence:  "low",
  sources:     [],
  suggestions: [],
};

// ─── Prompts ──────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are Memry, an organizational memory assistant for a product design team. \
You have access to the team's decision history and feedback patterns. \
Answer questions about why decisions were made, what patterns exist, and what context surrounds design choices. \
Be concise and cite specific decisions as evidence. \
Always return valid JSON — never return plain text.`;

function buildUserPrompt(query: string, ctx: MemoryContext): string {
  // Cap to 20 decisions to stay within token limits
  const decisions = ctx.decisions.slice(0, 20);
  const feedback  = ctx.recentFeedback.slice(0, 15);

  const decisionsText = decisions.length > 0
    ? decisions.map((d, i) =>
        `[${i + 1}] "${d.decision_text}"` +
        (d.reason        ? ` — Reason: ${d.reason}` : "") +
        (d.project_name  ? ` (${d.project_name})` : "") +
        (d.owner_name    ? ` by ${d.owner_name}` : "") +
        ` on ${d.decided_at.slice(0, 10)}`
      ).join("\n")
    : "No decisions recorded yet.";

  const feedbackText = feedback.length > 0
    ? feedback.map(f =>
        `- [${f.status}] ${f.ai_key_question ?? f.ai_summary ?? "(no summary)"}` +
        (f.project_name ? ` (${f.project_name})` : "")
      ).join("\n")
    : "No recent feedback.";

  return `Question: "${query}"

== DECISION HISTORY ==
${decisionsText}

== RECENT FEEDBACK PATTERNS ==
${feedbackText}

Return ONLY valid JSON in this exact shape — no markdown, no extra text:
{
  "answer": "A direct, helpful answer to the question. Be specific and cite decisions where possible. 2-4 sentences.",
  "confidence": "high" | "medium" | "low",
  "sources": ["exact decision_text snippet 1", "exact decision_text snippet 2"],
  "suggestions": ["follow-up question 1?", "follow-up question 2?", "follow-up question 3?"]
}

Rules:
- confidence = "high" if you found 2+ directly relevant decisions
- confidence = "medium" if you found 1 relevant decision or indirect context
- confidence = "low" if you found no relevant context
- sources: include up to 3 exact decision_text values that directly support your answer
- suggestions: 2-3 related questions the user might want to ask next
- If no relevant context exists, still return the JSON shape with a helpful "answer"`;
}

// ─── Validator ────────────────────────────────────────────────────────────────

function parseResponse(raw: string): MemoryAnswer {
  const parsed = JSON.parse(raw) as Partial<MemoryAnswer>;
  const confidence = (["high", "medium", "low"] as const).includes(parsed.confidence as "high" | "medium" | "low")
    ? (parsed.confidence as "high" | "medium" | "low")
    : "low";
  return {
    answer:      typeof parsed.answer === "string" && parsed.answer.trim() ? parsed.answer.trim() : FALLBACK.answer,
    confidence,
    sources:     Array.isArray(parsed.sources)     ? parsed.sources.filter(s => typeof s === "string")     : [],
    suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions.filter(s => typeof s === "string") : [],
  };
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function searchMemory(query: string, context: MemoryContext): Promise<MemoryAnswer> {
  try {
    if (!query.trim()) return FALLBACK;

    const completion = await groq.chat.completions.create({
      model:           "llama-3.1-8b-instant",
      temperature:     0.2,
      max_tokens:      800,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user",   content: buildUserPrompt(query, context) },
      ],
    });

    const raw = completion.choices[0]?.message?.content ?? "";
    return parseResponse(raw);
  } catch (e) {
    console.warn("[memory-search] failed (non-fatal):", e);
    return FALLBACK;
  }
}
