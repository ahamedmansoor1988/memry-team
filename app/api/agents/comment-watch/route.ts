import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const maxDuration = 120;

function supabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

function sse(type: string, payload: object) {
  return `data: ${JSON.stringify({ type, ...payload })}\n\n`;
}

async function figmaFetch(
  pat: string,
  path: string,
  opts: { method?: string; body?: string } = {},
): Promise<Response> {
  const { method = "GET", body } = opts;

  async function doFetch(retried: boolean): Promise<Response> {
    const res = await fetch(`https://api.figma.com/v1${path}`, {
      method,
      headers: {
        "X-Figma-Token": pat,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body } : {}),
    });

    if (res.status === 429) {
      if (retried) throw new Error(`Figma rate limit persists. Please wait and try again.`);
      const ra      = res.headers.get("Retry-After");
      const waitSec = Math.min(ra !== null ? parseInt(ra, 10) : 65, 100);
      await new Promise(r => setTimeout(r, waitSec * 1_000));
      return doFetch(true);
    }
    return res;
  }

  return doFetch(false);
}

interface FigmaComment {
  id: string;
  message: string;
  parent_id?: string;
  resolved_at?: string | null;
  user?: { handle: string; img_url?: string };
  created_at?: string;
}

interface ClassifiedComment {
  id: string;
  text: string;
  author: string;
  classification: "vague" | "specific" | "skip";
  question?: string;
  replyCommentId?: string;
  replied: boolean;
}

