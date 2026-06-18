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
 *
 * Ambient sync additions:
 *   message_changed and message_deleted subtypes are now forwarded to the
 *   ambient sync pipeline (sync_events → comment_threads → thread_comments).
 *   New messages are also written to sync_events in parallel with the existing
 *   decision-extraction flow — the two pipelines are fully independent.
 */
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { verifySlackSignature } from "@/lib/slack/bot";
import { processSlackMessage } from "@/lib/slack/process-message";
import { answerQuestion } from "@/lib/slack/answer-question";
import { passesLengthFilter, resolveContextText } from "@/lib/slack/context";
import { processSyncEvent } from "@/lib/sync/process-sync-event";

interface SlackMessageEvent {
  type:        string;
  subtype?:    string;
  bot_id?:     string;
  text?:       string;
  user?:       string;
  channel:     string;
  ts:          string;
  thread_ts?:  string;
  deleted_ts?: string;
  // present on message_changed events
  message?: {
    ts:        string;
    text?:     string;
    user?:     string;
    thread_ts?: string;
    edited?:   { user: string; ts: string };
  };
}

interface SlackEventPayload {
  type:       string;
  team_id?:   string;
  challenge?: string;
  event?:     SlackMessageEvent;
}

// Subtypes that belong to the ambient sync pipeline but NOT to decision extraction
const AMBIENT_SUBTYPES = new Set(["message_changed", "message_deleted"]);

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

  if (payload.type === "event_callback" && payload.event?.type === "message") {
    const event  = payload.event;
    const teamId = payload.team_id;

    // Skip bot messages entirely — they are never meaningful for either pipeline
    if (event.bot_id) return NextResponse.json({ ok: true });

    // Skip subtypes that are neither ambient sync targets nor new messages
    if (event.subtype && !AMBIENT_SUBTYPES.has(event.subtype)) {
      return NextResponse.json({ ok: true });
    }

    if (!teamId) return NextResponse.json({ ok: true });

    const admin = createAdminClient();

    // Find workspace by Slack team_id — shared by both pipelines below
    const { data: workspace } = await admin
      .from("workspaces")
      .select("id, slack_bot_token, slack_team_id")
      .eq("slack_team_id", teamId)
      .single();

    const ws = workspace as { id: string; slack_bot_token: string | null } | null;
    if (!ws?.slack_bot_token) return NextResponse.json({ ok: true });

    const isAmbientSubtype = event.subtype ? AMBIENT_SUBTYPES.has(event.subtype) : false;

    // ── Ambient sync pipeline (runs for ALL message events) ──────────────────
    // Derive the event type for sync_events
    const ambientEventType = event.subtype === "message_changed"
      ? "edited"
      : event.subtype === "message_deleted"
      ? "deleted"
      : "created";

    // source_thread_id = channel:thread_ts|ts (groups thread replies together)
    const ambientMsgTs = event.subtype === "message_changed"
      ? (event.message?.ts ?? event.ts)
      : event.subtype === "message_deleted"
      ? (event.deleted_ts ?? event.ts)
      : event.ts;
    const ambientThreadTs = event.subtype === "message_changed"
      ? (event.message?.thread_ts ?? null)
      : event.thread_ts ?? null;
    const sourceThreadId = `${event.channel}:${ambientThreadTs ?? ambientMsgTs}`;

    ;(async () => {
      const { data: syncEvent } = await admin
        .from("sync_events")
        .insert({
          workspace_id:     ws.id,
          source:           "slack",
          event_type:       ambientEventType,
          source_thread_id: sourceThreadId,
          raw_payload:      payload as unknown as Record<string, unknown>,
        })
        .select("id")
        .single();

      const syncEventId = (syncEvent as { id: string } | null)?.id;
      if (syncEventId) {
        await processSyncEvent(syncEventId);
      }
    })().catch(err => console.error("[slack/events] ambient sync error:", err));

    // ── Decision-extraction pipeline (new messages only) ─────────────────────
    if (!isAmbientSubtype) {
      // Length filter: ≥ 20 chars for channel messages, ≥ 2 for thread replies
      if (!event.text || !passesLengthFilter(event)) return NextResponse.json({ ok: true });

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

      const botToken = ws.slack_bot_token;
      const text     = event.text;
      ;(async () => {
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
      })().catch(err => console.error("[slack/events] decision pipeline error:", err));
    }
  }

  return NextResponse.json({ ok: true });
}
