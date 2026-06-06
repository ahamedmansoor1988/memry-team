/**
 * AI-powered decision extraction from design feedback threads.
 * Uses Groq llama-3.1-8b-instant to pull structured decisions
 * from a comment + its replies so they can be stored in the decisions table.
 */

import Groq from "groq-sdk";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

export interface DecisionResult {
  /** What was decided — single imperative sentence, max 80 chars. */
  decision_text: string;
  /** Why it was decided — one sentence, or null if not clear. */
  reason: string | null;
  /** Who owns the action — inferred from text or decidedBy, or null. */
  owner_name: string | null;
}

const SYSTEM_PROMPT = `You are an assistant that extracts structured decisions from design feedback threads.
Given a comment and its replies, identify: what was decided, why, and who owns it.
Be concise. decision_text must be a single imperative sentence (max 80 chars).
reason should explain the rationale in one sentence or null if not clear.
owner_name is the person responsible, or null if not mentioned.`;

export async function extractDecision(
  comment: string,
  replies: string[],
  decidedBy?: string,
): Promise<DecisionResult | null> {
  const repliesText = replies.length > 0 ? replies.join("\n") : "No replies";

  const userPrompt = `Original comment: ${comment}
Replies: ${repliesText}
Decided by: ${decidedBy ?? "Unknown"}

Extract the decision as JSON.`;

  try {
    const response = await groq.chat.completions.create({
      model: "llama-3.1-8b-instant",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user",   content: userPrompt },
      ],
      temperature: 0.1,
      max_tokens: 300,
      response_format: { type: "json_object" },
    });

    const text = response.choices[0]?.message?.content;
    if (!text) return null;

    const parsed = JSON.parse(text) as DecisionResult;

    // Validate and coerce each field
    if (typeof parsed.decision_text !== "string" || !parsed.decision_text.trim()) {
      // Fallback: use the first 80 chars of the original comment
      parsed.decision_text = comment.trim().slice(0, 80);
    } else {
      parsed.decision_text = parsed.decision_text.trim().slice(0, 80);
    }

    if (typeof parsed.reason !== "string" || !parsed.reason.trim()) {
      parsed.reason = null;
    } else {
      parsed.reason = parsed.reason.trim();
    }

    if (typeof parsed.owner_name !== "string" || !parsed.owner_name.trim()) {
      parsed.owner_name = null;
    } else {
      parsed.owner_name = parsed.owner_name.trim();
    }

    return parsed;
  } catch (e) {
    console.error("[extract-decision] error:", e);
    return null;
  }
}
