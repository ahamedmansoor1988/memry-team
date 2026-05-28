/**
 * POST /api/feedback/:id/summarize-thread
 * Summarises the full comment thread (original + all replies) using AI.
 * Returns a concise summary of what was discussed and where it landed.
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import Groq from "groq-sdk";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();

  // Load feedback item + original comment
  const { data: item } = await admin
    .from("feedback_items")
    .select(`
      id,
      figma_comment:figma_comments(
        id, author_name, raw_content, figma_created_at
      )
    `)
    .eq("id", id)
    .single();

  if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const fc = Array.isArray(item.figma_comment) ? item.figma_comment[0] : item.figma_comment;
  const original = fc as { id: string; author_name: string; raw_content: string; figma_created_at: string } | null;
  if (!original) return NextResponse.json({ error: "No comment" }, { status: 400 });

  // Load all replies
  const { data: replies } = await admin
    .from("figma_comments")
    .select("author_name, raw_content, figma_created_at")
    .eq("parent_figma_comment_id", original.id)
    .order("figma_created_at", { ascending: true });

  // Build thread text
  const threadLines = [
    `${original.author_name}: ${original.raw_content}`,
    ...(replies ?? []).map(r => `${r.author_name}: ${r.raw_content}`),
  ];

  if (threadLines.length === 1) {
    return NextResponse.json({ summary: "No replies yet — just the original comment." });
  }

  const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  const completion = await groq.chat.completions.create({
    model: "llama-3.1-8b-instant",
    messages: [
      {
        role: "system",
        content: `You are a design collaboration assistant. Summarise this Figma comment thread in 2-3 sentences. Focus on: what was discussed, what decisions were made, and current status. Be concise and factual.`,
      },
      {
        role: "user",
        content: `Thread:\n${threadLines.join("\n")}`,
      },
    ],
    max_tokens: 150,
    temperature: 0.3,
  });

  const summary = completion.choices[0]?.message?.content?.trim() ?? "Could not summarise.";

  // Save to feedback_items so it's cached
  await admin
    .from("feedback_items")
    .update({ ai_summary: summary })
    .eq("id", id);

  return NextResponse.json({ summary });
}
