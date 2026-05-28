/**
 * POST /api/slack/interactive
 * Handles Slack interactive button clicks (Approve / Needs Work / Clarify).
 * Verifies the request, posts the decision to Figma, updates the Slack message.
 */
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { verifySlackSignature, updateSlackMessage, postThreadReply } from "@/lib/slack/bot";
import { figmaHeaders } from "@/lib/figma/api";

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

  // Verify signature
  const valid = await verifySlackSignature(req, rawBody);
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

  const admin = createAdminClient();

  // Load feedback item
  const { data: item } = await admin
    .from("feedback_items")
    .select(`
      id, workspace_id, status,
      figma_comment:figma_comments(
        figma_comment_id, parent_figma_comment_id,
        figma_file:figma_files(figma_file_key, figma_pat)
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

  // Post to Figma
  try {
    const commentRaw = item.figma_comment;
    const comment = Array.isArray(commentRaw) ? commentRaw[0] : commentRaw;
    const fileRaw = (comment as { figma_file?: unknown })?.figma_file;
    const file = (Array.isArray(fileRaw) ? fileRaw[0] : fileRaw) as { figma_file_key?: string; figma_pat?: string } | null;

    if (file?.figma_file_key && file?.figma_pat) {
      let parentFigmaId = (comment as { figma_comment_id?: string })?.figma_comment_id ?? null;

      // Walk up if this is itself a reply
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
        await fetch(`${FIGMA_API}/files/${file.figma_file_key}/comments`, {
          method: "POST",
          headers: { ...figmaHeaders(file.figma_pat), "Content-Type": "application/json" },
          body: JSON.stringify({ message: figmaMessage, comment_id: parentFigmaId }),
        });
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

  // Update the Slack message (replace buttons with decision summary)
  try {
    await updateSlackMessage({
      channel: payload.channel.id,
      ts: payload.message.ts,
      decision,
      decidedBy: slackUser,
    });
  } catch (e) {
    console.error("[slack/interactive] update message failed:", e);
  }

  // Post confirmation in thread
  try {
    await postThreadReply({
      channel: payload.channel.id,
      threadTs: payload.message.ts,
      text: `${messageMap[decision]} by *${slackUser}* · Posted to Figma ✓`,
    });
  } catch (e) {
    console.error("[slack/interactive] thread reply failed:", e);
  }

  return NextResponse.json({ ok: true });
}