export async function POST(req: NextRequest) {
  const { fileKey, pat } = await req.json() as { fileKey: string; pat: string };

  if (!fileKey || !pat) {
    return new Response(
      `data: ${JSON.stringify({ type: "error", text: "fileKey and pat are required" })}\n\n`,
      { headers: { "Content-Type": "text/event-stream" } },
    );
  }

  const encoder = new TextEncoder();
  const stream  = new ReadableStream({
    async start(controller) {
      function send(type: string, payload: object) {
        controller.enqueue(encoder.encode(sse(type, payload)));
      }

      try {
        const db = supabaseAdmin();

        // ── Step 1: Fetch comments from Figma ──────────────────────────────
        send("step", { text: "Fetching comments from Figma…" });

        const commentsRes = await figmaFetch(pat, `/files/${fileKey}/comments`);
        if (!commentsRes.ok) {
          const txt = await commentsRes.text().catch(() => "");
          send("error", { text: `Figma API error ${commentsRes.status}: ${txt.slice(0, 200)}` });
          controller.close();
          return;
        }

        const commentsData = await commentsRes.json() as { comments: FigmaComment[] };
        const allComments  = commentsData.comments ?? [];

        // Only top-level, unresolved comments
        const topLevel = allComments.filter(c => !c.parent_id && !c.resolved_at && c.message?.trim());

        send("step", { text: `Found ${topLevel.length} top-level comments.` });

        if (topLevel.length === 0) {
          send("result", { comments: [], text: "No comments found on this file." });
          controller.close();
          return;
        }

        // ── Step 2: Filter already-processed ───────────────────────────────
        const { data: existing } = await db
          .from("watched_comments")
          .select("comment_id, classification, clarifying_question, reply_comment_id, replied_at")
          .eq("file_key", fileKey)
          .in("comment_id", topLevel.map(c => c.id));

        const existingMap = new Map(
          (existing ?? []).map(r => [r.comment_id, r])
        );

        const newComments   = topLevel.filter(c => !existingMap.has(c.id));
        const alreadyDone   = topLevel.filter(c =>  existingMap.has(c.id));

        send("step", { text: `${newComments.length} new, ${alreadyDone.length} already processed.` });

        // ── Step 3: Classify new comments with Groq ─────────────────────────
        const classified: ClassifiedComment[] = [];

        // Re-add already-processed ones to the result set
        for (const c of alreadyDone) {
          const rec = existingMap.get(c.id)!;
          classified.push({
            id:             c.id,
            text:           c.message,
            author:         c.user?.handle ?? "Unknown",
            classification: rec.classification as "vague" | "specific" | "skip",
            question:       rec.clarifying_question ?? undefined,
            replyCommentId: rec.reply_comment_id ?? undefined,
            replied:        !!rec.replied_at,
          });
        }

        if (newComments.length > 0) {
          send("step", { text: `Classifying ${newComments.length} comments with AI…` });

          const inputBatch = newComments.map(c => ({
            id:   c.id,
            text: c.message.slice(0, 300),
          }));

          const aiRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method:  "POST",
            signal:  AbortSignal.timeout(30_000),
            headers: {
              Authorization:  `Bearer ${process.env.GROQ_API_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model:       "llama-3.1-8b-instant",
              temperature: 0,
              max_tokens:  2000,
              messages: [
                {
                  role:    "system",
                  content: `You are a design review assistant. Classify each Figma comment as "vague" or "specific".

Vague: lacks the "what exactly" or "how much" detail needed to act — e.g. "fix this", "looks off", "make it better", "needs work", "change the color", "adjust the spacing", "not right".
Specific: has enough detail to act on — e.g. "change heading font to Inter Bold 24px", "button background should be #2563EB", "increase top padding to 32px".
Skip: emoji-only, @mentions with no content, or automated bot messages.

For each vague comment, write a short, friendly reply question (≤20 words) asking for the missing specifics.

Input: JSON array of {id, text}
Output: JSON array of {id, classification: "vague"|"specific"|"skip", question?: string}

Return ONLY the JSON array. No explanation.`,
                },
                {
                  role:    "user",
                  content: JSON.stringify(inputBatch),
                },
              ],
            }),
          });

          if (!aiRes.ok) {
            send("error", { text: `AI classification failed: ${aiRes.status}` });
            controller.close();
            return;
          }

          const aiData    = await aiRes.json() as { choices: Array<{ message: { content: string } }> };
          const rawContent = aiData.choices[0]?.message?.content?.trim() ?? "[]";

          let aiResults: Array<{ id: string; classification: string; question?: string }> = [];
          try {
            const jsonMatch = rawContent.match(/\[[\s\S]*\]/);
            if (jsonMatch) aiResults = JSON.parse(jsonMatch[0]);
          } catch {
            send("error", { text: `Could not parse AI response: ${rawContent.slice(0, 200)}` });
            controller.close();
            return;
          }

          const aiMap = new Map(aiResults.map(r => [r.id, r]));

          for (const c of newComments) {
            const ai = aiMap.get(c.id);
            classified.push({
              id:             c.id,
              text:           c.message,
              author:         c.user?.handle ?? "Unknown",
              classification: (ai?.classification ?? "specific") as "vague" | "specific" | "skip",
              question:       ai?.question,
              replied:        false,
            });
          }

          send("step", { text: `AI classified: ${aiResults.filter(r => r.classification === "vague").length} vague, ${aiResults.filter(r => r.classification === "specific").length} specific.` });

          // ── Step 4: Upsert new classifications to DB ─────────────────────
          const upsertRows = newComments.map(c => {
            const ai = aiMap.get(c.id);
            return {
              file_key:            fileKey,
              comment_id:          c.id,
              comment_text:        c.message.slice(0, 1000),
              author_handle:       c.user?.handle ?? null,
              figma_created_at:    c.created_at ?? null,
              classification:      ai?.classification ?? "specific",
              clarifying_question: ai?.question ?? null,
            };
          });

          await db.from("watched_comments").upsert(upsertRows, { onConflict: "file_key,comment_id" });

          // ── Step 5: Reply to vague comments with throttling ──────────────
          const vagueNew = classified.filter(
            c => c.classification === "vague" && !c.replied && c.question && newComments.some(n => n.id === c.id)
          );

          if (vagueNew.length > 0) {
            send("step", { text: `Posting ${vagueNew.length} clarifying questions to Figma…` });

            for (const c of vagueNew) {
              try {
                const replyRes = await figmaFetch(pat, `/files/${fileKey}/comments`, {
                  method: "POST",
                  body:   JSON.stringify({ message: `🤔 ${c.question}`, parent_id: c.id }),
                });

                if (replyRes.ok) {
                  const replyData = await replyRes.json() as { id?: string };
                  const replyId   = replyData.id ?? `posted-${Date.now()}`;
                  c.replyCommentId = replyId;
                  c.replied        = true;

                  await db.from("watched_comments").update({
                    reply_comment_id: replyId,
                    replied_at:       new Date().toISOString(),
                  }).eq("file_key", fileKey).eq("comment_id", c.id);
                }
              } catch {}

              await new Promise(r => setTimeout(r, 400));
            }

            const posted = vagueNew.filter(c => c.replied).length;
            send("step", { text: `Posted ${posted} replies in Figma.` });
          } else if (classified.filter(c => c.classification === "vague").length > 0) {
            send("step", { text: "All vague comments already have replies." });
          }
        }

        send("result", {
          comments: classified,
          text: `Done — ${classified.filter(c => c.classification === "vague").length} vague, ${classified.filter(c => c.classification === "specific").length} specific, ${classified.filter(c => c.classification === "skip").length} skipped.`,
        });

      } catch (err) {
        controller.enqueue(encoder.encode(sse("error", { text: `Unexpected error: ${String(err)}` })));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type":  "text/event-stream",
      "Cache-Control": "no-cache",
      Connection:      "keep-alive",
    },
  });
}
