/*
 * SLACK APP SETUP — add these to your Slack app at api.slack.com/apps:
 *
 * OAuth Scopes (Bot Token):
 *   channels:history   — read messages from public channels
 *   channels:read      — list channels
 *   groups:history     — read messages from private channels
 *   reactions:read     — read emoji reactions (signals consensus)
 *
 * Event Subscriptions → Request URL:
 *   https://memry-team-opal.vercel.app/api/slack/events
 *
 * Subscribe to bot events:
 *   message.channels   — new messages in public channels
 *   message.groups     — new messages in private channels
 *
 * After saving, Slack will send a challenge request to verify the URL.
 * This route handles the challenge automatically.
 */
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { verifySlackSignature } from "@/lib/slack/bot";
import { processSlackMessage } from "@/lib/slack/process-message";
import { answerQuestion } from "@/lib/slack/answer-question";
import { passesLengthFilter, resolveContextText } from "@/lib/slack/context";

interface SlackMessageEvent {
  type:       string;
  subtype?:   string;
  bot_id?:    string;
  text?:      string;
  user?:      string;
  channel:    string;
  ts:         string;
  thread_ts?: string;
}

interface SlackEventPayload {
  type:       string;
  team_id?:   string;
  challenge?: string;
  event?:     SlackMessageEvent;
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();

  let payload: SlackEventPayload;
  try {
    payload = JSON.parse(rawBody) as SlackEventPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // URL verification challenge — respond immediately, no signature needed
  if (payload.type === "url_verification") {
    return NextResponse.json({ challenge: payload.challenge });
  }

  // Verify Slack signature for all real events
  const valid = await verifySlackSignature(req, rawBody);
  if (!valid) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  // Handle message events
  if (payload.type === "event_callback" && payload.event?.type === "message") {
    const event = payload.event;

    // Skip bot messages, edited/deleted subtypes
    if (event.subtype || event.bot_id) return NextResponse.json({ ok: true });

    // Length filter: ≥ 20 chars for channel messages, ≥ 2 for thread replies
    // (thread replies like "done" get context from the parent message)
    if (!event.text || !passesLengthFilter(event)) return NextResponse.json({ ok: true });

    const teamId = payload.team_id;
    if (!teamId) return NextResponse.json({ ok: true });

    const admin = createAdminClient();

    // Find workspace by Slack team_id
    const { data: workspace } = await admin
      .from("workspaces")
      .select("id, slack_bot_token, slack_team_id")
      .eq("slack_team_id", teamId)
      .single();

    const ws = workspace as { id: string; slack_bot_token: string | null } | null;
    if (!ws?.slack_bot_token) return NextResponse.json({ ok: true });

    // Idempotency — skip if already seen this message
    const { data: existing } = await admin
      .from("slack_processed_messages")
      .select("id")
      .eq("workspace_id", ws.id)
      .eq("slack_channel_id", event.channel)
      .eq("slack_message_ts", event.ts)
      .maybeSingle();

    if (existing) return NextResponse.json({ ok: true });

    await admin.from("slack_processed_messages").insert({
      workspace_id:       ws.id,
      slack_channel_id:   event.channel,
      slack_message_ts:   event.ts,
      decision_extracted: false,
    });

    // Context fetch + processing in background — return 200 to Slack fast
    const botToken = ws.slack_bot_token;
    const text     = event.text;
    (async () => {
      const contextText = await resolveContextText(botToken, event.channel, {
        ts: event.ts, text, thread_ts: event.thread_ts,
      });
      await Promise.all([
        processSlackMessage({
          workspaceId: ws.id,
          botToken,
          channelId:   event.channel,
          messageTs:   event.ts,
          messageText: text,
          userId:      event.user ?? "",
          contextText: contextText ?? undefined,
        }),
        answerQuestion({
          workspaceId: ws.id,
          botToken,
          channelId:   event.channel,
          messageTs:   event.ts,
          messageText: text,
        }),
      ]);
    })().catch(err => console.error("[slack/events] processing error:", err));
  }

  return NextResponse.json({ ok: true });
}
