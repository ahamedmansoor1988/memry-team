/**
 * GET /api/brief
 *
 * Generates a weekly executive brief using Groq AI.
 * Loads last 7 days of decisions, open/resolved items, and blockers in parallel,
 * then calls llama-3.1-8b-instant with a JSON-object schema.
 *
 * Response:
 * {
 *   headline:           string;
 *   decisions_summary:  string;
 *   attention_needed:   string[];
 *   blockers_summary:   string;
 *   momentum:           "high" | "medium" | "low";
 *   momentum_reason:    string;
 * }
 */
import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import Groq from "groq-sdk";

export interface BriefResult {
  headline:          string;
  decisions_summary: string;
  attention_needed:  string[];
  blockers_summary:  string;
  momentum:          "high" | "medium" | "low";
  momentum_reason:   string;
}

const FALLBACK: BriefResult = {
  headline:          "Weekly Brief unavailable",
  decisions_summary: "Could not generate summary at this time.",
  attention_needed:  [],
  blockers_summary:  "No blocker data available.",
  momentum:          "low",
  momentum_reason:   "Brief generation failed.",
};

export async function GET() {
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

  const workspaceId = (membership as { workspace_id: string } | null)?.workspace_id;
  if (!workspaceId) return NextResponse.json({ error: "No workspace" }, { status: 400 });

  // ── Check weekly brief cache ─────────────────────────────────────────────
  const nowDate = new Date();
  const weekDay = nowDate.getDay();
  const diffDays = weekDay === 0 ? -6 : 1 - weekDay;
  const weekStart = new Date(nowDate);
  weekStart.setDate(nowDate.getDate() + diffDays);
  const weekStartDate = weekStart.toISOString().split("T")[0];

  const { data: cached } = await admin
    .from("weekly_briefs")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("week_start", weekStartDate)
    .single();

  if (cached) {
    return NextResponse.json({
      headline:          cached.headline          ?? FALLBACK.headline,
      decisions_summary: cached.decisions_summary ?? FALLBACK.decisions_summary,
      attention_needed:  Array.isArray(cached.attention_needed) ? cached.attention_needed : [],
      blockers_summary:  cached.blockers_summary  ?? FALLBACK.blockers_summary,
      momentum:          (cached.momentum === "high" || cached.momentum === "medium" || cached.momentum === "low") ? cached.momentum : "low",
      momentum_reason:   cached.momentum_reason   ?? FALLBACK.momentum_reason,
    });
  }

  // ── Load data in parallel ────────────────────────────────────────────────
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [decisionsResult, openResult, resolvedResult, blockersResult] = await Promise.all([
    // Last 7 days of decisions
    admin
      .from("decisions")
      .select("decision_text, reason, owner_name, decided_at, outcome")
      .eq("workspace_id", workspaceId)
      .gte("decided_at", sevenDaysAgo)
      .order("decided_at", { ascending: false })
      .limit(20),

    // Open items (incl. needs_decision)
    admin
      .from("feedback_items")
      .select("ai_key_question, ai_summary, ai_classification, status, priority, owner_name, updated_at")
      .eq("workspace_id", workspaceId)
      .is("deleted_at", null)
      .in("status", ["open", "needs_decision"])
      .order("updated_at", { ascending: false })
      .limit(30),

    // Resolved in last 7 days
    admin
      .from("feedback_items")
      .select("ai_key_question, ai_summary, updated_at")
      .eq("workspace_id", workspaceId)
      .eq("status", "resolved")
      .is("deleted_at", null)
      .gte("updated_at", sevenDaysAgo)
      .limit(20),

    // Active blockers
    admin
      .from("feedback_items")
      .select("ai_key_question, ai_summary, ai_classification, owner_name, blocked_since")
      .eq("workspace_id", workspaceId)
      .is("deleted_at", null)
      .eq("ai_classification", "Blocked")
      .is("deleted_at", null)
      .order("blocked_since", { ascending: true })
      .limit(10),
  ]);

  const decisions = decisionsResult.data ?? [];
  const openItems = openResult.data ?? [];
  const resolved  = resolvedResult.data ?? [];
  const blockers  = blockersResult.data ?? [];

  // ── Build prompt ─────────────────────────────────────────────────────────

  const decisionLines = decisions.map(d =>
    `- ${d.decision_text}${d.outcome ? ` → Outcome: ${d.outcome}` : ""}${d.owner_name ? ` (${d.owner_name})` : ""}`
  ).join("\n") || "No decisions recorded this week.";

  const openLines = openItems.slice(0, 20).map(item => {
    const title = (item as { ai_key_question?: string | null }).ai_key_question
      || (item as { ai_summary?: string | null }).ai_summary
      || "Untitled";
    return `- [${(item as { status?: string }).status ?? "open"}] ${title}`;
  }).join("\n") || "No open items.";

  const resolvedLines = resolved.map(item => {
    const title = (item as { ai_key_question?: string | null }).ai_key_question
      || (item as { ai_summary?: string | null }).ai_summary
      || "Item";
    return `- ${title}`;
  }).join("\n") || "None";

  const blockerLines = blockers.map(item => {
    const title = (item as { ai_key_question?: string | null }).ai_key_question
      || (item as { ai_summary?: string | null }).ai_summary
      || "Untitled blocker";
    const owner = (item as { owner_name?: string | null }).owner_name;
    return `- ${title}${owner ? ` (owner: ${owner})` : ""}`;
  }).join("\n") || "No active blockers.";

  const prompt = `You are an executive assistant for a product team. Summarize the past week into a concise brief.

DECISIONS MADE THIS WEEK (${decisions.length}):
${decisionLines}

OPEN / NEEDS DECISION ITEMS (${openItems.length}):
${openLines}

RESOLVED THIS WEEK (${resolved.length}):
${resolvedLines}

ACTIVE BLOCKERS (${blockers.length}):
${blockerLines}

Return a JSON object with these exact keys:
- "headline": one punchy sentence summarizing the week (max 15 words)
- "decisions_summary": 2-3 sentences on decisions made and their outcomes
- "attention_needed": array of 2-4 short strings, each one issue needing attention
- "blockers_summary": 1-2 sentences on active blockers and their impact
- "momentum": exactly one of "high", "medium", or "low"
- "momentum_reason": one sentence explaining the momentum rating`;

  // ── Call Groq ─────────────────────────────────────────────────────────────
  try {
    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY! });

    const completion = await groq.chat.completions.create({
      model: "llama-3.1-8b-instant",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      temperature: 0.3,
      max_tokens: 600,
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";

    let parsed: Partial<BriefResult>;
    try {
      parsed = JSON.parse(raw) as Partial<BriefResult>;
    } catch {
      return NextResponse.json(FALLBACK);
    }

    const momentum = (parsed.momentum === "high" || parsed.momentum === "medium" || parsed.momentum === "low")
      ? parsed.momentum
      : "low";

    const result: BriefResult = {
      headline:          parsed.headline          ?? FALLBACK.headline,
      decisions_summary: parsed.decisions_summary ?? FALLBACK.decisions_summary,
      attention_needed:  Array.isArray(parsed.attention_needed) ? parsed.attention_needed : [],
      blockers_summary:  parsed.blockers_summary  ?? FALLBACK.blockers_summary,
      momentum,
      momentum_reason:   parsed.momentum_reason   ?? FALLBACK.momentum_reason,
    };

    // Save to cache for future requests this week
    await admin.from("weekly_briefs").upsert({
      workspace_id:      workspaceId,
      week_start:        weekStartDate,
      headline:          result.headline,
      decisions_summary: result.decisions_summary,
      attention_needed:  result.attention_needed,
      blockers_summary:  result.blockers_summary,
      momentum:          result.momentum,
      momentum_reason:   result.momentum_reason,
    }, { onConflict: "workspace_id,week_start" });

    return NextResponse.json(result);
  } catch (err) {
    console.error("[brief] Groq error:", err);
    return NextResponse.json(FALLBACK);
  }
}
