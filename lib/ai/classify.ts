import Groq from "groq-sdk";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

export interface ClassifyResult {
  classification: "Needs Decision" | "Blocked" | "Approved" | "Risk" | "Vague" | "Info";
  priority: "high" | "medium" | "low";
  summary: string;
  key_question: string;
  tags: string[];
  risk_flag: boolean;
  vague_flag: boolean;
  vague_reason: string | null;
  confidence: number;
  suggested_action: string;
}

const SYSTEM_PROMPT = `You are Memry, an AI assistant that analyzes Figma design comments left by designers, stakeholders, and developers.

Your job is to classify each comment and extract structured metadata so the design team can prioritize and act on feedback efficiently.

Classification options:
- "Needs Decision" — requires a choice from the team (e.g. "which color should we use?", "should we remove this?")
- "Blocked" — work is stalled waiting on someone or something
- "Approved" — stakeholder sign-off, positive confirmation ("looks good", "approved")
- "Risk" — flags a potential issue with timeline, scope, accessibility, or technical feasibility
- "Vague" — unclear feedback without enough detail to act on (e.g. "make it pop", "feels off")
- "Info" — general observation, note, or question that doesn't require immediate action

Priority rules:
- high: blocking work, stakeholder approval needed urgently, or risk that could delay launch
- medium: needs attention soon but not blocking
- low: minor notes, style preferences, future ideas

Suggested action rules — pick the single most appropriate next step based on classification and comment age:
- "Needs Decision" AND age_in_days > 3  → "Schedule a decision review"
- "Needs Decision" AND age_in_days ≤ 3  → "Review this comment"
- "Blocked"                              → "Escalate to unblock this thread"
- "Vague" OR vague_flag is true          → "Request clarification from the author"
- "Risk"                                 → "Review and assess the risk"
- "Approved"                             → "Mark as resolved"
- "Info"                                 → "No action needed"
- Default fallback                       → "Review this comment"
The suggested_action must be ≤60 characters.

Always return valid JSON matching the schema. Be concise in summaries (1-2 sentences max).`;

function buildUserPrompt(comment: string, ageInDays: number): string {
  return `Analyze this Figma design comment and return JSON:

Comment: "${comment}"
Comment age: ${ageInDays} day${ageInDays === 1 ? "" : "s"} old

Return ONLY valid JSON in this exact shape:
{
  "classification": "Needs Decision" | "Blocked" | "Approved" | "Risk" | "Vague" | "Info",
  "priority": "high" | "medium" | "low",
  "summary": "1-2 sentence summary of what this comment is about",
  "key_question": "The core question or action needed, phrased as a clear statement (never return null or 'None')",
  "tags": ["tag1", "tag2"],
  "risk_flag": true | false,
  "vague_flag": true | false,
  "vague_reason": "Why this is vague (only if vague_flag is true, otherwise null)",
  "confidence": 0.0-1.0,
  "suggested_action": "Short imperative sentence ≤60 chars"
}`;
}

/** Deterministic rule — exported for backfill without Groq. */
export function deriveSuggestedAction(
  classification: ClassifyResult["classification"],
  vagueFlag: boolean,
  ageInDays: number,
): string {
  if (classification === "Needs Decision" && ageInDays > 3) return "Schedule a decision review";
  if (classification === "Blocked")                          return "Escalate to unblock this thread";
  if (classification === "Vague" || vagueFlag)               return "Request clarification from the author";
  if (classification === "Risk")                             return "Review and assess the risk";
  if (classification === "Approved")                         return "Mark as resolved";
  if (classification === "Info")                             return "No action needed";
  return "Review this comment";
}

export async function classifyComment(
  rawContent: string,
  createdAt?: string,
): Promise<ClassifyResult | null> {
  const ageInDays = createdAt
    ? Math.floor((Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60 * 24))
    : 0;

  try {
    const response = await groq.chat.completions.create({
      model: "llama-3.1-8b-instant",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserPrompt(rawContent, ageInDays) },
      ],
      temperature: 0.1,
      max_tokens: 600,
      response_format: { type: "json_object" },
    });

    const text = response.choices[0]?.message?.content;
    if (!text) return null;

    const parsed = JSON.parse(text) as ClassifyResult;

    // Validate / coerce required fields
    const validClassifications = ["Needs Decision", "Blocked", "Approved", "Risk", "Vague", "Info"];
    const validPriorities = ["high", "medium", "low"];

    if (!validClassifications.includes(parsed.classification)) parsed.classification = "Info";
    if (!validPriorities.includes(parsed.priority)) parsed.priority = "medium";
    if (!Array.isArray(parsed.tags)) parsed.tags = [];
    if (typeof parsed.risk_flag !== "boolean") parsed.risk_flag = false;
    if (typeof parsed.vague_flag !== "boolean") parsed.vague_flag = false;

    // Ensure suggested_action is a non-empty string ≤60 chars; fall back to deterministic rule
    if (typeof parsed.suggested_action !== "string" || !parsed.suggested_action.trim()) {
      parsed.suggested_action = deriveSuggestedAction(parsed.classification, parsed.vague_flag, ageInDays);
    } else {
      parsed.suggested_action = parsed.suggested_action.trim().slice(0, 60);
    }

    return parsed;
  } catch (e) {
    console.error("[classify] error", e);
    return null;
  }
}
