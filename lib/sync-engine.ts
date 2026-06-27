import { createAdminClient } from "@/lib/supabase/server";
import { classifyThread }  from "@/lib/classify";
import { generateSummary } from "@/lib/generate-summary";

// ── Types ─────────────────────────────────────────────────────────────────────

export type SyncEventType = "created" | "edited" | "resolved" | "reopened" | "deleted";
export type SyncSource    = "slack" | "figma" | "jira" | "notion";

export interface SyncPayload {
  event_type:        SyncEventType;
  workspace_id:      string;
  source:            SyncSource;
  source_thread_id:  string;
  // created
  title?:            string;
  source_url?:       string;
  project_id?:       string;
  source_comment_id?: string;
  author_name?:      string;
  author_email?:     string;
  body?:             string;
  created_at?:       string;
  // edited needs: source_comment_id + body
  // deleted needs: source_comment_id
}

// ── Entry point ───────────────────────────────────────────────────────────────

export async function processSyncEvent(payload: SyncPayload): Promise<void> {
  try {
    switch (payload.event_type) {
      case "created":  return await handleCreated(payload);
      case "edited":   return await handleEdited(payload);
      case "resolved": return await handleResolved(payload);
      case "reopened": return await handleReopened(payload);
      case "deleted":  return await handleDeleted(payload);
    }
  } catch (err) {
    console.error(`[sync-engine] ${payload.event_type} error:`, err);
  }
}

// ── State machine handlers ────────────────────────────────────────────────────

async function handleCreated(p: SyncPayload) {
  if (!p.source_comment_id || !p.body) return;

  const admin = createAdminClient();
  const now   = new Date().toISOString();

  // Upsert thread — UNIQUE(workspace_id, source, source_thread_id)
  const { data: thread, error: threadErr } = await admin
    .from("threads")
    .upsert(
      {
        workspace_id:     p.workspace_id,
        source:           p.source,
        source_thread_id: p.source_thread_id,
        title:            p.title      ?? null,
        source_url:       p.source_url ?? null,
        project_id:       p.project_id ?? null,
        status:           "open",
        updated_at:       now,
      },
      { onConflict: "workspace_id,source,source_thread_id", ignoreDuplicates: false }
    )
    .select("id")
    .single();

  if (threadErr || !thread) {
    console.error("[sync-engine] thread upsert error:", threadErr?.message);
    return;
  }

  const threadId = (thread as any).id as string;

  // Sequence order = current comment count
  const { count } = await admin
    .from("comments")
    .select("id", { count: "exact", head: true })
    .eq("thread_id", threadId);

  // Idempotent insert — UNIQUE(thread_id, source_comment_id)
  await admin
    .from("comments")
    .upsert(
      {
        thread_id:         threadId,
        source_comment_id: p.source_comment_id,
        author_name:       p.author_name  ?? null,
        author_email:      p.author_email ?? null,
        body:              p.body,
        sequence_order:    count ?? 0,
        created_at:        p.created_at ?? now,
      },
      { onConflict: "thread_id,source_comment_id", ignoreDuplicates: true }
    );

  // Classify after insert — non-blocking on the webhook response
  void classifyThread(threadId)
    .then(async (result) => {
      if (!result) return;
      if (result.classification === "blocker") {
        await notifyBlocker(threadId, p.workspace_id, p.project_id ?? null, result.blockers).catch(() => {});
      }
      if (result.is_vague) {
        await requestClarification(
          threadId, p.workspace_id, p.project_id ?? null,
          p.author_name ?? null, result.vague_reason
        ).catch(() => {});
      }
    })
    .catch(err => console.error("[sync-engine] classify error:", err));
}

async function handleEdited(p: SyncPayload) {
  if (!p.source_comment_id || !p.body) return;

  const admin = createAdminClient();
  const thread = await findThread(p);
  if (!thread) return;

  await admin
    .from("comments")
    .update({ body: p.body, edited_at: new Date().toISOString() })
    .eq("thread_id", thread.id)
    .eq("source_comment_id", p.source_comment_id)
    .is("deleted_at", null);

  await admin
    .from("threads")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", thread.id);

  // Re-classify — confidence may improve
  void classifyThread(thread.id).catch(err =>
    console.error("[sync-engine] re-classify error:", err)
  );
}

async function handleResolved(p: SyncPayload) {
  const admin  = createAdminClient();
  const thread = await findThread(p);
  if (!thread) return;

  const now = new Date().toISOString();
  await admin
    .from("threads")
    .update({ status: "resolved", resolved_at: now, updated_at: now })
    .eq("id", thread.id);

  void generateSummary(thread.id).catch(err =>
    console.error("[sync-engine] generateSummary error:", err)
  );
}

