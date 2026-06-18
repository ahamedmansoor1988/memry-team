/**
 * generateThreadSummary(threadId)
 *
 * Called automatically when any comment thread is resolved (by the sync engine).
 * Orchestrates: fetch → Groq summarisation → thread_summaries row → Slack Block Kit post.
 *
 * Slack failure is non-fatal: posted_to_slack stays false so the retry cron (Prompt 7)
 * can pick it up without re-running the AI step.
 */
import Groq from "groq-sdk";
import { createAdminClient } from "@/lib/supabase/server";

// ── Constants ─────────────────────────────────────────────────────────────────

const SOURCE_EMOJI: Record<string, string> = {
  figma:  "🎨",
  slack:  "💬",
  jira:   "📋",
  notion: "📝",
};

const SOURCE_LABEL: Record<string, string> = {
  figma:  "Figma",
  slack:  "Slack",
  jira:   "Jira",
  notion: "Notion",
};

// ── Types ─────────────────────────────────────────────────────────────────────

interface ThreadRow {
  id:          string;
  workspace_id: string;
  project_id:  string | null;
  source:      string;
  source_url:  string | null;
  title:       string | null;
  created_at:  string;
  resolved_at: string | null;
}

interface CommentRow {
  author_name:    string | null;
  author_email:   string | null;
  body:           string;
  created_at:     string;
  sequence_order: number;
}

interface DecisionRow {
  decision_text:   string;
  rationale:       string | null;
  owner:           string | null;
  stakeholders:    string[];
  confidence_score: number | null;
}

interface GroqSummaryResult {
  decision_made:      string;   // one sentence; "No decision recorded." if none
  rationale:          string | null;
  owner:              string | null;
  stakeholders:       string[];
  summary_one_liner:  string;   // ≤80 chars
  summary_full:       string;   // 2-3 sentences
}

// ── Entry point ───────────────────────────────────────────────────────────────

