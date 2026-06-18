/**
 * sync-engine.ts — central event processor for the ambient sync pipeline.
 *
 * processSyncEvent(event: SyncEvent) is the single entry point for all incoming
 * webhook events regardless of source tool (Figma / Slack / Jira / Notion).
 *
 * Callers are responsible for:
 *   1. Verifying the webhook signature.
 *   2. Writing the raw payload to sync_events.
 *   3. Normalising the source-specific payload into a SyncEvent and calling here.
 *
 * This function:
 *   • Is idempotent — re-processing the same event produces the same DB state.
 *   • Stamps sync_events.processed_at on success, .error on failure.
 *   • Never hard-deletes data (deleted_at soft-delete only).
 */
import { createAdminClient } from "@/lib/supabase/server";
import { classifyComment } from "@/lib/ai/classify";
import { generateThreadSummary } from "@/lib/sync/generate-summary";

type AdminClient = ReturnType<typeof createAdminClient>;

// ── SyncEvent discriminated union ─────────────────────────────────────────────

type SyncEventBase = {
  /** sync_events.id — used to stamp processed_at / error when done. */
  id:               string;
  workspace_id:     string;
  source:           "figma" | "slack" | "jira" | "notion";
  source_thread_id: string;
};

export type SyncEventCreated = SyncEventBase & {
  event_type:        "created";
  source_comment_id: string;
  body:              string;
  author_name?:      string | null;
  author_email?:     string | null;
  author_source_id?: string | null;
  created_at?:       string | null;
  thread_title?:     string | null;
  source_url?:       string | null;
  project_id?:       string | null;
};

export type SyncEventEdited = SyncEventBase & {
  event_type:        "edited";
  source_comment_id: string;
  body:              string;
};

export type SyncEventResolved = SyncEventBase & {
  event_type:  "resolved";
  resolved_by?: string | null;
};

export type SyncEventReopened = SyncEventBase & {
  event_type:    "reopened";
  thread_title?: string | null;
  source_url?:   string | null;
};

export type SyncEventDeleted = SyncEventBase & {
  event_type:        "deleted";
  source_comment_id: string;
};

export type SyncEvent =
  | SyncEventCreated
  | SyncEventEdited
  | SyncEventResolved
  | SyncEventReopened
  | SyncEventDeleted;

// ── Public entry point ────────────────────────────────────────────────────────

