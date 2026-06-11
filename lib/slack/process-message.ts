import Groq from "groq-sdk";
import { createAdminClient } from "@/lib/supabase/server";

interface GroqDecisionResult {
  is_decision:   boolean;
  confidence:    number;
  decision_text: string;
  rationale:     string | null;
  category:      string;
}

export async function processSlackMessage({
  workspaceId,
  botToken,
  channelId,
  messageTs,
  messageText,
  userId,
}: {
  workspaceId: string;
  botToken:    string;
  channelId:   string;
  messageTs:   string;
  messageText: string;
  userId:      string;
}) {
  const admin = createAdminClient();

  // ── Step 1: AI classification ─────────────────────────────────────────────
  const prompt = `Analyze this Slack message and determine if it contains a decision.
A decision is a clear statement of what was chosen, agreed upon, or committed to — not a question, discussion, or idea.

Examples of DECISIONS:
- "We're going with option B for the nav redesign"
- "Decided to cut the export feature from v1"
- "Let's use Stripe for payments, not Paddle"
- "We agreed to push the launch to next week"

Examples of NOT decisions:
- "What do you think about option B?"
- "Has anyone looked at the nav yet?"
- "I like option B tbh"
- "lol ok"

Message: "${messageText.replace(/"/g, '\\"')}"

Respond with JSON only:
{
  "is_decision": true or false,
  "confidence": 0.0 to 1.0,
  "decision_text": "clean one-sentence summary of the decision",
  "rationale": "why this was decided if mentioned, or null",
  "category": "design or product or technical or process or other"
}`;

  let groqResult: GroqDecisionResult | null = null;
  try {
    const groq       = new Groq({ apiKey: process.env.GROQ_API_KEY! });
    const completion = await groq.chat.completions.create({
      model:           "llama-3.1-8b-instant",
      messages:        [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      temperature:     0.1,
      max_tokens:      300,
    });
    groqResult = JSON.parse(completion.choices[0]?.message?.content ?? "{}") as GroqDecisionResult;
  } catch (err) {
    console.error("[process-message] Groq error:", err);
    return;
  }

  if (!groqResult.is_decision || groqResult.confidence < 0.7) {
    await admin
      .from("slack_processed_messages")
      .update({ decision_extracted: false })
      .eq("workspace_id", workspaceId)
      .eq("slack_channel_id", channelId)
      .eq("slack_message_ts", messageTs);
    return;
  }

  // ── Step 2: Fetch channel name ────────────────────────────────────────────
  let channelName = channelId;
  try {
    const chanRes  = await fetch(`https://slack.com/api/conversations.info?channel=${channelId}`, {
      headers: { Authorization: `Bearer ${botToken}` },
    });
    const chanData = await chanRes.json() as { ok: boolean; channel?: { name?: string } };
    if (chanData.ok && chanData.channel?.name) {
      channelName = chanData.channel.name;
    }
  } catch { /* non-fatal */ }

  // ── Step 3: Fetch user name ───────────────────────────────────────────────
  let userName = "Slack user";
  try {
    const userRes  = await fetch(`https://slack.com/api/users.info?user=${userId}`, {
      headers: { Authorization: `Bearer ${botToken}` },
    });
    const userData = await userRes.json() as { ok: boolean; user?: { real_name?: string; name?: string } };
    if (userData.ok && userData.user) {
      userName = userData.user.real_name ?? userData.user.name ?? "Slack user";
    }
  } catch { /* non-fatal */ }

  // ── Step 4: Build thread URL ──────────────────────────────────────────────
  const { data: ws } = await admin
    .from("workspaces")
    .select("slack_team_id")
    .eq("id", workspaceId)
    .single();

  const teamId  = (ws as { slack_team_id?: string | null } | null)?.slack_team_id;
  const slackUrl = teamId
    ? `https://slack.com/archives/${channelId}/p${messageTs.replace(".", "")}`
    : null;

  // ── Step 5: Save decision ─────────────────────────────────────────────────
  const { error: decisionError } = await admin.from("decisions").insert({
    workspace_id:       workspaceId,
    decision_text:      groqResult.decision_text,
    reason:             groqResult.rationale ?? null,
    source:             "slack",
    status:             "open",
    slack_channel_id:   channelId,
    slack_channel_name: channelName,
    slack_message_ts:   messageTs,
    slack_thread_url:   slackUrl,
    owner_name:         userName,
    decided_at:         new Date(parseFloat(messageTs) * 1000).toISOString(),
  });
  if (decisionError) {
    // Leave decision_extracted = false so the daily catch-up scan retries this message
    console.error("[process-message] decision insert error:", decisionError.message);
    return;
  }

  // ── Step 6: Mark extracted ────────────────────────────────────────────────
  await admin
    .from("slack_processed_messages")
    .update({ decision_extracted: true })
    .eq("workspace_id", workspaceId)
    .eq("slack_channel_id", channelId)
    .eq("slack_message_ts", messageTs);
}