export async function generateThreadSummary(threadId: string): Promise<void> {
  const admin = createAdminClient();

  // ── 1. Fetch thread + comments + existing decision ────────────────────────
  const [threadResult, commentsResult, decisionResult] = await Promise.all([
    admin
      .from("comment_threads")
      .select("id, workspace_id, project_id, source, source_url, title, created_at, resolved_at")
      .eq("id", threadId)
      .single(),
    admin
      .from("thread_comments")
      .select("author_name, author_email, body, created_at, sequence_order")
      .eq("thread_id", threadId)
      .is("deleted_at", null)
      .order("sequence_order", { ascending: true }),
    admin
      .from("thread_decisions")
      .select("decision_text, rationale, owner, stakeholders, confidence_score")
      .eq("thread_id", threadId)
      .order("confidence_score", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const thread   = threadResult.data  as ThreadRow | null;
  const comments = (commentsResult.data ?? []) as CommentRow[];
  const decision = decisionResult.data as DecisionRow | null;

  if (!thread) {
    console.error(`[generate-summary] thread ${threadId} not found`);
    return;
  }
  if (comments.length === 0) {
    console.warn(`[generate-summary] thread ${threadId} has no comments — skipping`);
    return;
  }

  // ── 2. Calculate time_to_resolve_minutes from actual timestamps ───────────
  // Start = first comment's created_at. End = resolved_at if set, else last comment.
  const startMs = new Date(comments[0].created_at).getTime();
  const endMs   = thread.resolved_at
    ? new Date(thread.resolved_at).getTime()
    : new Date(comments[comments.length - 1].created_at).getTime();
  const timeToResolveMinutes = Math.max(1, Math.round((endMs - startMs) / 60_000));

  // ── 3. Build Groq prompt ──────────────────────────────────────────────────
  const sourceLabel = SOURCE_LABEL[thread.source] ?? thread.source;

  const conversationLines = comments.map((c, i) => {
    const author = c.author_name ?? c.author_email ?? "Unknown";
    const time   = new Date(c.created_at).toISOString().replace("T", " ").slice(0, 16);
    return `[${i + 1}] ${author} at ${time}:\n${c.body.trim()}`;
  });

  const decisionHint = decision
    ? `\n\nA decision was previously extracted from this thread:\n"${decision.decision_text}"${decision.owner ? ` (owner: ${decision.owner})` : ""}`
    : "";

  const prompt = `You are summarizing a resolved ${sourceLabel} comment thread for a product/design team.

Thread: "${thread.title ?? "Untitled"}"
Source tool: ${sourceLabel}
Time to resolve: ${timeToResolveMinutes} minutes${decisionHint}

Full conversation (${comments.length} message${comments.length === 1 ? "" : "s"}):
${conversationLines.join("\n\n")}

Summarize this thread and return ONLY valid JSON in this exact shape:
{
  "decision_made": "One clear sentence: what was decided. If nothing was decided, write exactly: No decision recorded.",
  "rationale": "Why this decision was made (1 sentence), or null if not mentioned",
  "owner": "Full name of whoever is responsible for carrying this out, or null",
  "stakeholders": ["name1", "name2"],
  "summary_one_liner": "Max 80 characters — what happened in this thread",
  "summary_full": "2-3 sentences covering what was discussed, what was decided, and any important context"
}

Rules:
- summary_one_liner must be ≤80 characters
- stakeholders should only include people explicitly named in the conversation
- owner should be the person who made the decision or was assigned a task, not the thread author
- Be concise and scannable — someone reading in 10 seconds should get the full picture`;

  // ── 4. Call Groq (70b for higher quality summaries) ───────────────────────
  let groqResult: GroqSummaryResult;
  try {
    const groq       = new Groq({ apiKey: process.env.GROQ_API_KEY! });
    const completion = await groq.chat.completions.create({
      model:           "llama-3.3-70b-versatile",
      messages:        [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      temperature:     0.1,
      max_tokens:      500,
    });

    const raw = completion.choices[0]?.message?.content;
    if (!raw) throw new Error("empty Groq response");
    groqResult = JSON.parse(raw) as GroqSummaryResult;

    // Coerce / guard required fields
    if (typeof groqResult.decision_made !== "string")     groqResult.decision_made = "No decision recorded.";
    if (!Array.isArray(groqResult.stakeholders))          groqResult.stakeholders  = [];
    if (typeof groqResult.summary_one_liner !== "string") groqResult.summary_one_liner = thread.title ?? "Thread resolved";
    if (typeof groqResult.summary_full !== "string")      groqResult.summary_full  = groqResult.summary_one_liner;

    // Enforce 80-char cap on one-liner
    if (groqResult.summary_one_liner.length > 80) {
      groqResult.summary_one_liner = groqResult.summary_one_liner.slice(0, 77) + "…";
    }
  } catch (err) {
    console.error("[generate-summary] Groq error:", err);
    return;
  }

  // ── 5. Save to thread_summaries (upsert — re-running is safe) ────────────
  const decisionMade = groqResult.decision_made !== "No decision recorded." && groqResult.decision_made.length > 0;

  const { error: summaryErr } = await admin
    .from("thread_summaries")
    .upsert({
      thread_id:               threadId,
      summary_text:            groqResult.summary_full,
      time_to_resolve_minutes: timeToResolveMinutes,
      stakeholders_involved:   groqResult.stakeholders,
      decision_made:           decisionMade,
      posted_to_slack:         false,   // set to true only after confirmed Slack delivery
    }, { onConflict: "thread_id" });

  if (summaryErr) {
    console.error("[generate-summary] thread_summaries upsert error:", summaryErr.message);
    return;
  }

  // ── 6. Resolve Slack credentials + channel ────────────────────────────────
  const { data: wsRow } = await admin
    .from("workspaces")
    .select("slack_bot_token, slack_channel_id")
    .eq("id", thread.workspace_id)
    .maybeSingle();

  const ws = wsRow as { slack_bot_token: string | null; slack_channel_id: string | null } | null;

  if (!ws?.slack_bot_token) {
    console.warn("[generate-summary] no Slack token — skipping notification");
    return;
  }

  // Prefer project-specific channel mapping over workspace default
  let channelId: string | null = ws.slack_channel_id;
  if (thread.project_id) {
    const { data: mapping } = await admin
      .from("slack_channel_mappings")
      .select("slack_channel_id")
      .eq("workspace_id", thread.workspace_id)
      .eq("project_id", thread.project_id)
      .maybeSingle();

    const mapped = (mapping as { slack_channel_id: string } | null)?.slack_channel_id;
    if (mapped) channelId = mapped;
  }

  if (!channelId) {
    console.warn("[generate-summary] no Slack channel configured — skipping notification");
    return;
  }

  // ── 7. Build Block Kit message ────────────────────────────────────────────
  const emoji      = SOURCE_EMOJI[thread.source] ?? "📌";
  const threadUrl  = `https://memry.link/${threadId}`;
  const sourceUrl  = thread.source_url ?? threadUrl;

  const formatDuration = (mins: number): string => {
    if (mins < 60) return `${mins}m`;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  };

  // Section fields — only include non-null values to keep the message clean
  const fields: Array<{ type: string; text: string }> = [
    { type: "mrkdwn", text: `*Decision*\n${groqResult.decision_made}` },
  ];

  if (groqResult.rationale) {
    fields.push({ type: "mrkdwn", text: `*Rationale*\n${groqResult.rationale}` });
  }
  if (groqResult.owner) {
    fields.push({ type: "mrkdwn", text: `*Owner*\n${groqResult.owner}` });
  }
  if (groqResult.stakeholders.length > 0) {
    fields.push({ type: "mrkdwn", text: `*Stakeholders*\n${groqResult.stakeholders.join(", ")}` });
  }
  fields.push({ type: "mrkdwn", text: `*Time to resolve*\n${formatDuration(timeToResolveMinutes)}` });
  fields.push({ type: "mrkdwn", text: `*Source*\n<${sourceUrl}|View in ${sourceLabel}>` });

  const blocks = [
    {
      type: "header",
      text: { type: "plain_text", text: `${emoji} ${sourceLabel} thread resolved`, emoji: true },
    },
    {
      type: "section",
      text: { type: "mrkdwn", text: `*${groqResult.summary_one_liner}*` },
    },
    { type: "divider" },
    { type: "section", fields },
    {
      type: "actions",
      elements: [
        {
          type:      "button",
          text:      { type: "plain_text", text: "View full thread →", emoji: false },
          url:       threadUrl,
          action_id: "view_thread",
        },
      ],
    },
  ];

  // ── 8. Post to Slack (failure is non-fatal — cron retries) ───────────────
  try {
    const slackRes  = await fetch("https://slack.com/api/chat.postMessage", {
      method:  "POST",
      headers: { Authorization: `Bearer ${ws.slack_bot_token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        channel:      channelId,
        text:         `${emoji} ${sourceLabel} thread resolved: ${groqResult.summary_one_liner}`,
        blocks,
        unfurl_links: false,
      }),
    });

    const slackData = await slackRes.json() as { ok: boolean; ts?: string; error?: string };

    if (slackData.ok && slackData.ts) {
      await admin
        .from("thread_summaries")
        .update({ posted_to_slack: true, slack_message_ts: slackData.ts })
        .eq("thread_id", threadId);
    } else {
      // Leave posted_to_slack = false — Prompt 7 cron will retry
      console.error("[generate-summary] Slack post failed:", slackData.error);
    }
  } catch (err) {
    // Network error — same: leave posted_to_slack = false for cron retry
    console.error("[generate-summary] Slack post exception:", err);
  }
}
