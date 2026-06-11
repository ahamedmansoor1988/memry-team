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

interface SlackMessageEvent {
  type:     string;
  subtype?: string;
  bot_id?:  string;
  text?:    string;
  user?:    string;
  channel:  string;
  ts:       string;
}

interface SlackEventPayload {
  type:       string;
  team_id?:   string;
  challenge?: string;
  event?:     SlackMessageEvent;
}

export async function POST(req: NextRequest) {
  console.log("[slack/events] ── STAGE 1: request received", {
    method: req.method,
    url: req.url,
    hasSignature: !!req.headers.get("x-slack-signature"),
    hasTimestamp: !!req.headers.get("x-slack-request-timestamp"),
    hasSigningSecret: !!process.env.SLACK_SIGNING_SECRET,
  });

  const rawBody = await req.text();
  console.log("[slack/events] ── STAGE 2: raw body length", rawBody.length);

  let payload: SlackEventPayload;
  try {
    payload = JSON.parse(rawBody) as SlackEventPayload;
    console.log("[slack/events] ── STAGE 3: parsed payload type=", payload.type, "team_id=", payload.team_id);
  } catch {
    console.error("[slack/events] ── STAGE 3: JSON parse failed");
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // URL verification challenge — respond immediately, no signature needed
  if (payload.type === "url_verification") {
    console.log("[slack/events] ── STAGE 4: url_verification challenge, responding");
    return NextResponse.json({ challenge: payload.challenge });
  }

  // Verify Slack signature for all real events
  const valid = await verifySlackSignature(req, rawBody);
  console.log("[slack/events] ── STAGE 4: signature valid=", valid);
  if (!valid) {
    console.error("[slack/events] ── STAGE 4: FAILED signature check — dropping event");
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  // Handle message events
  if (payload.type === "event_callback" && payload.event?.type === "message") {
    const event = payload.event;
    console.log("[slack/events] ── STAGE 5: message event", {
      subtype: event.subtype,
      bot_id: event.bot_id,
      textLength: event.text?.length,
      channel: event.channel,
      user: event.user,
      ts: event.ts,
    });

    // Skip bot messages, edited/deleted subtypes
    if (event.subtype || event.bot_id) {
      console.log("[slack/events] ── STAGE 5: skipping — bot/subtype message");
      return NextResponse.json({ ok: true });
    }

    // Skip very short messages — unlikely to be decisions
    if (!event.text || event.text.length < 20) {
      console.log("[slack/events] ── STAGE 5: skipping — message too short", event.text?.length);
      return NextResponse.json({ ok: true });
    }

    const teamId = payload.team_id;
    if (!teamId) {
      console.error("[slack/events] ── STAGE 6: no team_id in payload");
      return NextResponse.json({ ok: true });
    }

    const admin = createAdminClient();

    // Find workspace by Slack team_id
    const { data: workspace, error: wsError } = await admin
      .from("workspaces")
      .select("id, slack_bot_token, slack_team_id")
      .eq("slack_team_id", teamId)
      .single();

    console.log("[slack/events] ── STAGE 6: workspace lookup", {
      teamId,
      found: !!workspace,
      error: wsError?.message,
      hasToken: !!(workspace as { slack_bot_token?: string } | null)?.slack_bot_token,
    });

    const ws = workspace as { id: string; slack_bot_token: string | null } | null;
    if (!ws?.slack_bot_token) {
      console.error("[slack/events] ── STAGE 6: FAILED — no workspace found for team_id=", teamId);
      return NextResponse.json({ ok: true });
    }

    // Idempotency — skip if already seen this message
    const { data: existing } = await admin
      .from("slack_processed_messages")
      .select("id")
      .eq("workspace_id", ws.id)
      .eq("slack_channel_id", event.channel)
      .eq("slack_message_ts", event.ts)
      .maybeSingle();

    if (existing) {
      console.log("[slack/events] ── STAGE 7: already processed, skipping");
      return NextResponse.json({ ok: true });
    }

    // Insert processing record
    const { error: insertError } = await admin.from("slack_processed_messages").insert({
      workspace_id:       ws.id,
      slack_channel_id:   event.channel,
      slack_message_ts:   event.ts,
      decision_extracted: false,
    });
    console.log("[slack/events] ── STAGE 7: inserted processing record, error=", insertError?.message);

    // Process in background
    console.log("[slack/events] ── STAGE 8: firing processSlackMessage");
    processSlackMessage({
      workspaceId: ws.id,
      botToken:    ws.slack_bot_token,
      channelId:   event.channel,
      messageTs:   event.ts,
      messageText: event.text,
      userId:      event.user ?? "",
    }).catch(err => console.error("[slack/events] processSlackMessage error:", err));
  } else {
    console.log("[slack/events] ── not a message event_callback, type=", payload.type, "event type=", payload.event?.type);
  }

  return NextResponse.json({ ok: true });
}
