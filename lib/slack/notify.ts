/**
 * Slack DM helper — resolves a slack_handle to a user ID then sends a direct message.
 * Kept focused: no Block Kit, no threads — just a plain DM.
 */

const SLACK_API = "https://slack.com/api";

interface SlackMember {
  id: string;
  name: string;
  deleted?: boolean;
  is_bot?: boolean;
}

/**
 * Send a DM to `slackHandle` (without @).
 * Resolves handle → user ID via users.list, then posts via chat.postMessage.
 * Throws if the user cannot be found or the DM fails.
 */
export async function sendSlackDM(
  slackHandle: string,
  text: string,
  token: string,
): Promise<void> {
  if (!token) throw new Error("Slack bot token not configured");

  const handle = slackHandle.toLowerCase().replace(/^@/, "");

  // Resolve slack_handle → Slack user ID via users.list.
  // limit=1000 covers the vast majority of real-world workspaces.
  // TODO: add cursor-based pagination for workspaces with >1 000 members.
  const listRes = await fetch(`${SLACK_API}/users.list?limit=1000`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const listData = await listRes.json() as {
    ok: boolean;
    members?: SlackMember[];
    error?: string;
  };

  if (!listData.ok) {
    throw new Error(`Slack users.list failed: ${listData.error}`);
  }

  const member = (listData.members ?? []).find(
    m => !m.deleted && !m.is_bot && m.name.toLowerCase() === handle,
  );

  if (!member) {
    throw new Error(`Slack user not found for handle: ${slackHandle}`);
  }

  // Posting to channel = user ID opens (or reuses) a DM conversation.
  const dmRes = await fetch(`${SLACK_API}/chat.postMessage`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ channel: member.id, text, unfurl_links: false }),
  });
  const dmData = await dmRes.json() as { ok: boolean; error?: string };

  if (!dmData.ok) {
    throw new Error(`Slack chat.postMessage (DM) failed: ${dmData.error}`);
  }
}
