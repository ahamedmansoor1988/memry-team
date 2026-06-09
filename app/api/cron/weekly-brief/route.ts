import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import Groq from "groq-sdk";

export async function GET(req: Request) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();

  // Get all workspaces with figma_pat (or all workspaces)
  const { data: workspaces } = await admin
    .from("workspaces")
    .select("id");

  if (!workspaces?.length) return NextResponse.json({ generated: 0, skipped: 0 });

  // Compute week_start (Monday of current week)
  const now = new Date();
  const day = now.getDay(); // 0=Sun, 1=Mon
  const diff = (day === 0 ? -6 : 1 - day);
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() + diff);
  const weekStartDate = weekStart.toISOString().split("T")[0]; // YYYY-MM-DD

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const groq = new Groq({ apiKey: process.env.GROQ_API_KEY! });

  let generated = 0;
  let skipped = 0;

  for (const ws of workspaces) {
    // Check if brief already exists for this week
    const { data: existing } = await admin
      .from("weekly_briefs")
      .select("id")
      .eq("workspace_id", ws.id)
      .eq("week_start", weekStartDate)
      .single();

    if (existing) { skipped++; continue; }

    // Load last 7 days data in parallel
    const [decisionsResult, openResult, resolvedResult, blockersResult] = await Promise.all([
      admin.from("decisions")
        .select("decision_text, outcome, owner_name")
        .eq("workspace_id", ws.id)
        .gte("decided_at", sevenDaysAgo)
        .limit(20),
      admin.from("feedback_items")
        .select("ai_key_question, ai_summary, status")
        .eq("workspace_id", ws.id)
        .is("deleted_at", null)
        .in("status", ["open", "needs_decision"])
        .limit(30),
      admin.from("feedback_items")
        .select("ai_key_question, ai_summary")
        .eq("workspace_id", ws.id)
        .eq("status", "resolved")
        .is("deleted_at", null)
        .gte("updated_at", sevenDaysAgo)
        .limit(20),
      admin.from("feedback_items")
        .select("ai_key_question, ai_summary, owner_name")
        .eq("workspace_id", ws.id)
        .is("deleted_at", null)
        .eq("status", "blocked")
        .limit(10),
    ]);

    const decisions = decisionsResult.data ?? [];
    const openItems = openResult.data ?? [];
    const resolved  = resolvedResult.data ?? [];
    const blockers  = blockersResult.data ?? [];

    const decisionLines = decisions.map(d =>
      `- ${d.decision_text}${d.outcome ? ` → ${d.outcome}` : ""}${d.owner_name ? ` (${d.owner_name})` : ""}`
    ).join("\n") || "No decisions this week.";

    const openLines = openItems.map(i =>
      `- [${(i as { status?: string }).status ?? "open"}] ${(i as { ai_key_question?: string | null }).ai_key_question ?? (i as { ai_summary?: string | null }).ai_summary ?? "Untitled"}`
    ).join("\n") || "None.";

    const resolvedLines = resolved.map(i =>
      `- ${(i as { ai_key_question?: string | null }).ai_key_question ?? (i as { ai_summary?: string | null }).ai_summary ?? "Item"}`
    ).join("\n") || "None.";

    const blockerLines = blockers.map(i =>
      `- ${(i as { ai_key_question?: string | null }).ai_key_question ?? (i as { ai_summary?: string | null }).ai_summary ?? "Blocker"}${(i as { owner_name?: string | null }).owner_name ? ` (${(i as { owner_name?: string | null }).owner_name})` : ""}`
    ).join("\n") || "None.";

    const prompt = `You are a design ops assistant. Given this week's data, write a brief executive summary.

DECISIONS (${decisions.length}):
${decisionLines}

OPEN / NEEDS DECISION (${openItems.length}):
${openLines}

RESOLVED (${resolved.length}):
${resolvedLines}

BLOCKERS (${blockers.length}):
${blockerLines}

Return JSON with: headline (one sentence), decisions_summary, attention_needed (array of strings), blockers_summary, momentum ('up'|'down'|'stable'), momentum_reason`;

    try {
      const completion = await groq.chat.completions.create({
        model: "llama-3.1-8b-instant",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
        temperature: 0.3,
        max_tokens: 600,
      });

      const parsed = JSON.parse(completion.choices[0]?.message?.content ?? "{}") as {
        headline?: string;
        decisions_summary?: string;
        attention_needed?: string[];
        blockers_summary?: string;
        momentum?: string;
        momentum_reason?: string;
      };

      const { data: brief } = await admin.from("weekly_briefs").insert({
        workspace_id: ws.id,
        week_start: weekStartDate,
        headline: parsed.headline ?? null,
        decisions_summary: parsed.decisions_summary ?? null,
        attention_needed: parsed.attention_needed ?? [],
        blockers_summary: parsed.blockers_summary ?? null,
        momentum: parsed.momentum ?? null,
        momentum_reason: parsed.momentum_reason ?? null,
      }).select("id").single();

      // Notify workspace admins
      const { data: admins } = await admin
        .from("workspace_members")
        .select("user_id")
        .eq("workspace_id", ws.id)
        .eq("role", "admin");

      for (const member of admins ?? []) {
        await admin.from("notifications").insert({
          type: "weekly_brief_ready",
          title: "Your weekly brief is ready",
          body: parsed.headline ?? null,
          workspace_id: ws.id,
          user_id: member.user_id,
          feedback_item_id: null,
        });
      }

      void brief; // suppress unused var
      generated++;
    } catch (err) {
      console.error("[weekly-brief] error for workspace", ws.id, err);
    }
  }

  return NextResponse.json({ generated, skipped });
}
