/**
 * Shared Slack message context helpers, used by both the real-time events
 * route and the daily catch-up scan.
 *
 * - Thread replies ("done", "fixed ✅") carry no context of their own, so we
 *   fetch the thread parent and relax the length filter to 2 chars.
 * - Short non-thread messages (20–80 chars) get the previous 5 channel
 *   messages as context. Longer messages carry their own context.
 */

const SLACK_API = "https://slack.com/api";

export interface SlackContextMessage {
  ts:         string;
  text:       string;
  thread_ts?: string;
}

export function isThreadReply(msg: { ts: string; thread_ts?: string }): boolean {
  return !!msg.thread_ts && msg.thread_ts !== msg.ts;
}

/** Length filter: thread replies need ≥ 2 chars, channel messages ≥ 20. */
export function passesLengthFilter(msg: { ts: string; text?: string; thread_ts?: string }): boolean {
  if (!msg.text) return false;
  const min = isThreadReply(msg) ? 2 : 20;
  return msg.text.length >= min;
}

/**
 * Returns conversation context for the message, or null when the message
 * stands on its own (or context can't be fetched — context is best-effort).
 */
export async function resolveContextText(
  botToken:  string,
  channelId: string,
  msg:       SlackContextMessage,
): Promise<string | null> {
  // Thread reply → fetch the parent message
  if (isThreadReply(msg)) {
    try {
      const url = new URL(`${SLACK_API}/conversations.replies`);
      url.searchParams.set("channel", channelId);
      url.searchParams.set("ts", msg.thread_ts!);
      url.searchParams.set("limit", "1");
      const res  = await fetch(url, { headers: { Authorization: `Bearer ${botToken}` } });
      const data = await res.json() as { ok: boolean; messages?: { text?: string }[] };
      const parent = data.ok ? data.messages?.[0]?.text : null;
      return parent || null;
    } catch {
      return null;
    }
  }

  // Short channel message → fetch the previous 5 messages for context
  if (msg.text.length >= 20 && msg.text.length <= 80) {
    try {
      const url = new URL(`${SLACK_API}/conversations.history`);
      url.searchParams.set("channel", channelId);
      url.searchParams.set("latest", msg.ts); // exclusive by default — returns messages before this one
      url.searchParams.set("limit", "5");
      const res  = await fetch(url, { headers: { Authorization: `Bearer ${botToken}` } });
      const data = await res.json() as { ok: boolean; messages?: { text?: string }[] };
      if (!data.ok) return null;
      const texts = (data.messages ?? [])
        .map(m => m.text)
        .filter((t): t is string => !!t)
        .reverse(); // oldest first
      return texts.length ? texts.join("\n") : null;
    } catch {
      return null;
    }
  }

  return null;
}
