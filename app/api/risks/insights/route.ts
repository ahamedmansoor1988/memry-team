import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import Groq from "groq-sdk";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

type RiskRow = {
  id:                string;
  ai_key_question:   string | null;
  ai_summary:        string | null;
  ai_classification: string | null;
  ai_tags:           string[] | null;
  owner_name:        string | null;
  created_at:        string;
  project_id:        string | null;
  project:           { name: string } | { name: string }[] | null;
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
    .limit(1).single();

  const workspaceId = (membership as { workspace_id: string } | null)?.workspace_id;
  if (!workspaceId) return NextResponse.json({ insights: [] });

  const { data: risks } = await admin
    .from("feedback_items")
    .select("id, ai_key_question, ai_summary, ai_classification, ai_tags, owner_name, created_at, project_id, project:projects!project_id(name)")
    .eq("workspace_id", workspaceId)
    .is("deleted_at", null)
    .or("ai_risk_flag.eq.true,ai_classification.eq.Blocked")
    .in("status", ["open", "needs_decision"])
    .order("created_at", { ascending: true })
    .limit(15);

  if (!risks?.length) return NextResponse.json({ insights: [], risk_count: 0 });

  const riskList = (risks as RiskRow[]).map(r => {
    const project = r.project ? (Array.isArray(r.project) ? r.project[0] : r.project) : null;
    return `- [${r.ai_classification ?? "Risk"}] ${r.ai_key_question ?? r.ai_summary ?? "Untitled"} (${(project as { name?: string } | null)?.name ?? "Unknown project"})${r.owner_name ? `, owner: ${r.owner_name}` : ""}`;
  }).join("\n");

  try {
    const completion = await groq.chat.completions.create({
      model: "llama-3.1-8b-instant",
      temperature: 0.3,
      max_tokens: 600,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `You are a risk analyst for a product design team. Given a list of flagged risks and blockers, identify the top patterns and recommended actions. Return valid JSON only:
{
  "summary": "2-3 sentence overview of the risk landscape",
  "top_risks": [
    { "title": "short risk title", "description": "1 sentence", "action": "specific recommended action" }
  ],
  "pattern": "One sentence describing the most common pattern across these risks"
}
top_risks should have 2-4 items maximum. Be specific and actionable.`,
        },
        { role: "user", content: `Active risks and blockers:\n${riskList}` },
      ],
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";

    let result: { summary?: string; top_risks?: { title: string; description: string; action: string }[]; pattern?: string };
    try {
      result = JSON.parse(raw);
    } catch {
      return NextResponse.json({ insights: [], risk_count: risks.length });
    }

    return NextResponse.json({
      insights:   result.top_risks ?? [],
      summary:    result.summary  ?? null,
      pattern:    result.pattern  ?? null,
      risk_count: risks.length,
    });
  } catch (err) {
    console.error("[risks/insights] Groq error:", err);
    return NextResponse.json({ insights: [], risk_count: risks.length });
  }
}
