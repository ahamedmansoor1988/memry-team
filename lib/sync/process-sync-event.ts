/**
 * Adapter layer between webhook handlers and the sync engine.
 *
 * Webhook handlers (app/api/webhooks/*) write the raw payload to sync_events,
 * then call processSyncEvent(syncEventId) here. This module:
 *   1. Reads the sync_events row by ID.
 *   2. Runs a per-source normaliser to build a typed SyncEvent.
 *   3. Delegates to the engine in lib/sync-engine.ts for all business logic.
 *
 * No business logic lives here — this is pure normalisation glue.
 */
import { createAdminClient } from "@/lib/supabase/server";
import {
  processSyncEvent as engineProcess,
  type SyncEvent,
} from "@/lib/sync-engine";

interface SyncEventRow {
  id:               string;
  workspace_id:     string;
  source:           string;
  event_type:       string;
  source_thread_id: string;
  raw_payload:      Record<string, unknown>;
}

export async function processSyncEvent(syncEventId: string): Promise<void> {
  const admin = createAdminClient();
  const { data: row } = await admin
    .from("sync_events")
    .select("id, workspace_id, source, event_type, source_thread_id, raw_payload")
    .eq("id", syncEventId)
    .single();

  if (!row) return;
  const dbEvent = row as SyncEventRow;

  let syncEvent: SyncEvent | null = null;

  if (dbEvent.source === "figma")  syncEvent = normalizeFigma(dbEvent);
  if (dbEvent.source === "slack")  syncEvent = normalizeSlack(dbEvent);
  if (dbEvent.source === "jira")   syncEvent = normalizeJira(dbEvent);
  if (dbEvent.source === "notion") syncEvent = normalizeNotion(dbEvent);

  if (!syncEvent) {
    // Unrecognised source or event — stamp as processed with a note
    await admin.from("sync_events")
      .update({
        processed_at: new Date().toISOString(),
        error:        `No normaliser for source="${dbEvent.source}" event_type="${dbEvent.event_type}"`,
      })
      .eq("id", syncEventId);
    return;
  }

  await engineProcess(syncEvent);
}

// ── Figma normaliser ──────────────────────────────────────────────────────────
// Figma payloads: FILE_COMMENT (created) | COMMENT_RESOLVED (resolved)

function normalizeFigma(row: SyncEventRow): SyncEvent | null {
  const p        = row.raw_payload;
  const comments = (p.comment as Array<Record<string, unknown>>) ?? [];
  const comment  = comments[0] ?? {};
  const user     = (comment.user as Record<string, string>) ?? {};

  const commentId = (comment.id        as string) ?? "";
  const parentId  = (comment.parent_id as string | null) ?? null;
  const fileKey   = (p.file_key        as string) ?? "";

  // Thread identity = file_key:root_comment_id (parent_id is null for root comments)
  const rootId         = parentId ?? commentId;
  const sourceThreadId = `${fileKey}:${rootId}`;

  const base = {
    id:               row.id,
    workspace_id:     row.workspace_id,
    source:           "figma" as const,
    source_thread_id: sourceThreadId,
  };

  if (row.event_type === "created") {
    return {
      ...base,
      event_type:        "created",
      source_comment_id: commentId,
      body:              (comment.message    as string) ?? "",
      author_name:       user.name           ?? null,
      author_email:      user.email          ?? null,
      author_source_id:  user.id             ?? null,
      created_at:        (comment.created_at as string) ?? null,
      thread_title:      (p.file_name        as string) ?? null,
      source_url:        fileKey ? `https://www.figma.com/file/${fileKey}` : null,
    };
  }

  if (row.event_type === "resolved") {
    return {
      ...base,
      event_type:  "resolved",
      resolved_by: user.name ?? null,
    };
  }

  return null;
}

// ── Slack normaliser ──────────────────────────────────────────────────────────
// Slack payloads: full event_callback envelope.
// source_thread_id = channel:thread_ts|ts — groups replies under their thread root.

function normalizeSlack(row: SyncEventRow): SyncEvent | null {
  const p          = row.raw_payload;
  const slackEvent = (p.event as Record<string, unknown>) ?? p;
  const subtype    = (slackEvent.subtype as string | null) ?? null;
  const channelId  = (slackEvent.channel as string) ?? "";

  let messageTs:  string;
  let text:       string;
  let userId:     string;
  let threadTs:   string | null;
  let editedAt:   string | null = null;

  if (subtype === "message_changed") {
    const msg    = (slackEvent.message as Record<string, unknown>) ?? {};
    const edited = (msg.edited as Record<string, string>) ?? {};
    messageTs = (msg.ts   as string) ?? "";
    text      = (msg.text as string) ?? "";
    userId    = (msg.user as string) ?? (slackEvent.user as string) ?? "";
    threadTs  = (msg.thread_ts as string | null) ?? null;
    editedAt  = edited.ts
      ? new Date(parseFloat(edited.ts) * 1000).toISOString()
      : new Date().toISOString();
  } else if (subtype === "message_deleted") {
    messageTs = (slackEvent.deleted_ts as string) ?? (slackEvent.ts as string) ?? "";
    text      = "";
    userId    = (slackEvent.user as string) ?? "";
    threadTs  = null;
  } else {
    messageTs = (slackEvent.ts        as string) ?? "";
    text      = (slackEvent.text      as string) ?? "";
    userId    = (slackEvent.user      as string) ?? "";
    threadTs  = (slackEvent.thread_ts as string | null) ?? null;
  }

  const sourceThreadId = `${channelId}:${threadTs ?? messageTs}`;

  const base = {
    id:               row.id,
    workspace_id:     row.workspace_id,
    source:           "slack" as const,
    source_thread_id: sourceThreadId,
  };

  const sourceUrl = channelId && messageTs
    ? `https://slack.com/archives/${channelId}/p${messageTs.replace(".", "")}`
    : null;

  if (row.event_type === "created") {
    return {
      ...base,
      event_type:        "created",
      source_comment_id: messageTs,
      body:              text,
      author_source_id:  userId || null,
      source_url:        sourceUrl,
    };
  }

  if (row.event_type === "edited" && editedAt) {
    return {
      ...base,
      event_type:        "edited",
      source_comment_id: messageTs,
      body:              text,
    };
  }

  if (row.event_type === "deleted") {
    return {
      ...base,
      event_type:        "deleted",
      source_comment_id: messageTs,
    };
  }

  return null;
}