export async function processSyncEvent(event: SyncEvent): Promise<void> {
  const admin = createAdminClient();

  try {
    switch (event.event_type) {
      case "created":   await handleCreated(admin, event);   break;
      case "edited":    await handleEdited(admin, event);    break;
      case "resolved":  await handleResolved(admin, event);  break;
      case "reopened":  await handleReopened(admin, event);  break;
      case "deleted":   await handleDeleted(admin, event);   break;
    }

    await admin.from("sync_events")
      .update({ processed_at: new Date().toISOString(), error: null })
      .eq("id", event.id);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[sync-engine] error processing event ${event.id}:`, message);
    // Best-effort error stamp — don't throw again so the webhook handler still returns 200
    await admin.from("sync_events")
      .update({ error: message })
      .eq("id", event.id)
      .catch(() => null);
  }
}

// ── Handlers ──────────────────────────────────────────────────────────────────

/**
 * created — upsert thread → idempotent insert comment → classify if new thread.
 *
 * Idempotency: source_comment_id is the unique key inside a thread. If this
 * (thread_id, source_comment_id) pair already exists, the insert is a no-op.
 */
async function handleCreated(admin: AdminClient, event: SyncEventCreated): Promise<void> {
  // 1. Check whether the thread already exists before upserting — we need to know
  //    if this is the very first comment so we can trigger classification.
  const { data: existingThread } = await admin
    .from("comment_threads")
    .select("id, ai_classification")
    .eq("workspace_id", event.workspace_id)
    .eq("source", event.source)
    .eq("source_thread_id", event.source_thread_id)
    .maybeSingle();

  const isNewThread = !existingThread;

  // 2. Upsert thread — creates on first event, updates title/url on subsequent ones.
  const { data: threadRow, error: threadErr } = await admin
    .from("comment_threads")
    .upsert({
      workspace_id:     event.workspace_id,
      project_id:       event.project_id    ?? null,
      source:           event.source,
      source_thread_id: event.source_thread_id,
      source_url:       event.source_url    ?? null,
      title:            event.thread_title  ?? null,
      status:           "open",
      updated_at:       new Date().toISOString(),
    }, { onConflict: "workspace_id,source,source_thread_id", ignoreDuplicates: false })
    .select("id")
    .single();

  if (threadErr || !threadRow) {
    throw new Error(`comment_threads upsert failed: ${threadErr?.message ?? "no row returned"}`);
  }

  const threadId = (threadRow as { id: string }).id;

  // 3. Idempotent comment insert — skip if (thread_id, source_comment_id) already exists.
  const { data: existingComment } = await admin
    .from("thread_comments")
    .select("id")
    .eq("thread_id", threadId)
    .eq("source_comment_id", event.source_comment_id)
    .maybeSingle();

  if (!existingComment) {
    // Derive sequence_order from current comment count
    const { count } = await admin
      .from("thread_comments")
      .select("id", { count: "exact", head: true })
      .eq("thread_id", threadId);

    const { error: commentErr } = await admin.from("thread_comments").insert({
      thread_id:         threadId,
      source_comment_id: event.source_comment_id,
      author_name:       event.author_name       ?? null,
      author_email:      event.author_email      ?? null,
      author_source_id:  event.author_source_id  ?? null,
      body:              event.body,
      created_at:        event.created_at        ?? new Date().toISOString(),
      sequence_order:    count ?? 0,
    });

    if (commentErr) {
      throw new Error(`thread_comments insert failed: ${commentErr.message}`);
    }
  }

  // 4. Classify only on the first comment of a brand-new thread.
  //    If we already have a classification (e.g. from a replay), skip.
  if (isNewThread && event.body.trim()) {
    await classifyThread(admin, threadId, event.body, event.created_at ?? undefined);
  }
}

/**
 * edited — update body + edited_at on the matching thread_comments row.
 * No new row is ever created. If the comment row doesn't exist yet (rare race),
 * we silently skip so the caller can retry after the created event arrives.
 */
async function handleEdited(admin: AdminClient, event: SyncEventEdited): Promise<void> {
  const threadId = await requireThreadId(admin, event);
  if (!threadId) return;

  await admin
    .from("thread_comments")
    .update({
      body:      event.body,
      edited_at: new Date().toISOString(),
    })
    .eq("thread_id", threadId)
    .eq("source_comment_id", event.source_comment_id);
}

/**
 * resolved — mark thread resolved, trigger AI summary.
 * Idempotent: setting resolved_at/status twice is safe.
 */
async function handleResolved(admin: AdminClient, event: SyncEventResolved): Promise<void> {
  const threadId = await requireThreadId(admin, event);
  if (!threadId) return;

  await admin
    .from("comment_threads")
    .update({
      status:      "resolved",
      resolved_at: new Date().toISOString(),
      resolved_by: event.resolved_by ?? null,
      updated_at:  new Date().toISOString(),
    })
    .eq("id", threadId);

  // generateThreadSummary is implemented in Prompt 4.
  // Errors here are non-fatal — the thread is already marked resolved.
  generateThreadSummary(threadId).catch(err =>
    console.error(`[sync-engine] generateThreadSummary failed for ${threadId}:`, err),
  );
}

/**
 * reopened — clear resolution, restore open status, post Slack notification.
 * Idempotent: re-opening an already-open thread just re-sends the notification.
 */
async function handleReopened(admin: AdminClient, event: SyncEventReopened): Promise<void> {
  const threadId = await requireThreadId(admin, event);
  if (!threadId) return;

  await admin
    .from("comment_threads")
    .update({
      status:      "open",
      resolved_at: null,
      resolved_by: null,
      updated_at:  new Date().toISOString(),
    })
    .eq("id", threadId);

  // Post Slack notification if the workspace has a bot token + channel configured
  await notifySlackReopened(admin, event).catch(err =>
    console.warn("[sync-engine] Slack reopen notification failed (non-fatal):", err),
  );
}

/**
 * deleted — soft-delete the comment (never hard-delete).
 * If ALL comments in the thread are now deleted, mark the thread deleted too.
 */
async function handleDeleted(admin: AdminClient, event: SyncEventDeleted): Promise<void> {
  const threadId = await requireThreadId(admin, event);
  if (!threadId) return;

  // Soft-delete the specific comment
  await admin
    .from("thread_comments")
    .update({ deleted_at: new Date().toISOString() })
    .eq("thread_id", threadId)
    .eq("source_comment_id", event.source_comment_id);

  // If no active (non-deleted) comments remain, mark the thread deleted too
  const { count: activeCount } = await admin
    .from("thread_comments")
    .select("id", { count: "exact", head: true })
    .eq("thread_id", threadId)
    .is("deleted_at", null);

  if ((activeCount ?? 1) === 0) {
    await admin
      .from("comment_threads")
      .update({ status: "deleted", updated_at: new Date().toISOString() })
      .eq("id", threadId);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Look up a thread by (workspace, source, source_thread_id). Returns null if missing. */
async function requireThreadId(
  admin:    AdminClient,
  event:    SyncEventBase,
): Promise<string | null> {
  const { data } = await admin
    .from("comment_threads")
    .select("id")
    .eq("workspace_id", event.workspace_id)
    .eq("source", event.source)
    .eq("source_thread_id", event.source_thread_id)
    .maybeSingle();

  return (data as { id: string } | null)?.id ?? null;
}

/**
 * Run Groq classification on the first comment of a new thread.
 * Maps the existing classify output to the four engine-level categories:
 *   decision  ← "Needs Decision" | "Approved"
 *   blocker   ← "Blocked" | "Risk"
 *   question  ← "Vague"
 *   noise     ← "Info"
 *
 * If confidence is high enough, also seeds a thread_decisions row so the
 * thread shows up in the Memry inbox for human review.
 */
async function classifyThread(
  admin:     AdminClient,
  threadId:  string,
  body:      string,
  createdAt: string | undefined,
): Promise<void> {
  const result = await classifyComment(body, createdAt);
  if (!result) return;

  const CLASSIFICATION_MAP: Record<string, string> = {
    "Needs Decision": "decision",
    "Approved":       "decision",
    "Blocked":        "blocker",
    "Risk":           "blocker",
    "Vague":          "question",
    "Info":           "noise",
  };
  const aiClassification = CLASSIFICATION_MAP[result.classification] ?? "noise";

  await admin
    .from("comment_threads")
    .update({ ai_classification: aiClassification, ai_summary: result.summary })
    .eq("id", threadId);

  // If the thread looks like a decision and confidence is high, create a candidate
  // thread_decisions row so it surfaces in the inbox for human confirmation.
  if (aiClassification === "decision" && result.confidence >= 0.7) {
    await admin.from("thread_decisions").insert({
      thread_id:        threadId,
      decision_text:    result.key_question,
      rationale:        result.summary,
      confidence_score: result.confidence,
    }).then(null, err =>
      // Duplicate inserts on replay are benign — log and continue
      console.warn("[sync-engine] thread_decisions insert (may be duplicate):", err?.message),
    );
  }
}

const SOURCE_LABELS: Record<string, string> = {
  figma:  "Figma",
  slack:  "Slack",
  jira:   "Jira",
  notion: "Notion",
};

/** Post a plain-text Slack message when a thread is reopened. */
async function notifySlackReopened(
  admin: AdminClient,
  event: SyncEventReopened,
): Promise<void> {
  const { data: ws } = await admin
    .from("workspaces")
    .select("slack_bot_token, slack_channel_id")
    .eq("id", event.workspace_id)
    .maybeSingle();

  const token   = (ws as { slack_bot_token?: string | null; slack_channel_id?: string | null } | null)?.slack_bot_token;
  const channel = (ws as { slack_bot_token?: string | null; slack_channel_id?: string | null } | null)?.slack_channel_id;

  if (!token || !channel) return;

  const toolLabel = SOURCE_LABELS[event.source] ?? event.source;
  const title     = event.thread_title ?? event.source_thread_id;
  const linkText  = event.source_url ? ` — <${event.source_url}|View in ${toolLabel}>` : "";

  await fetch("https://slack.com/api/chat.postMessage", {
    method:  "POST",
    headers: {
      Authorization:  `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      channel,
      text:          `🔄 *${toolLabel} thread reopened:* ${title}${linkText}`,
      unfurl_links:  false,
    }),
  });
}
