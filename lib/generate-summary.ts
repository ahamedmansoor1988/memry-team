import Groq from "groq-sdk";
import { createAdminClient } from "@/lib/supabase/server";

const SOURCE_EMOJI: Record<string, string> = {
  slack: "💬", figma: "🎨", jira: "📋", notion: "📝",
};

function fmtDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const d = Math.floor(minutes / 1440);
  const h = Math.floor((minutes % 1440) / 60);
  const m = minutes % 60;
  if (d > 0) return h > 0 ? `${d}d ${h}h` : `${d}d`;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

export async function generateSummary(threadId: string): Promise<void> {
  const admin = createAdminClient();

  const [threadRes, commentsRes, decisionRes] = await Promise.all([
    admin
      .from("threads")
      .select("id, workspace_id, project_id, source, source_url, title, created_at, resolved_at")
      .eq("id", threadId)
      .single(),
    admin
      .from("comments")
      .select("author_name, body, created_at, sequence_order")
      .eq("thread_id", threadId)
      .is("deleted_at", null)
      .order("sequence_order", { ascending: true }),
    admin
      .from("decisions")
      .select("what, why, who, stakeholders, rejected_alternatives")
      .eq("thread_id", threadId)
      .maybeSingle(),
  ]);

  const thread   = threadRes.data   as any;
  const comments = (commentsRes.data ?? []) as any[];
  const decision = decisionRes.data as any;

  if (!thread || !comments.length) return;

  // Time to resolve from actual timestamps
  const startMs = new Date(comments[0].created_at).getTime();
  const endMs   = thread.resolved_at
    ? new Date(thread.resolved_at).getTime()
    : new Date(comments[comments.length - 1].created_at).getTime();
  const timeToResolveMinutes = Math.max(1, Math.round((endMs - startMs) / 60_000));

  // Build Groq prompt
  const conversationText = comments
    .map((c: any, i: number) => `[${i + 1}] ${c.author_name ?? "Unknown"}: ${c.body}`)
    .join("\n\n");

  const prompt = `Summarize this resolved ${thread.source} comment thread for a product/design team.

Thread: "${thread.title ?? "Untitled"}"
Resolved in: ${fmtDuration(timeToResolveMinutes)}

Conversation:
${conversationText}

Return ONLY valid JSON:
{
  "summary_text": "2-3 sentences: what was discussed, what was decided, key context",
  "blockers_identified": ["any blockers mentioned"],
  "risks_identified": ["any risks mentioned"],
  "decision_made": true or false
}`;

  const groq = new Groq({ apiKey: process.env.GROQ_API_KEY! });
  let groqResult: {
    summary_text:       string;
    blockers_identified: string[];
    risks_identified:    string[];
    decision_made:       boolean;
  };

  try {
    const completion = await groq.chat.completions.create({
      model:           "llama-3.3-70b-versatile",
      messages:        [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      temperature:     0.1,
      max_tokens:      400,
    });
    const raw = completion.choices[0]?.message?.content;
    if (!raw) return;
    groqResult = JSON.parse(raw);
    if (!Array.isArray(groqResult.blockers_identified)) groqResult.blockers_identified = [];
    if (!Array.isArray(groqResult.risks_identified))    groqResult.risks_identified    = [];
    if (typeof groqResult.decision_made !== "boolean")  groqResult.decision_made       = false;
  } catch (err) {
    console.error("[generate-summary] Groq error:", err);
    return;
  }

  // Upsert summaries (UNIQUE thread_id)
  const { data: summaryRow } = await admin
    .from("summaries")
    .upsert(
      {
        thread_id:               threadId,
        summary_text:            groqResult.summary_text,
        time_to_resolve_minutes: timeToResolveMinutes,
        decision_made:           groqResult.decision_made,
        blockers_identified:     groqResult.blockers_identified,
        risks_identified:        groqResult.risks_identified,
        posted_to_slack:         false,
      },
      { onConflict: "thread_id" }
    )
    .select("id")
    .single();

  // Resolve Slack creds + channel
  const { data: ws } = await admin
    .from("workspaces")
    .select("slack_bot_token, slack_channel_id")
    .eq("id", thread.workspace_id)
    .maybeSingle();

  const workspace = ws as any;
  if (!workspace?.slack_bot_token) return;

  let channelId: string | null = workspace.slack_channel_id;
  if (thread.project_id) {
    const { data: proj } = await admin
      .from("projects")
      .select("slack_channel_id")
      .eq("id", thread.project_id)
      .maybeSingle();
    if ((proj as any)?.slack_channel_id) channelId = (proj as any).slack_channel_id;
  }
  if (!channelId) return;

  // Build Block Kit message
  const emoji       = SOURCE_EMOJI[thread.source] ?? "📌";
  const sourceLabel = (thread.source as string).charAt(0).toUpperCase() + (thread.source as string).slice(1);
  const threadUrl   = `https://memry.link/${threadId}`;
  const sourceUrl   = thread.source_url ?? threadUrl;

  const blocks: any[] = [
    {
      type: "header",
      text: { type: "plain_text", text: `${emoji} ${sourceLabel} thread resolved`, emoji: true },
    },
    {
      type: "context",
      elements: [{ type: "mrkdwn", text: `Resolved in ${fmtDuration(timeToResolveMinutes)}` }],
    },
    { type: "divider" },
  ];

  if (decision?.what) {
    blocks.push({ type: "section", text: { type: "mrkdwn", text: `*What was decided*\n${decision.what}` } });
  }
  if (decision?.why) {
    blocks.push({ type: "section", text: { type: "mrkdwn", text: `*Why*\n${decision.why}` } });
  }
  if (decision?.who) {
    const with_ = (decision.stakeholders as string[])?.length
      ? `  •  with ${(decision.stakeholders as string[]).join(", ")}`
      : "";
    blocks.push({ type: "section", text: { type: "mrkdwn", text: `*Who decided it*\n${decision.who}${with_}` } });
  }
  if ((decision?.rejected_alternatives as string[])?.length) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `*What was rejected*\n${(decision.rejected_alternatives as string[]).join("\n")}` },
    });
  }
  if (!decision?.what) {
    // No decision row yet — fall back to AI summary text
    blocks.push({ type: "section", text: { type: "mrkdwn", text: groqResult.summary_text } });
  }

  blocks.push({
    type: "actions",
    elements: [
      {
        type:      "button",
        text:      { type: "plain_text", text: "View full thread →", emoji: false },
        url:       threadUrl,
        action_id: "view_thread",
      },
      {
        type:      "button",
        text:      { type: "plain_text", text: `View in ${sourceLabel}`, emoji: false },
        url:       sourceUrl,
        action_id: "view_source",
      },
    ],
  });

  // Post to Slack (failure is non-fatal)
  try {
    const slackRes  = await fetch("https://slack.com/api/chat.postMessage", {
      method:  "POST",
      headers: {
        Authorization:  `Bearer ${workspace.slack_bot_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        channel:      channelId,
        text:         `${emoji} ${sourceLabel} thread resolved: ${thread.title ?? "Untitled"}`,
        blocks,
        unfurl_links: false,
      }),
    });

    const slackData = await slackRes.json() as { ok: boolean; ts?: string; error?: string };

    if (slackData.ok && slackData.ts && (summaryRow as any)?.id) {
      await admin
        .from("summaries")
        .update({ posted_to_slack: true, slack_ts: slackData.ts })
        .eq("id", (summaryRow as any).id);
    } else if (!slackData.ok) {
      console.error("[generate-summary] Slack post failed:", slackData.error);
    }
  } catch (err) {
    console.error("[generate-summary] Slack network error:", err);
  }
}
