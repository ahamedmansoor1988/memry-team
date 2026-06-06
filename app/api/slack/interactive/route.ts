/**
 * POST /api/slack/interactive
 * Handles Slack interactive button clicks (Approve / Needs Work / Clarify).
 * Verifies the request, posts the decision to Figma, updates the Slack message.
 */
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { verifySlackSignature, updateSlackMessage, postThreadReply } from "@/lib/slack/bot";
import { figmaHeaders } from "@/lib/figma/api";
import { extractDecision } from "@/lib/ai/extract-decision";

const FIGMA_API = "https://api.figma.com/v1";

interface SlackAction {
  action_id: string;
  value: string;
}
interface SlackInteractivePayload {
  type: string;
  actions: SlackAction[];
  user: { id: string; name: string; real_name?: string };
  channel: { id: string };
  message: { ts: string; blocks?: unknown[] };
  response_url: string;
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const admin = createAdminClient();

  // Load workspace Slack credentials (DB-first, env fallback).
  // This must happen before signature verification so that the signing secret saved
  // via the Integrations UI is actually used.
  const { data: wsRow } = await admin
    .from("workspaces")
    .select("slack_signing_secret, slack_bot_token")
    .limit(1)
    .maybeSingle();
  const signingSecret = (wsRow as { slack_signing_secret?: string | null } | null)?.slack_signing_secret
    ?? process.env.SLACK_SIGNING_SECRET
    ?? "";
  const slackToken = (wsRow as { slack_bot_token?: string | null } | null)?.slack_bot_token
    ?? process.env.SLACK_BOT_TOKEN
    ?? "";

