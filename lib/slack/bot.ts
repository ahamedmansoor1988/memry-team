/**
 * Slack Bot helpers — Stage 02
 * Uses Bot Token (xoxb-) to post rich Block Kit messages with action buttons.
 */

const SLACK_API = "https://slack.com/api";

export function botToken() {
  return process.env.SLACK_BOT_TOKEN ?? "";
}

export function defaultChannel() {
  return process.env.SLACK_CHANNEL_ID ?? "";
}

// ─── Low-level API call ───────────────────────────────────────────────────────

async function slackPost(method: string, body: Record<string, unknown>, token: string) {
  if (!token) throw new Error("SLACK_BOT_TOKEN not configured");

  const res = await fetch(`${SLACK_API}/${method}`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const data = await res.json() as { ok: boolean; error?: string; ts?: string; channel?: string };
  if (!data.ok) throw new Error(`Slack API error (${method}): ${data.error}`);
  return data;
}

// ─── Block builders ───────────────────────────────────────────────────────────

function classificationEmoji(classification: string | null): string {
  const map: Record<string, string> = {
    "Needs Decision": "🔴",
    "Blocked":        "🔴",
    "Risk":           "🟠",
    "Vague":          "🟡",
    "Approved":       "🟢",
    "Info":           "🔵",
  };
  return map[classification ?? ""] ?? "⚪";
}

export interface PostCommentOptions {
  feedbackItemId: string;
  comment: string;
  authorName: string;
  projectName: string;
  fileName: string;
  pageName?: string | null;
  classification: string | null;
  aiKeyQuestion?: string | null;
  figmaUrl?: string | null;
  channel?: string;
  /** Feedback item DB id — used to build the deep-link URL into the Memry UI. */
  itemId?: string | null;
  /** Memry project DB id — used alongside itemId to build the deep-link URL. */
  projectId?: string | null;
}

/**
 * Post a new comment to the #design-decisions channel with action buttons.
 * Returns { ts, channel } for threading later.
 *
 * Pass an explicit token to use workspace DB credentials; omit to fall back to env var.
 */
export async function postCommentToSlack(opts: PostCommentOptions, token?: string): Promise<{ ts: string; channel: string }> {
  const tok = token ?? botToken();
  const emoji = classificationEmoji(opts.classification);
  const label = opts.classification ?? "Open";
  const breadcrumb = [opts.projectName, opts.fileName, opts.pageName].filter(Boolean).join(" / ");
  const title = opts.aiKeyQuestion ?? opts.comment;

  const blocks = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `${emoji} *${label}*\n*${title}*`,
      },
    },
    {
      type: "context",
      elements: [
        { type: "mrkdwn", text: `👤 *${opts.authorName}*  ·  📁 ${breadcrumb}` },
      ],
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `> ${opts.comment.slice(0, 280)}${opts.comment.length > 280 ? "…" : ""}`,
      },
      ...(opts.figmaUrl ? {
        accessory: {
          type: "button",
          text: { type: "plain_text", text: "View in Figma ↗", emoji: true },
          url: opts.figmaUrl,
          action_id: "open_figma",
        },
      } : {}),
    },
    { type: "divider" },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "✅  Approve", emoji: true },
          style: "primary",
          action_id: "decision_approve",
          value: opts.feedbackItemId,
        },
        {
          type: "button",
          text: { type: "plain_text", text: "⚠️  Needs Work", emoji: true },
          action_id: "decision_needs_work",
          value: opts.feedbackItemId,
        },
        {
          type: "button",
          text: { type: "plain_text", text: "❓  Ask for Clarification", emoji: true },
          action_id: "decision_clarify",
          value: opts.feedbackItemId,
        },
        ...(opts.itemId && opts.projectId && process.env.NEXT_PUBLIC_APP_URL
          ? [{
              type: "button",
              text: { type: "plain_text", text: "Open in Memry", emoji: true },
              style: "primary",
              url: `${process.env.NEXT_PUBLIC_APP_URL}/inbox/${opts.projectId}/${opts.itemId}`,
              action_id: "open_in_memry",
            }]
          : []),
      ],
    },
    {
      type: "context",
      elements: [
        { type: "mrkdwn", text: `_Replying will post to Figma and mark as resolved in memry_` },
      ],
    },
  ];

  const result = await slackPost("chat.postMessage", {
    channel: opts.channel ?? defaultChannel(),
    blocks,
    text: `${emoji} ${label}: ${title}`,
    unfurl_links: false,
  }, tok);

  return { ts: result.ts!, channel: result.channel! };
}

/**
 * Update an existing Slack message (after a decision is made).
 *
 * Pass an explicit token to use workspace DB credentials; omit to fall back to env var.
 */
export async function updateSlackMessage(opts: {
  channel: string;
  ts: string;
  decision: "approve" | "needs_work" | "clarify";
  decidedBy: string;
  note?: string;
}, token?: string) {
  const tok = token ?? botToken();
  const labels = {
    approve:     { emoji: "✅", text: "Approved" },
    needs_work:  { emoji: "⚠️", text: "Needs Work" },
    clarify:     { emoji: "❓", text: "Asked for Clarification" },
  };
  const { emoji, text } = labels[opts.decision];

  await slackPost("chat.update", {
    channel: opts.channel,
    ts: opts.ts,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `${emoji} *${text}* by ${opts.decidedBy}${opts.note ? `\n> ${opts.note}` : ""}`,
        },
      },
      {
        type: "context",
        elements: [
          { type: "mrkdwn", text: "_Decision posted to Figma · Resolved in memry_" },
        ],
      },
    ],
    text: `${emoji} ${text} by ${opts.decidedBy}`,
  }, tok);
}

/**
 * Post a reply in a Slack thread.
 *
 * Pass an explicit token to use workspace DB credentials; omit to fall back to env var.
 */
export async function postThreadReply(opts: {
  channel: string;
  threadTs: string;
  text: string;
}, token?: string) {
  const tok = token ?? botToken();
  await slackPost("chat.postMessage", {
    channel: opts.channel,
    thread_ts: opts.threadTs,
    text: opts.text,
    unfurl_links: false,
  }, tok);
}

/**
 * Verify Slack's request signature to prevent spoofing.
 *
 * Pass an explicit secret to use workspace DB credentials; omit to fall back to env var.
 */
export async function verifySlackSignature(req: Request, body: string, secret?: string): Promise<boolean> {
  const resolvedSecret = secret ?? process.env.SLACK_SIGNING_SECRET;
  if (!resolvedSecret) return false;

  const timestamp = req.headers.get("x-slack-request-timestamp");
  const signature = req.headers.get("x-slack-signature");
  if (!timestamp || !signature) return false;

  // Reject requests older than 5 minutes
  if (Math.abs(Date.now() / 1000 - parseInt(timestamp)) > 300) return false;

  const sigBase = `v0:${timestamp}:${body}`;
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(resolvedSecret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sigBytes = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(sigBase));
  const computed = "v0=" + Array.from(new Uint8Array(sigBytes)).map(b => b.toString(16).padStart(2, "0")).join("");

  return computed === signature;
}
