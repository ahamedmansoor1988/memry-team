/**
 * Matches a Slack resolution signal ("fixed the nav spacing") to an open
 * feedback item and acts on match confidence:
 *
 *   ≥ 0.8      → auto-resolve the item + notification
 *   0.5 – 0.8  → resolution_suggestions row + notification
 *   < 0.5      → silence
 *
 * Column names verified against the live schema (2026-06-11):
 *   feedback_item_status_history: item_id, workspace_id, from_status,
 *     to_status, changed_by (uuid → auth.users, so null for system), reason
 *   notifications: workspace_id, user_id, type, title, body, feedback_item_id
 *     (user_id FK → profiles; system notifications use null = workspace-level)
 *   figma_comments text column: raw_content
 */
import Groq from "groq-sdk";
import { createAdminClient } from "@/lib/supabase/server";

interface OpenItemRow {
  id:              string;
  status:          string;
  ai_key_question: string | null;
  ai_summary:      string | null;
  figma_comment:
    | { raw_content: string | null; frame_name: string | null; page_name: string | null }
    | { raw_content: string | null; frame_name: string | null; page_name: string | null }[]
    | null;
  project: { name: string } | { name: string }[] | null;
}

interface MatchResult {
  matched_item_id:  string | null;
  match_confidence: number;
}

function first<T>(v: T | T[] | null): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

export async function matchResolution({
  workspaceId,
  botToken,
  channelId,
  messageTs,
  messageText,
  contextText,
  resolutionSummary,
  userId,
}: {
  workspaceId:       string;
  botToken:          string;
  channelId:         string;
  messageTs:         string;
  messageText:       string;
  contextText:       string | null;
  resolutionSummary: string;
  userId:            string;
}): Promise<void> {
  const admin = createAdminClient();

  async function markResolutionExtracted() {
    await admin
      .from("slack_processed_messages")
      .update({ resolution_extracted: true })
      .eq("workspace_id", workspaceId)
      .eq("slack_channel_id", channelId)
      .eq("slack_message_ts", messageTs);
  }

  // ── 1. Fetch open feedback items ──────────────────────────────────────────
  const { data: itemRows, error: itemsError } = await admin
    .from("feedback_items")
    .select(`
      id, status, ai_key_question, ai_summary,
      figma_comment:figma_comments(raw_content, frame_name, page_name),
      project:projects(name)
    `)
    .eq("workspace_id", workspaceId)
    .not("status", "in", '("resolved","archived","deleted")')
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(30);

  if (itemsError) {
    // Leave resolution_extracted = false so the catch-up scan retries
    console.error("[match-resolution] open items fetch error:", itemsError.message);
    return;
  }

  const openItems = (itemRows ?? []) as unknown as OpenItemRow[];

  // ── 2. No open items → nothing to match ──────────────────────────────────
  if (openItems.length === 0) {
    await markResolutionExtracted();
    return;
  }

  // ── 3. Groq matcher ───────────────────────────────────────────────────────
  const itemLines = openItems.map((it, i) => {
    const fc = first(it.figma_comment);
    const pj = first(it.project);
    const title = it.ai_key_question || it.ai_summary || fc?.raw_content || "Untitled";
    const where = [pj?.name, fc?.page_name, fc?.frame_name].filter(Boolean).join(" / ");
    return `${i + 1}. [id: ${it.id}] ${title}${where ? ` (${where})` : ""}`;
  }).join("\n");

  const matchPrompt = `A Slack message reports that some work is complete. Determine whether it refers to one of the open feedback items below.

Slack message: "${messageText.replace(/"/g, '\\"')}"
Work reported complete: "${resolutionSummary.replace(/"/g, '\\"')}"${contextText ? `\nContext (earlier conversation): "${contextText.replace(/"/g, '\\"')}"` : ""}

Open feedback items:
${itemLines}

Only match if the message plausibly refers to that specific item — the subject of the message and the item must be about the same piece of work. Return null rather than guessing.