  // Verify signature with the resolved secret
  const valid = await verifySlackSignature(req, rawBody, signingSecret);
  if (!valid) {
    console.error("[slack/interactive] Invalid signature");
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  // Slack sends payload as URL-encoded form data
  const params = new URLSearchParams(rawBody);
  const payloadStr = params.get("payload");
  if (!payloadStr) return NextResponse.json({ error: "No payload" }, { status: 400 });

  const payload = JSON.parse(payloadStr) as SlackInteractivePayload;
  const action = payload.actions?.[0];
  if (!action) return NextResponse.json({ ok: true });

  const feedbackItemId = action.value;
  const slackUser = payload.user.real_name ?? payload.user.name;

  const decisionMap: Record<string, "approve" | "needs_work" | "clarify"> = {
    decision_approve:    "approve",
    decision_needs_work: "needs_work",
    decision_clarify:    "clarify",
  };

  const decision = decisionMap[action.action_id];
  if (!decision) return NextResponse.json({ ok: true });

  const messageMap = {
    approve:    "✅ Approved",
    needs_work: "⚠️ Needs Work — please revise",
    clarify:    "❓ Asking for clarification",
  };
  const figmaMessage = `${messageMap[decision]} (via Slack by ${slackUser})`;

  // Load feedback item — include figma_comments.id and figma_files.id for the persistence insert
  const { data: item } = await admin
    .from("feedback_items")
    .select(`
      id, workspace_id, status,
      figma_comment:figma_comments(
        id, figma_comment_id, parent_figma_comment_id,
        figma_file:figma_files(id, figma_file_key, figma_pat)
      ),
      project:projects(name)
    `)
    .eq("id", feedbackItemId)
    .single();

  if (!item) {
    await fetch(payload.response_url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "⚠️ Comment not found in memry." }),
    });
    return NextResponse.json({ ok: true });
  }

  // Post to Figma and immediately persist the reply into figma_comments so Memry
  // shows the decision without waiting for the next sync cycle.
  try {
    const commentRaw = item.figma_comment;
    const comment = Array.isArray(commentRaw) ? commentRaw[0] : commentRaw;
    const fileRaw = (comment as { figma_file?: unknown })?.figma_file;
    const file = (Array.isArray(fileRaw) ? fileRaw[0] : fileRaw) as {
      id: string;
      figma_file_key?: string;
      figma_pat?: string;
    } | null;

    if (file?.figma_file_key && file?.figma_pat) {
      let parentFigmaId = (comment as { figma_comment_id?: string })?.figma_comment_id ?? null;

      // Walk up if this comment is itself a reply
      const parentId = (comment as { parent_figma_comment_id?: string })?.parent_figma_comment_id;
      if (parentId) {
        const { data: root } = await admin
          .from("figma_comments")
          .select("figma_comment_id")
          .eq("id", parentId)
          .single();
        if (root?.figma_comment_id) parentFigmaId = root.figma_comment_id as string;
      }

      if (parentFigmaId) {
        const figmaRes = await fetch(`${FIGMA_API}/files/${file.figma_file_key}/comments`, {
          method: "POST",
          headers: { ...figmaHeaders(file.figma_pat), "Content-Type": "application/json" },
          body: JSON.stringify({ message: figmaMessage, comment_id: parentFigmaId }),
        });
        const figmaData = await figmaRes.json() as Record<string, unknown>;

        if (figmaRes.ok) {
          // Persist the reply immediately so the next UI poll returns it without
          // waiting for the next Figma sync cycle. Best-effort: non-fatal on failure.
          try {
            const figmaAuthor = figmaData.user as { handle?: string; img_url?: string } | null;
            const commentDbId = (comment as { id?: string })?.id;
            if (commentDbId) {
              await admin.from("figma_comments").insert({
                figma_file_id:           file.id,
                workspace_id:            item.workspace_id as string,
                figma_comment_id:        figmaData.id as string,
                figma_order_id:          (figmaData.order_id as string | null) ?? null,
                parent_figma_comment_id: commentDbId,
                author_name:             figmaAuthor?.handle ?? slackUser,
                author_avatar:           figmaAuthor?.img_url ?? null,
                author_email:            null,
                raw_content:             figmaMessage,
                figma_node_id:           null,
                figma_created_at:        (figmaData.created_at as string | null) ?? new Date().toISOString(),
                resolved_at:             null,
              });
            }
          } catch (e) {
            console.warn("[slack/interactive] figma_comments insert failed (non-fatal):", e);
          }
        } else {
          console.error("[slack/interactive] Figma post failed:", figmaRes.status, figmaData);
        }
      }
    }
  } catch (e) {
    console.error("[slack/interactive] Figma post failed:", e);
  }

  // Update DB status
  await admin
    .from("feedback_items")
    .update({ status: decision === "approve" ? "resolved" : "open" })
    .eq("id", feedbackItemId);

  // Auto-extract and persist a structured decision when approved
  if (decision === "approve") {
    try {
      const { data: fbItem } = await admin
        .from("feedback_items")
        .select("figma_comment:figma_comments(id, raw_content)")
        .eq("id", feedbackItemId)
        .single();

      const fc = Array.isArray(fbItem?.figma_comment)
        ? fbItem.figma_comment[0]
        : fbItem?.figma_comment;
      const commentText  = (fc as { raw_content?: string } | null)?.raw_content ?? "";
      const commentDbId  = (fc as { id?: string } | null)?.id;

      let replyTexts: string[] = [];
      if (commentDbId) {
        const { data: repliesData } = await admin
          .from("figma_comments")
          .select("raw_content")
          .eq("parent_figma_comment_id", commentDbId);
        replyTexts = (repliesData ?? []).map(r => (r as { raw_content: string }).raw_content);
      }

      const result = await extractDecision(commentText, replyTexts, slackUser);
      if (result) {
        await admin.from("decisions").insert({
          workspace_id:     item.workspace_id as string,
          feedback_item_id: item.id as string,
          decision_text:    result.decision_text,
          reason:           result.reason,
          owner_name:       result.owner_name ?? slackUser,
          source:           "slack",
          decided_at:       new Date().toISOString(),
        });
      }
    } catch (e) {
      console.warn("[slack/interactive] decision extraction failed (non-fatal):", e);
    }
  }

  // Update the Slack message (replace buttons with decision summary)
  try {
    await updateSlackMessage({
      channel: payload.channel.id,
      ts: payload.message.ts,
      decision,
      decidedBy: slackUser,
    }, slackToken);
  } catch (e) {
    console.error("[slack/interactive] update message failed:", e);
  }

  // Post confirmation in thread
  try {
    await postThreadReply({
      channel: payload.channel.id,
      threadTs: payload.message.ts,
      text: `${messageMap[decision]} by *${slackUser}* · Posted to Figma ✓`,
    }, slackToken);
  } catch (e) {
    console.error("[slack/interactive] thread reply failed:", e);
  }

  return NextResponse.json({ ok: true });
}
