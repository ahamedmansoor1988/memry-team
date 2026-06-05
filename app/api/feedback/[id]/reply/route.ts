/**
 * POST /api/feedback/:id/reply
 * Posts a decision reply back to Figma, nested under the original comment thread.
 * Then sends a Slack notification if a webhook is configured.
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { figmaHeaders } from "@/lib/figma/api";

const FIGMA_API = "https://api.figma.com/v1";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json() as { message: string; resolve?: boolean };
  const { message, resolve = false } = body;
  if (!message?.trim()) return NextResponse.json({ error: "Message required" }, { status: 400 });

  const admin = createAdminClient();

  // Load feedback item with full comment + file info
  const { data: item } = await admin
    .from("feedback_items")
    .select(`
      id, status, workspace_id,
      figma_comment:figma_comments(
        id,
        figma_comment_id,
        figma_order_id,
        parent_figma_comment_id,
        raw_content,
        figma_file:figma_files(id, figma_file_key, figma_pat)
      ),
      project:projects(name)
    `)
    .eq("id", id)
    .single();

  if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Supabase sometimes returns joined rows as array — normalise to single object
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const commentRaw = item.figma_comment as any;
  const comment = Array.isArray(commentRaw) ? commentRaw[0] : commentRaw;

  console.log("[reply] comment data:", JSON.stringify({
    figma_order_id: comment?.figma_order_id,
    figma_comment_id: comment?.figma_comment_id,
    parent_figma_comment_id: comment?.parent_figma_comment_id,
  }));
  const rawFile = comment?.figma_file;
  const figmaFile = (Array.isArray(rawFile) ? rawFile[0] : rawFile) as {
    id: string;
    figma_file_key: string;
    figma_pat: string;
  } | null;

  if (!figmaFile?.figma_pat || !figmaFile?.figma_file_key) {
    return NextResponse.json({ error: "No Figma file config" }, { status: 400 });
  }

  // Figma threading: parent_id must be the comment's figma id (e.g. "1779159136")
  let parentFigmaId: string | null = comment?.figma_comment_id ?? null;

  if (comment?.parent_figma_comment_id) {
    // This item is itself a reply — walk up to get the root comment's figma_comment_id
    const { data: rootComment } = await admin
      .from("figma_comments")
      .select("figma_comment_id")
      .eq("id", comment.parent_figma_comment_id)
      .single();

    if (rootComment?.figma_comment_id) {
      parentFigmaId = rootComment.figma_comment_id;
    }
  }

  if (!parentFigmaId) {
    return NextResponse.json({ error: "Cannot find parent comment figma_comment_id" }, { status: 400 });
  }

  console.log("[reply] posting to Figma with parent_id (figma_comment_id):", parentFigmaId);

  // Figma threading: use comment_id (the comment's id field) to create a threaded reply.
  // This is what the extension uses — NOT parent_id which is ignored by Figma's REST API.
  const figmaRes = await fetch(`${FIGMA_API}/files/${figmaFile.figma_file_key}/comments`, {
    method: "POST",
    headers: {
      ...figmaHeaders(figmaFile.figma_pat),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message: message.trim(),
      comment_id: parentFigmaId,  // figma_comment_id e.g. "1779702084"
    }),
  });

  const figmaData = await figmaRes.json() as Record<string, unknown>;
  console.log("[reply] Figma POST response:", figmaRes.status, JSON.stringify(figmaData));

  if (!figmaRes.ok) {
    console.error("[reply] Figma error", figmaRes.status, figmaData);
    return NextResponse.json(
      { error: (figmaData.err as string) ?? `Figma API error ${figmaRes.status}` },
      { status: figmaRes.status }
    );
  }

  // Return the full figma response so we can debug threading
  const isReply = figmaData.parent_id !== "" && figmaData.parent_id !== null && figmaData.parent_id !== undefined;
  console.log("[reply] created comment - parent_id:", figmaData.parent_id, "is_reply:", isReply);

  // Persist the new reply into figma_comments immediately so the next UI poll
  // returns it without waiting for the next Figma sync cycle.
  // Best-effort: a failure here is non-fatal; the comment already exists in Figma.
  try {
    const figmaAuthor = figmaData.user as { handle?: string; img_url?: string } | null;
    await admin.from("figma_comments").insert({
      figma_file_id:            figmaFile.id,
      workspace_id:             item.workspace_id as string,
      figma_comment_id:         figmaData.id as string,
      figma_order_id:           (figmaData.order_id as string | null) ?? null,
      parent_figma_comment_id:  comment.id as string,
      author_name:              figmaAuthor?.handle ?? user.user_metadata?.full_name ?? user.email ?? "Team member",
      author_avatar:            figmaAuthor?.img_url ?? null,
      author_email:             user.email ?? null,
      raw_content:              message.trim(),
      figma_node_id:            null,
      figma_created_at:         (figmaData.created_at as string | null) ?? new Date().toISOString(),
      resolved_at:              null,
    });
  } catch (e) {
    console.warn("[reply] figma_comments insert failed (non-fatal):", e);
  }

  // Only mark resolved when explicitly requested (decision replies, not plain thread replies)
  if (resolve) {
    const now = new Date().toISOString();
    await admin
      .from("feedback_items")
      .update({ status: "resolved", resolved_at: now, updated_at: now })
      .eq("id", id);

    // Record history (best-effort — table exists after status_system migration)
    const fromStatus = (item.status as string | null) ?? "open";
    try {
      await admin
        .from("feedback_item_status_history")
        .insert({
          item_id: id,
          workspace_id: item.workspace_id as string,
          from_status: fromStatus,
          to_status: "resolved",
          changed_by: user.id,
          reason: message.trim().slice(0, 200),
          created_at: now,
        });
    } catch (e) {
      console.warn("[reply] history insert failed:", e);
    }
  }

  // Send Slack notification — check workspace DB first, then env var
  let slackWebhook = process.env.SLACK_WEBHOOK_URL ?? null;
  if (!slackWebhook) {
    const { data: ws } = await admin
      .from("workspaces")
      .select("slack_webhook_url")
      .eq("id", item.workspace_id)
      .single();
    slackWebhook = (ws as { slack_webhook_url?: string | null } | null)?.slack_webhook_url ?? null;
  }
  if (slackWebhook) {
    const originalComment = comment?.raw_content ?? "a comment";
    const projectName = (item.project as { name?: string } | null)?.name ?? "Unknown project";

    await fetch(slackWebhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: `✅ *Decision posted to Figma*`,
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `✅ *Decision posted to Figma*\n*Project:* ${projectName}\n*Original comment:* _${originalComment.slice(0, 120)}${originalComment.length > 120 ? "…" : ""}_`,
            },
          },
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `*Decision:* ${message.trim().slice(0, 200)}`,
            },
          },
          {
            type: "context",
            elements: [
              {
                type: "mrkdwn",
                text: `Replied by ${user.user_metadata?.full_name ?? user.email ?? "a team member"} via memry`,
              },
            ],
          },
        ],
      }),
    }).catch(e => console.error("[reply] Slack notification failed:", e));
  }

  return NextResponse.json({
    ok: true,
    figma_comment_id: figmaData.id,
    debug: {
      parent_id_sent: parentFigmaId,
      figma_response_parent_id: figmaData.parent_id,
      is_reply: figmaData.parent_id !== "" && figmaData.parent_id != null,
    }
  });
}
