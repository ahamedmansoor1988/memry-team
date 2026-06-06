/**
 * Ownership resolver — given a comment + its replies, asks Groq who is
 * responsible for acting on it, then fuzzy-matches the name against the
 * workspace's known profiles.
 *
 * Always safe to call: the entire function is wrapped in try/catch and
 * returns a null result on any failure.
 */

import Groq from "groq-sdk";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// ─── Types ────────────────────────────────────────────────────────────────────

export interface OwnerProfile {
  id: string;
  display_name: string;
  figma_handle: string;       // may be "" if null in DB — caller normalises
  slack_handle: string | null;
}

export interface OwnerResult {
  owner_name: string | null;
  profile_id: string | null;
  confidence: number;
}

const NULL_RESULT: OwnerResult = { owner_name: null, profile_id: null, confidence: 0 };

// ─── Prompt ───────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an ownership resolver. Given a Figma design comment and its replies, identify who is responsible for taking action.
Look for: @ mentions, "waiting on X", "X to decide", "X needs to", assignment language, or the person who asked the key question.
Return JSON: { "owner_name": string | null, "confidence": number }
confidence is 0.0–1.0. If you cannot identify a clear owner, set owner_name to null and confidence below 0.4.`;

// ─── Main export ──────────────────────────────────────────────────────────────

export async function resolveOwner(
  commentText: string,
  replies: string[],
  profiles: OwnerProfile[],
): Promise<OwnerResult> {
  try {
    const replyBlock = replies.length > 0
      ? `\n\nReplies:\n${replies.map((r, i) => `${i + 1}. ${r}`).join("\n")}`
      : "";

    const userPrompt =
      `Comment: "${commentText}"${replyBlock}\n\n` +
      `Return ONLY valid JSON: { "owner_name": string | null, "confidence": number }`;

    const response = await groq.chat.completions.create({
      model: "llama-3.1-8b-instant",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user",   content: userPrompt },
      ],
      temperature: 0.1,
      max_tokens: 100,
      response_format: { type: "json_object" },
    });

    const text = response.choices[0]?.message?.content;
    if (!text) return NULL_RESULT;

    const parsed = JSON.parse(text) as { owner_name?: unknown; confidence?: unknown };
    const ownerName  = typeof parsed.owner_name  === "string" ? parsed.owner_name.trim() : null;
    const confidence = typeof parsed.confidence  === "number"
      ? Math.min(1, Math.max(0, parsed.confidence))
      : 0;

    if (!ownerName || confidence < 0.4) return NULL_RESULT;

    // ── Fuzzy-match against known profiles ────────────────────────────────────
    // Accepts partial matches in either direction so "Sarah" matches "Sarah Chen"
    const needle = ownerName.toLowerCase();
    const matched = profiles.find(p => {
      const dn = p.display_name.toLowerCase();
      const fh = p.figma_handle.toLowerCase();
      const sh = p.slack_handle?.toLowerCase() ?? "";
      return (
        dn.includes(needle) || needle.includes(dn) ||
        fh.includes(needle) || needle.includes(fh) ||
        (sh && (sh.includes(needle) || needle.includes(sh)))
      );
    });

    return { owner_name: ownerName, profile_id: matched?.id ?? null, confidence };
  } catch (e) {
    console.warn("[resolve-owner] failed (non-fatal):", e);
    return NULL_RESULT;
  }
}