Respond with JSON only:
{
  "matched_item_id": "the uuid from the list, or null",
  "match_confidence": 0.0 to 1.0
}`;

  let match: MatchResult;
  try {
    const groq       = new Groq({ apiKey: process.env.GROQ_API_KEY! });
    const completion = await groq.chat.completions.create({
      model:           "llama-3.1-8b-instant",
      messages:        [{ role: "user", content: matchPrompt }],
      response_format: { type: "json_object" },
      temperature:     0.1,
      max_tokens:      150,
    });
    match = JSON.parse(completion.choices[0]?.message?.content ?? "{}") as MatchResult;
  } catch (err) {
    console.error("[match-resolution] Groq matcher error:", err);
    return; // retry via catch-up scan
  }

  // Guard against hallucinated ids — only accept ids that were in the list
  const matchedItem = match.matched_item_id
    ? openItems.find(it => it.id === match.matched_item_id) ?? null
    : null;
  const confidence = typeof match.match_confidence === "number" ? match.match_confidence : 0;

  // ── 4a. < 0.5 or no match → silence ──────────────────────────────────────
  if (!matchedItem || confidence < 0.5) {
    await markResolutionExtracted();
    return;
  }

  // Shared bits for both action paths
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

  const slackUrl = `https://slack.com/archives/${channelId}/p${messageTs.replace(".", "")}`;
  const excerpt  = messageText.length > 80 ? `${messageText.slice(0, 77)}…` : messageText;
  const itemTitle = matchedItem.ai_key_question
    || matchedItem.ai_summary
    || first(matchedItem.figma_comment)?.raw_content
    || "feedback item";

  // ── 4b. ≥ 0.8 → auto-resolve ──────────────────────────────────────────────
  if (confidence >= 0.8) {
    const now = new Date().toISOString();

    const { error: updateError } = await admin
      .from("feedback_items")
      .update({
        status:               "resolved",
        resolved_at:          now,
        resolved_via:         "slack",
        slack_resolution_url: slackUrl,
      })
      .eq("id", matchedItem.id);

    if (updateError) {
      console.error("[match-resolution] auto-resolve update error:", updateError.message);
      return; // leave unextracted → retried; item still open so retry is safe
    }

    // History + notification are best-effort: the item is already resolved,
    // and a retry would find it closed (no duplicate resolve possible).
    const { error: historyError } = await admin.from("feedback_item_status_history").insert({
      item_id:      matchedItem.id,
      workspace_id: workspaceId,
      from_status:  matchedItem.status,
      to_status:    "resolved",
      changed_by:   null, // system action — column is uuid → auth.users
      reason:       `Auto-resolved via Slack: "${excerpt}"`,
    });
    if (historyError) console.error("[match-resolution] history insert error:", historyError.message);

    const { error: notifError } = await admin.from("notifications").insert({
      workspace_id:     workspaceId,
      user_id:          null, // workspace-level — visible to all members in the bell
      type:             "auto_resolved",
      title:            "Resolved via Slack",
      body:             `${userName}: "${excerpt}"`,
      feedback_item_id: matchedItem.id,
    });
    if (notifError) console.error("[match-resolution] notification insert error:", notifError.message);

    await markResolutionExtracted();
    return;
  }

  // ── 4c. 0.5 – 0.8 → suggest ───────────────────────────────────────────────
  const { error: suggestError } = await admin
    .from("resolution_suggestions")
    .upsert({
      workspace_id:       workspaceId,
      feedback_item_id:   matchedItem.id,
      slack_channel_id:   channelId,
      slack_message_ts:   messageTs,
      slack_message_text: messageText,
      slack_user_name:    userName,
      match_confidence:   confidence,
    }, { onConflict: "feedback_item_id,slack_message_ts", ignoreDuplicates: true });

  if (suggestError) {
    console.error("[match-resolution] suggestion insert error:", suggestError.message);
    return; // retry via catch-up scan
  }

  const { error: suggestNotifError } = await admin.from("notifications").insert({
    workspace_id:     workspaceId,
    user_id:          null,
    type:             "resolution_suggested",
    title:            "Possible resolution",
    body:             `${userName}'s message may resolve "${itemTitle}" — review it`,
    feedback_item_id: matchedItem.id,
  });
  if (suggestNotifError) console.error("[match-resolution] suggestion notification error:", suggestNotifError.message);

  await markResolutionExtracted();
}