// ── Jira normaliser ───────────────────────────────────────────────────────────
// Thread = Jira issue. source_thread_id = issue key (already set by the handler).

function normalizeJira(row: SyncEventRow): SyncEvent | null {
  const p       = row.raw_payload;
  const issue   = (p.issue   as Record<string, unknown>) ?? {};
  const comment = (p.comment as Record<string, unknown>) ?? {};
  const fields  = (issue.fields as Record<string, unknown>) ?? {};
  const author  = (comment.author as Record<string, string>) ?? {};

  const commentId    = (comment.id       as string) ?? "";
  const commentBody  = (comment.body     as string) ?? "";
  const issueSummary = (fields.summary   as string) ?? null;
  const issueKey     = row.source_thread_id;

  const base = {
    id:               row.id,
    workspace_id:     row.workspace_id,
    source:           "jira" as const,
    source_thread_id: issueKey,
  };

  const sourceUrl = `https://jira.atlassian.net/browse/${issueKey}`;

  if (row.event_type === "created") {
    return {
      ...base,
      event_type:        "created",
      source_comment_id: commentId,
      body:              commentBody,
      author_name:       author.displayName  ?? null,
      author_email:      author.emailAddress ?? null,
      author_source_id:  author.accountId    ?? null,
      created_at:        (comment.created    as string) ?? null,
      thread_title:      issueSummary,
      source_url:        sourceUrl,
    };
  }

  if (row.event_type === "edited") {
    return {
      ...base,
      event_type:        "edited",
      source_comment_id: commentId,
      body:              commentBody,
    };
  }

  if (row.event_type === "deleted") {
    return { ...base, event_type: "deleted", source_comment_id: commentId };
  }

  if (row.event_type === "resolved") {
    return { ...base, event_type: "resolved", source_url: sourceUrl };
  }

  if (row.event_type === "reopened") {
    return { ...base, event_type: "reopened", thread_title: issueSummary, source_url: sourceUrl };
  }

  return null;
}

// ── Notion normaliser ─────────────────────────────────────────────────────────
// Thread = Notion page. source_thread_id = page_id (already set by the handler).

function normalizeNotion(row: SyncEventRow): SyncEvent | null {
  const p      = row.raw_payload;
  const data   = (p.data   as Record<string, unknown>) ?? {};
  const entity = (p.entity as Record<string, unknown>) ?? {};

  const commentId  = (entity.id as string) ?? "";
  const richText   = (data.rich_text as Array<{ plain_text?: string }>) ?? [];
  const body       = richText.map(t => t.plain_text ?? "").join("").trim();
  const createdBy  = (data.created_by as Record<string, unknown>) ?? {};
  const person     = (createdBy.person as Record<string, string>) ?? {};
  const pageId     = row.source_thread_id;

  // Extract page title from page.updated events (structure varies)
  const pageTitle =
    (p.title as string) ??
    ((p.properties as Record<string, Record<string, Array<{ plain_text?: string }>>> | undefined)
      ?.Name?.title?.[0]?.plain_text) ?? null;

  const base = {
    id:               row.id,
    workspace_id:     row.workspace_id,
    source:           "notion" as const,
    source_thread_id: pageId,
    source_url:       `https://www.notion.so/${pageId.replace(/-/g, "")}`,
  };

  if (row.event_type === "created") {
    if (!body) return null;
    return {
      ...base,
      event_type:        "created",
      source_comment_id: commentId,
      body,
      author_name:       (createdBy.name as string) ?? null,
      author_email:      person.email               ?? null,
      author_source_id:  (createdBy.id   as string) ?? null,
      created_at:        (data.created_time as string) ?? null,
    };
  }

  if (row.event_type === "deleted") {
    return { ...base, event_type: "deleted", source_comment_id: commentId };
  }

  if (row.event_type === "edited") {
    // page.updated — treated as a thread metadata edit (title refresh), not a comment edit
    return {
      ...base,
      event_type:   "reopened",  // reuse reopened to refresh title without changing status
      thread_title: pageTitle,
    };
  }

  return null;
}
