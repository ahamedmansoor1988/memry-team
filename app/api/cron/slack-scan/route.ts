/*
 * GET /api/cron/slack-scan — daily auto-join + catch-up scan.
 *
 * 1. AUTO-JOIN: joins every public channel the bot isn't in yet.
 *    Requires the `channels:join` bot scope (api.slack.com/apps →
 *    OAuth & Permissions → add scope → reinstall app → re-save the new
 *    bot token in Memry's Integrations page; the re-save re-runs auth.test
 *    and stores slack_team_id, which the events route needs).
 *    Note: conversations.join works for PUBLIC channels only — private
 *    channels always need a human /invite (Slack platform rule).
 *
 * 2. CATCH-UP: scans the last 25h of history in every member channel and
 *    runs the same decision-extraction pipeline as the real-time events
 *    route. The 1h overlap with yesterday's run is deduped by
 *    slack_processed_messages. Rows with decision_extracted = false are
 *    retried (the insert may have failed previously).
 */
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { processSlackMessage } from "@/lib/slack/process-message";
import { passesLengthFilter, resolveContextText } from "@/lib/slack/context";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

interface SlackChannel { id: string; name: string; is_member: boolean }
interface SlackMessage { type: string; subtype?: string; bot_id?: string; text?: string; user?: string; ts: string; thread_ts?: string }
interface ConversationsListResponse { ok: boolean; error?: string; channels?: SlackChannel[]; response_metadata?: { next_cursor?: string } }
interface ConversationsHistoryResponse { ok: boolean; error?: string; messages?: SlackMessage[] }
interface JoinResponse { ok: boolean; error?: string }

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function listAllPublicChannels(botToken: string): Promise<SlackChannel[]> {
  const channels: SlackChannel[] = [];
  let cursor: string | undefined;
  do {
    const url = new URL("https://slack.com/api/conversations.list");
    url.searchParams.set("types", "public_channel");
    url.searchParams.set("exclude_archived", "true");
    url.searchParams.set("limit", "200");
    if (cursor) url.searchParams.set("cursor", cursor);

    const res  = await fetch(url, { headers: { Authorization: `Bearer ${botToken}` } });
    const data = await res.json() as ConversationsListResponse;
    if (!data.ok) {
      console.error("[slack-scan] conversations.list error:", data.error);
      break;
    }
    channels.push(...(data.channels ?? []));
    cursor = data.response_metadata?.next_cursor || undefined;
  } while (cursor);
  return channels;
}

export async function GET(req: Request) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();

  const { data: workspaces } = await admin
    .from("workspaces")
    .select("id, slack_bot_token")
    .not("slack_bot_token", "is", null);

  const wsRows = (workspaces ?? []) as { id: string; slack_bot_token: string }[];

  let channelsJoined      = 0;
  let messagesScanned     = 0;
  let queuedForExtraction = 0;

  for (const ws of wsRows) {
    try {
      const botToken = ws.slack_bot_token;

      // ── Auto-join phase ───────────────────────────────────────────────────
      const channels = await listAllPublicChannels(botToken);
      const memberChannelIds = new Set(channels.filter(c => c.is_member).map(c => c.id));

      for (const channel of channels) {
        if (channel.is_member) continue;
        const res  = await fetch("https://slack.com/api/conversations.join", {
          method: "POST",
          headers: {
            Authorization:  `Bearer ${botToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ channel: channel.id }),
        });
        const data = await res.json() as JoinResponse;
        if (data.ok) {
          channelsJoined++;
          memberChannelIds.add(channel.id);
        } else {
          // e.g. "missing_scope" if channels:join wasn't added yet — keep going
          console.error(`[slack-scan] join failed for ${channel.id} (#${channel.name}):`, data.error);
        }
        await sleep(200);
      }

      // ── Catch-up phase ────────────────────────────────────────────────────
      const oldest = Math.floor((Date.now() - 25 * 60 * 60 * 1000) / 1000).toString();

      for (const channelId of Array.from(memberChannelIds)) {
        const url = new URL("https://slack.com/api/conversations.history");
        url.searchParams.set("channel", channelId);
        url.searchParams.set("oldest", oldest);
        url.searchParams.set("limit", "100");

        const res  = await fetch(url, { headers: { Authorization: `Bearer ${botToken}` } });
        const data = await res.json() as ConversationsHistoryResponse;
        if (!data.ok) {
          console.error(`[slack-scan] history fetch failed for ${channelId}:`, data.error);
          await sleep(200);
          continue;
        }

        for (const message of data.messages ?? []) {
          if (message.subtype || message.bot_id) continue;
          // Same filter as the events route: ≥ 20 chars, or ≥ 2 for thread replies
          if (!message.text || !passesLengthFilter(message)) continue;
          messagesScanned++;

          const { data: existing, error: lookupError } = await admin
            .from("slack_processed_messages")
            .select("id, decision_extracted")
            .eq("workspace_id", ws.id)
            .eq("slack_channel_id", channelId)
            .eq("slack_message_ts", message.ts)
            .maybeSingle();

          // A failed lookup must mean "skip", never "treat as new" — otherwise
          // a transient error reprocesses an already-extracted message.
          if (lookupError) {
            console.error(`[slack-scan] idempotency lookup failed for ${channelId}/${message.ts}:`, lookupError.message);
            continue;
          }

          const row = existing as { id: string; decision_extracted: boolean } | null;
          if (row?.decision_extracted) continue;

          if (!row) {
            await admin.from("slack_processed_messages").insert({
              workspace_id:       ws.id,
              slack_channel_id:   channelId,
              slack_message_ts:   message.ts,
              decision_extracted: false,
            });
          }
          // Row with decision_extracted = false → retry path (Part 0 fix keeps these eligible)

          const contextText = await resolveContextText(botToken, channelId, {
            ts: message.ts, text: message.text, thread_ts: message.thread_ts,
          });

          await processSlackMessage({
            workspaceId: ws.id,
            botToken,
            channelId,
            messageTs:   message.ts,
            messageText: message.text,
            userId:      message.user ?? "",
            contextText: contextText ?? undefined,
          });
          queuedForExtraction++;
        }

        await sleep(200);
      }
    } catch (err) {
      console.error(`[slack-scan] workspace ${ws.id} failed:`, err);
    }
  }

  return NextResponse.json({
    ok: true,
    workspaces: wsRows.length,
    channelsJoined,
    messagesScanned,
    queuedForExtraction,
  });
}