async function handleReopened(p: SyncPayload) {
  const admin  = createAdminClient();
  const thread = await findThread(p, "id, workspace_id, project_id, source, title");
  if (!thread) return;

  await admin
    .from("threads")
    .update({ status: "reopened", resolved_at: null, updated_at: new Date().toISOString() })
    .eq("id", thread.id);

  void notifyReopened(
    p.workspace_id,
    (thread as any).project_id ?? null,
    p.source,
    (thread as any).title ?? null,
    p.source_url ?? null
  ).catch(err => console.error("[sync-engine] reopen notify error:", err));
}

async function handleDeleted(p: SyncPayload) {
  if (!p.source_comment_id) return;

  const admin  = createAdminClient();
  const thread = await findThread(p);
  if (!thread) return;

  // Soft delete only — never hard delete
  await admin
    .from("comments")
    .update({ deleted_at: new Date().toISOString() })
    .eq("thread_id", thread.id)
    .eq("source_comment_id", p.source_comment_id)
    .is("deleted_at", null);
}

// ── Shared helpers ────────────────────────────────────────────────────────────

async function findThread(p: SyncPayload, select = "id") {
  const admin = createAdminClient();
  const { data } = await admin
    .from("threads")
    .select(select)
    .eq("workspace_id", p.workspace_id)
    .eq("source", p.source)
    .eq("source_thread_id", p.source_thread_id)
    .maybeSingle();
  return data as any;
}

async function getSlackChannel(workspaceId: string, projectId: string | null) {
  const admin = createAdminClient();
  const { data: ws } = await admin
    .from("workspaces")
    .select("slack_bot_token, slack_channel_id")
    .eq("id", workspaceId)
    .maybeSingle();

  const workspace = ws as any;
  if (!workspace?.slack_bot_token) return null;

  let channelId = workspace.slack_channel_id as string | null;
  if (projectId) {
    const { data: proj } = await admin
      .from("projects")
      .select("slack_channel_id")
      .eq("id", projectId)
      .maybeSingle();
    if ((proj as any)?.slack_channel_id) channelId = (proj as any).slack_channel_id;
  }

  return channelId ? { token: workspace.slack_bot_token as string, channelId } : null;
}

async function postSlack(token: string, channel: string, text: string, blocks?: any[]) {
  const body: Record<string, unknown> = { channel, text, unfurl_links: false };
  if (blocks) body.blocks = blocks;
  await fetch("https://slack.com/api/chat.postMessage", {
    method:  "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body:    JSON.stringify(body),
  });
}

// ── Slack notifications ───────────────────────────────────────────────────────

async function notifyBlocker(
  threadId:    string,
  workspaceId: string,
  projectId:   string | null,
  blockers:    string[]
) {
  const creds = await getSlackChannel(workspaceId, projectId);
  if (!creds) return;

  const who = blockers.length ? blockers.join(", ") : "unknown";
  await postSlack(
    creds.token,
    creds.channelId,
    `⛔ *Blocker detected* — held by ${who}. <${process.env.APP_URL ?? "https://getloupe.vercel.app"}/threads/${threadId}|View context →>`
  );
}

async function requestClarification(
  threadId:    string,
  workspaceId: string,
  projectId:   string | null,
  authorName:  string | null,
  vagueReason: string | null
) {
  const creds = await getSlackChannel(workspaceId, projectId);
  if (!creds) return;

  const appUrl = process.env.APP_URL ?? "https://getloupe.vercel.app";
  const at     = authorName  ? `*${authorName}* — ` : "";
  const reason = vagueReason ? `\n_${vagueReason}_` : "";

  await postSlack(
    creds.token,
    creds.channelId,
    `👋 ${at}Memry flagged a comment as unclear${reason.replace(/\n_/, " (")}${reason ? ")" : ""}. Could you clarify?`,
    [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `👋 ${at}Memry flagged a comment as unclear${reason}\nCould you add more context so this decision can be captured properly?`,
        },
      },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: "View thread" },
            url: `${appUrl}/threads/${threadId}`,
            action_id: "view_thread",
          },
          {
            type: "button",
            text: { type: "plain_text", text: "Mark as clear ✓" },
            value: threadId,
            action_id: "mark_clear",
            style: "primary",
          },
        ],
      },
    ]
  );
}

async function notifyReopened(
  workspaceId: string,
  projectId:   string | null,
  source:      string,
  title:       string | null,
  sourceUrl:   string | null
) {
  const creds = await getSlackChannel(workspaceId, projectId);
  if (!creds) return;

  const label  = source.charAt(0).toUpperCase() + source.slice(1);
  const titleT = title     ? ` — "${title}"`                        : "";
  const linkT  = sourceUrl ? `  <${sourceUrl}|View in ${label}>` : "";
  await postSlack(
    creds.token,
    creds.channelId,
    `🔄 *${label} thread reopened*${titleT}${linkT}`
  );
}
