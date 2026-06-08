import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import Groq from "groq-sdk";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

interface ExtractedDecision  { text: string; reason?: string | null; owner?: string | null; }
interface ExtractedAction    { text: string; owner?: string | null; priority?: string | null; }
interface ExtractedQuestion  { text: string; owner?: string | null; }

interface Extracted {
  decisions:       ExtractedDecision[];
  action_items:    ExtractedAction[];
  open_questions:  ExtractedQuestion[];
  summary:         string | null;
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json() as { transcript: string; project_id?: string; meeting_title?: string };
  if (!body.transcript?.trim()) return NextResponse.json({ error: "transcript required" }, { status: 400 });

  const admin = createAdminClient();
  const { data: membership } = await admin
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", user.id)
    .limit(1).single();

  const workspaceId = (membership as { workspace_id: string } | null)?.workspace_id;
  if (!workspaceId) return NextResponse.json({ error: "No workspace" }, { status: 400 });

  // Truncate transcript to avoid token limits
  const transcript = body.transcript.slice(0, 6000);

  const completion = await groq.chat.completions.create({
    model: "llama-3.1-8b-instant",
    temperature: 0.2,
    max_tokens: 1200,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `You are a meeting intelligence assistant. Extract structured information from meeting transcripts.
Return valid JSON only in this exact shape:
{
  "decisions": [
    { "text": "what was decided", "reason": "why it was decided", "owner": "person responsible or null" }
  ],
  "action_items": [
    { "text": "what needs to be done", "owner": "who owns it or null", "priority": "high|medium|low" }
  ],
  "open_questions": [
    { "text": "question that was raised but not resolved", "owner": "who raised it or null" }
  ],
  "summary": "2-3 sentence overview of the meeting"
}
Rules:
- decisions: things that were agreed upon, confirmed, or resolved
- action_items: tasks someone committed to do
- open_questions: things raised but left unresolved
- If nothing found for a category, return empty array
- owner should be a person's name from the transcript, or null`,
      },
      {
        role: "user",
        content: `Meeting title: ${body.meeting_title ?? "Untitled meeting"}\n\nTranscript:\n${transcript}`,
      },
    ],
  });

  const raw = completion.choices[0]?.message?.content ?? "{}";
  let extracted: Extracted;
  try {
    extracted = JSON.parse(raw) as Extracted;
  } catch {
    return NextResponse.json({ error: "Extraction failed" }, { status: 500 });
  }

  const now = new Date().toISOString();
  const savedDecisions:   string[] = [];
  const savedActionItems: string[] = [];

  // Save decisions to decisions table
  for (const d of extracted.decisions ?? []) {
    if (!d.text?.trim()) continue;
    await admin.from("decisions").insert({
      workspace_id:  workspaceId,
      decision_text: d.text,
      reason:        d.reason   ?? null,
      owner_name:    d.owner    ?? null,
      source:        "meeting",
      decided_at:    now,
      meeting_title: body.meeting_title ?? null,
    });
    savedDecisions.push(d.text);
  }

  // Save action items as feedback_items (if project_id provided)
  if (body.project_id) {
    for (const a of extracted.action_items ?? []) {
      if (!a.text?.trim()) continue;
      const priority = ["high", "medium", "low"].includes(a.priority ?? "") ? a.priority : "medium";
      await admin.from("feedback_items").insert({
        workspace_id:         workspaceId,
        project_id:           body.project_id,
        status:               "open",
        priority:             priority,
        ai_summary:           a.text,
        ai_key_question:      a.text,
        ai_classification:    "Needs Decision",
        ai_suggested_action:  `Assigned to: ${a.owner ?? "unassigned"}`,
        owner_name:           a.owner ?? null,
        waiting_since:        now,
      });
      savedActionItems.push(a.text);
    }
  }

  return NextResponse.json({
    summary:        extracted.summary ?? null,
    decisions:      extracted.decisions      ?? [],
    action_items:   extracted.action_items   ?? [],
    open_questions: extracted.open_questions ?? [],
    saved: {
      decisions:    savedDecisions.length,
      action_items: savedActionItems.length,
    },
  });
}
