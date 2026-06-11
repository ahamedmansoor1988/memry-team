/**
 * POST /api/search/answer
 * Synthesizes a prose answer to a natural-language question using the
 * workspace's accumulated signals and decisions as evidence.
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import Groq from "groq-sdk";

interface AnswerResult {
  answer:     string | null;
  key_points: string[];
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { q } = await req.json() as { q?: string };
  const query = q?.trim() ?? "";
  if (!query || query.length < 8) return NextResponse.json({ answer: null, key_points: [] });

  const admin = createAdminClient();
  const { data: membership } = await admin
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", user.id)
    .limit(1).single();

  const workspaceId = (membership as { workspace_id: string } | null)?.workspace_id;
  if (!workspaceId) return NextResponse.json({ answer: null, key_points: [] });

  // Gather evidence: recent decisions + matching feedback items
  const terms = query.toLowerCase().split(/\s+/).filter(w => w.length > 3).slice(0, 5);
  const orFilter = terms.length > 0
    ? terms.map(t => `decision_text.ilike.%${t}%,reason.ilike.%${t}%`).join(",")
    : undefined;

  const [{ data: decisions }, { data: items }] = await Promise.all([
    (() => {
      let qb = admin.from("decisions")
        .select("decision_text, reason, owner_name, decided_at, source")
        .eq("workspace_id", workspaceId)
        .order("decided_at", { ascending: false })
        .limit(15);
      if (orFilter) qb = qb.or(orFilter);
      return qb;
    })(),
    (() => {
      let qb = admin.from("feedback_items")
        .select("ai_key_question, ai_summary, status, owner_name, created_at")
        .eq("workspace_id", workspaceId)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(15);
      if (terms.length > 0) {
        qb = qb.or(terms.map(t => `ai_key_question.ilike.%${t}%,ai_summary.ilike.%${t}%`).join(","));
      }
      return qb;
    })(),
  ]);

  const evidence: string[] = [];
  for (const d of (decisions ?? []) as { decision_text: string; reason: string | null; owner_name: string | null; decided_at: string; source: string }[]) {
    evidence.push(`DECISION (${d.decided_at.slice(0, 10)}, via ${d.source}${d.owner_name ? `, by ${d.owner_name}` : ""}): ${d.decision_text}${d.reason ? ` — Reason: ${d.reason}` : ""}`);
  }
  for (const i of (items ?? []) as { ai_key_question: string | null; ai_summary: string | null; status: string; owner_name: string | null; created_at: string }[]) {
    const title = i.ai_key_question && i.ai_key_question !== "None" ? i.ai_key_question : i.ai_summary;
    if (title) evidence.push(`SIGNAL (${i.created_at.slice(0, 10)}, status: ${i.status}${i.owner_name ? `, raised by ${i.owner_name}` : ""}): ${title}`);
  }

  if (evidence.length === 0) return NextResponse.json({ answer: null, key_points: [] });

  try {
    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY! });
    const completion = await groq.chat.completions.create({
      model: "llama-3.1-8b-instant",
      temperature: 0.2,
      max_tokens: 400,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `You answer questions about a design team's organizational memory using ONLY the evidence provided. Respond with JSON: {"answer": string|null, "key_points": string[]}.
- "answer": 1-3 sentences answering the question directly, in plain past tense. null if the evidence does not contain an answer.
- "key_points": 0-3 short supporting facts pulled from the evidence. Empty array if answer is null.
- Never invent facts not present in the evidence. If unsure, return null.`,
        },
        {
          role: "user",
          content: `Question: ${query}\n\nEvidence:\n${evidence.slice(0, 25).join("\n")}`,
        },
      ],
    });

    const parsed = JSON.parse(completion.choices[0]?.message?.content ?? "{}") as AnswerResult;
    return NextResponse.json({
      answer:     typeof parsed.answer === "string" && parsed.answer.length > 0 ? parsed.answer : null,
      key_points: Array.isArray(parsed.key_points) ? parsed.key_points.filter(p => typeof p === "string").slice(0, 3) : [],
    });
  } catch {
    return NextResponse.json({ answer: null, key_points: [] });
  }
}
