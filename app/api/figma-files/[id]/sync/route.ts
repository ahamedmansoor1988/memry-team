/**
 * POST /api/figma-files/:id/sync
 * Syncs all comments for a Figma file.
 * Accepts user session OR cron secret.
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { fetchComments } from "@/lib/figma/sync";
import { classifyComment } from "@/lib/ai/classify";
import { resolveOwner, type OwnerProfile } from "@/lib/ai/resolve-owner";
import { linkUnprocessed } from "@/lib/linker/linker";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: figmaFileId } = await params;
  const admin = createAdminClient();

  // Auth: user session OR cron secret
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization");
  const isCron = cronSecret && authHeader === `Bearer ${cronSecret}`;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://memry-team-opal.vercel.app";

  if (!isCron) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Load file
  const { data: file } = await admin
    .from("figma_files")
    .select("*, project:projects(id, name, workspace_id)")
    .eq("id", figmaFileId)
    .single();

  if (!file) return NextResponse.json({ error: "File not found" }, { status: 404 });

  // Always use workspace PAT — figma_files.figma_pat may be stale/revoked
  const { data: ws } = await admin
    .from("workspaces")
    .select("figma_pat")
    .eq("id", file.workspace_id)
    .single();

  const pat: string | null = (ws as { figma_pat?: string } | null)?.figma_pat ?? file.figma_pat ?? null;
  if (!pat) return NextResponse.json({ error: "No PAT configured" }, { status: 400 });

  const fileKey: string     = file.figma_file_key;
  const workspaceId: string = file.workspace_id;
  const projectId: string   = (file.project as { id: string }).id;

  // Load Slack credentials from workspace (non-fatal if missing)
  const { data: wsSlack } = await admin
    .from("workspaces")
    .select("slack_bot_token, slack_channel_id")
    .eq("id", workspaceId)
    .single();
  const slackToken   = (wsSlack as { slack_bot_token?: string | null } | null)?.slack_bot_token   ?? "";
  const slackChannel = (wsSlack as { slack_channel_id?: string | null } | null)?.slack_channel_id ?? "";

  // Mark syncing
  await admin.from("figma_files").update({ sync_status: "syncing" }).eq("id", figmaFileId);

  try {
    // 1. Fetch all comments from Figma
    const allComments = await fetchComments(fileKey, pat);
    console.log(`[sync] file=${figmaFileId} total=${allComments.length} comments`);

    // 2. Split top-level vs replies
    // Top-level: parent_id is "" (empty string)
    // Replies:   parent_id = figma comment ID of the parent (NOT order_id)
    const topLevel = allComments.filter(c => !c.parent_id);
    const replies = allComments.filter(c => !!c.parent_id);

    // 3. Get already-synced comment IDs (include id + parent for deletion detection)
    const { data: existing } = await admin
      .from("figma_comments")
      .select("id, figma_comment_id, parent_figma_comment_id, deleted_at")
      .eq("figma_file_id", figmaFileId);

    type ExistingRow = {
      id: string;
      figma_comment_id: string;
      parent_figma_comment_id: string | null;
      deleted_at: string | null;
    };
    const existingRows = (existing ?? []) as ExistingRow[];
    const existingIds = new Set(existingRows.map(r => r.figma_comment_id));

    // 4. Deletion detection — soft-delete rows that no longer exist in Figma.
    // Runs on every sync, before the early-return, so detection fires even when
    // there are no new comments to insert.
    const figmaLiveIds = new Set(allComments.map(c => c.id));
    const liveRows = existingRows.filter(r => !r.deleted_at);
    const deletedCount = await softDeleteStale(admin, liveRows, figmaLiveIds, workspaceId);

    // 5. Find new top-level comments
    const newTopLevel = topLevel.filter(c => !existingIds.has(c.id));
    console.log(`[sync] new top-level comments: ${newTopLevel.length}`);

    if (newTopLevel.length === 0) {
      // Still sync new replies to existing threads
      await syncNewReplies(admin, replies, existingIds, figmaFileId, workspaceId);
      await admin.from("figma_files").update({
        sync_status: "idle",
        last_synced_at: new Date().toISOString(),
      }).eq("id", figmaFileId);
      // No new design_references created — skip enrich trigger.
      // Existing pending/failed records will be handled on the next cron/sync cycle.
      return NextResponse.json({ added: 0, replies_added: 0, total: topLevel.length, deleted: deletedCount });
    }

    // 6. Insert new top-level comments + their feedback_items
    // Note: previews are fetched lazily via /api/feedback/:id/preview to avoid rate limits

    // Pre-load workspace profiles once for owner resolution (non-fatal if missing)
    let workspaceProfiles: OwnerProfile[] = [];
    try {
      const { data: profileRows } = await admin
        .from("profiles")
        .select("id, display_name, figma_handle, slack_handle")
        .eq("workspace_id", workspaceId);
      workspaceProfiles = ((profileRows ?? []) as Array<{
        id: string;
        display_name: string;
        figma_handle: string | null;
        slack_handle: string | null;
      }>).map(r => ({
        id: r.id,
        display_name: r.display_name,
        figma_handle: r.figma_handle ?? "",
        slack_handle: r.slack_handle,
      }));
    } catch {
      // profiles table may not exist yet — continue without owner resolution
    }

    let added = 0;
    let newDrCount = 0; // track newly inserted design_references (vs. existing ones)
    for (const comment of newTopLevel) {
      const nodeId = comment.client_meta?.node_id ?? null;
      const previewUrl = null; // fetched lazily on first open

      // Insert comment
      const { data: newComment, error: commentErr } = await admin
        .from("figma_comments")
        .insert({
          figma_file_id: figmaFileId,
          workspace_id: workspaceId,
          figma_comment_id: comment.id,
          figma_order_id: comment.order_id,
          parent_figma_comment_id: null,
          author_name: comment.user.handle,
          author_avatar: comment.user.img_url,
          author_email: comment.user.email ?? null,
          raw_content: comment.message,
          figma_node_id: nodeId,
          figma_created_at: comment.created_at,
          resolved_at: comment.resolved_at ?? null,
        })
        .select()
        .single();

      if (commentErr || !newComment) {
        console.error("[sync] failed to insert comment", comment.id, commentErr);
        continue;
      }

      // Upsert design_reference so frame preview + name can be enriched later.
      // IMPORTANT: never overwrite preview_status when an existing row is "ready" —
      // otherwise every sync would reset a successfully-generated thumbnail back to "pending".
      let designReferenceId: string | null = null;
      if (nodeId) {
        try {
          const { data: existingDr } = await admin
            .from("design_references")
            .select("id, preview_status")
            .eq("workspace_id", workspaceId)
            .eq("file_key", fileKey)
            .eq("node_id", nodeId)
            .maybeSingle();

          if (existingDr) {
            // Row already exists — only touch updated_at, preserve preview_status
            designReferenceId = (existingDr as { id: string }).id;
            await admin
              .from("design_references")
              .update({ updated_at: new Date().toISOString() })
              .eq("id", designReferenceId);
          } else {
            // First time we've seen this node — insert with pending status
            const { data: newDr } = await admin
              .from("design_references")
              .insert({
                workspace_id: workspaceId,
                file_key: fileKey,
                node_id: nodeId,
                preview_status: "pending",
                updated_at: new Date().toISOString(),
              })
              .select("id")
              .single();
            if (newDr) {
              designReferenceId = (newDr as { id: string }).id;
              newDrCount++; // new pending DR created — enrichment needed
            }
          }
        } catch (e) {
          console.warn("[sync] design_references upsert failed:", e);
        }
      }

      // Best-effort: upsert the comment author as a profile so the team roster
      // stays current without a manual backfill.
      let authorProfileId: string | null = null;
      if (comment.user?.handle) {
        try {
          const profilePayload: Record<string, unknown> = {
            workspace_id: workspaceId,
            display_name: comment.user.handle,
            figma_handle: comment.user.handle,
            avatar_url: comment.user.img_url ?? null,
            updated_at: new Date().toISOString(),
          };
          if (comment.user.email) profilePayload.email = comment.user.email;

          const { data: profile } = await admin
            .from("profiles")
            .upsert(profilePayload, { onConflict: "workspace_id,figma_handle" })
            .select("id, slack_handle")
            .single();

          if (profile) {
            const p = profile as { id: string; slack_handle: string | null };
            authorProfileId = p.id;
            // Keep local profiles list warm so later comments in this batch can match
            if (!workspaceProfiles.find(pr => pr.id === p.id)) {
              workspaceProfiles.push({
                id: p.id,
                display_name: comment.user.handle,
                figma_handle: comment.user.handle,
                slack_handle: p.slack_handle,
              });
            }
          }
        } catch (e) {
          console.warn("[sync] profile upsert failed (non-fatal):", e);
        }
      }

      // AI classification
      const ai = await classifyComment(comment.message);

      // Owner resolution — run after AI classify so we have the full comment text.
      // Use empty replies array at insert time; replies arrive on subsequent syncs
      // and the owner can be updated then.
      const now = new Date().toISOString();
      let ownerName: string | null = null;
      let ownerProfileId: string | null = null;
      if (workspaceProfiles.length > 0) {
        try {
          const ownerResult = await resolveOwner(comment.message, [], workspaceProfiles);
          if (ownerResult.owner_name) {
            ownerName = ownerResult.owner_name;
            ownerProfileId = ownerResult.profile_id;
          }
        } catch {
          // Non-fatal
        }
      }

      // Insert feedback_item with AI data, owner, and accountability timestamps
      const { data: newFeedbackItem } = await admin.from("feedback_items").insert({
        figma_comment_id: (newComment as { id: string }).id,
        workspace_id: workspaceId,
        project_id: projectId,
        status: (ai?.classification === "Needs Decision" || ai?.classification === "Blocked")
          ? "needs_decision"
          : "open",
        priority: ai?.priority ?? "medium",
        ai_summary: ai?.summary ?? null,
        ai_classification: ai?.classification ?? null,
        ai_confidence: ai?.confidence ?? null,
        ai_key_question: ai?.key_question ?? null,
        ai_tags: ai?.tags ?? null,
        ai_risk_flag: ai?.risk_flag ?? false,
        ai_vague_flag: ai?.vague_flag ?? false,
        ai_vague_reason: ai?.vague_reason ?? null,
        ai_suggested_action: ai?.suggested_action ?? null,
        figma_node_id: nodeId,
        figma_preview_url: previewUrl,
        // Accountability timestamps — start the clock immediately at ingest time
        ...(ai?.classification === "Blocked"        ? { blocked_since: now } : {}),
        ...(ai?.classification === "Needs Decision" ? { waiting_since: now } : {}),
        // Owner (may be null — user can set manually)
        ...(ownerName      ? { owner_name: ownerName }           : {}),
        ...(ownerProfileId ? { owner_profile_id: ownerProfileId } : {}),
        ...(authorProfileId ? { author_profile_id: authorProfileId } : {}),
        ...(designReferenceId ? { design_reference_id: designReferenceId } : {}),
      }).select("id").single();
      const feedbackItemId = (newFeedbackItem as { id: string } | null)?.id ?? null;

      // Notify on new blocker
      if (ai?.classification === "Blocked" && feedbackItemId) {
        try {
          await admin.from("notifications").insert({
            type: "new_blocker",
            title: "New blocker detected",
            body: ai.key_question ?? ai.summary ?? null,
            feedback_item_id: feedbackItemId,
            workspace_id: workspaceId,
            ...(ownerProfileId ? { user_id: ownerProfileId } : {}),
          });
        } catch { /* non-fatal */ }
      }

      // Auto-post to Slack for actionable items
      if (slackToken && slackChannel && (ai?.classification === "Needs Decision" || ai?.classification === "Blocked")) {
        const { postCommentToSlack } = await import("@/lib/slack/bot");
        const figmaUrl = nodeId
          ? `https://www.figma.com/file/${fileKey}?node-id=${encodeURIComponent(nodeId)}`
          : `https://www.figma.com/file/${fileKey}`;
        postCommentToSlack({
          feedbackItemId: (newComment as { id: string }).id,
          comment: comment.message,
          authorName: comment.user?.handle ?? "Unknown",
          projectName: (file.project as { name: string }).name,
          fileName: file.name ?? "",
          pageName: null,
          classification: ai.classification,
          aiKeyQuestion: ai.key_question ?? null,
          figmaUrl,
          channel: slackChannel,
          itemId: feedbackItemId,
          projectId,
          authorSlackHandle: null,
        }, slackToken)
          .then(({ ts, channel: ch }) =>
            admin.from("feedback_items")
              .update({ slack_message_ts: ts, slack_channel_id: ch })
              .eq("figma_comment_id", (newComment as { id: string }).id)
          )
          .catch(e => console.warn("[sync] Slack post failed (non-fatal):", e));
      }

      // Insert replies for this new comment.
      // reply.parent_id = parent's comment ID (not order_id).
      const figmaCommentDbId = (newComment as { id: string }).id;
      const commentReplies = replies.filter(r => r.parent_id === comment.id);
      for (const reply of commentReplies) {
        if (!existingIds.has(reply.id)) {
          const { error: replyErr } = await admin.from("figma_comments").insert({
            figma_file_id: figmaFileId,
            workspace_id: workspaceId,
            figma_comment_id: reply.id,
            figma_order_id: reply.order_id,
            parent_figma_comment_id: figmaCommentDbId,  // DB uuid, not Figma ID
            author_name: reply.user.handle,
            author_avatar: reply.user.img_url,
            author_email: reply.user.email ?? null,
            raw_content: reply.message,
            figma_node_id: null,
            figma_created_at: reply.created_at,
            resolved_at: reply.resolved_at ?? null,
          });
          if (replyErr) console.error("[sync] failed reply insert", reply.id, replyErr);
          else existingIds.add(reply.id); // prevent syncNewReplies double-inserting
        }
      }

      added++;
    }

    // 7. Sync new replies to existing threads
    const repliesAdded = await syncNewReplies(admin, replies, existingIds, figmaFileId, workspaceId);

    // 8. Mark idle — also refresh figma_pat so stale token never re-appears
    await admin.from("figma_files").update({
      sync_status: "idle",
      last_synced_at: new Date().toISOString(),
      figma_pat: pat,
    }).eq("id", figmaFileId);

    // 9. Fire background preview generation after every sync.
    // The enrich route exits early if no pending/failed DRs exist, so this is safe
    // to call unconditionally — it covers both new DRs and pre-existing pending ones.
    if (cronSecret) {
      console.log(`[sync] triggering background enrich (${newDrCount} new DR(s))`);
      fireBackgroundEnrich(appUrl, cronSecret, workspaceId);
    }

    // Linker Agent: connect newly captured items to related discussions.
    // Small batch, best-effort — the backfill endpoint covers anything missed.
    if (added > 0 && process.env.OPENAI_API_KEY) {
      try {
        const linked = await linkUnprocessed(workspaceId, 10);
        if (linked.auto_linked > 0 || linked.suggested > 0) {
          console.log(`[linker] sync pass: ${linked.auto_linked} linked, ${linked.suggested} suggested`);
        }
      } catch (e) {
        console.error("[linker] post-sync pass failed:", e instanceof Error ? e.message : e);
      }
    }

    return NextResponse.json({ added, replies_added: repliesAdded, total: topLevel.length, deleted: deletedCount });

  } catch (e) {
    const msg = e instanceof Error ? e.message : "Sync failed";
    const isRateLimit = msg.includes("429") || msg.toLowerCase().includes("rate limit");
    // 429 = retryable — reset to idle so next sync can pick it up
    const nextStatus = isRateLimit ? "idle" : "error";
    console.error(`[sync] ${isRateLimit ? "rate-limited (reset to idle)" : "error"}`, msg);
    await admin.from("figma_files").update({ sync_status: nextStatus }).eq("id", figmaFileId);
    return NextResponse.json({ error: msg }, { status: isRateLimit ? 429 : 500 });
  }
}

/**
 * Fire-and-forget: trigger background preview enrichment for a single workspace.
 *
 * IMPORTANT: fetch() is called directly — NOT inside setTimeout.
 * setTimeout(0) queues a macrotask. In Vercel's Lambda runtime, the execution
 * context is frozen after the HTTP response is sent. The macrotask queue is
 * never drained, so setTimeout callbacks never fire. Calling fetch() synchronously
 * before the return establishes a pending TCP connection that keeps the Lambda
 * event loop alive until the request is delivered.
 *
 * Safe to call even when there is nothing to process — the enrich route exits
 * early after a single DB count query if no pending records are found.
 */
function fireBackgroundEnrich(appUrl: string, cronSecret: string, workspaceId: string): void {
  if (!cronSecret) return; // No secret configured — skip; manual button still works
  console.log(`[sync] firing background enrich for workspace=${workspaceId}`);
  fetch(`${appUrl}/api/figma/enrich-previews`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      authorization: `Bearer ${cronSecret}`,
    },
    body: JSON.stringify({ workspaceId }),
  }).catch(e => console.warn("[sync] background enrich-previews failed:", e));
}

async function syncNewReplies(
  admin: ReturnType<typeof createAdminClient>,
  replies: Awaited<ReturnType<typeof fetchComments>>,
  existingIds: Set<string>,
  figmaFileId: string,
  workspaceId: string
): Promise<number> {
  let count = 0;
  for (const reply of replies) {
    if (existingIds.has(reply.id)) continue;

    // Find parent comment in DB by its figma_comment_id (reply.parent_id = parent's comment ID)
    const { data: parent } = await admin
      .from("figma_comments")
      .select("id")
      .eq("figma_comment_id", reply.parent_id ?? "")
      .eq("figma_file_id", figmaFileId)
      .single();

    if (!parent) continue;

    await admin.from("figma_comments").insert({
      figma_file_id: figmaFileId,
      workspace_id: workspaceId,
      figma_comment_id: reply.id,
      figma_order_id: reply.order_id,
      parent_figma_comment_id: (parent as { id: string }).id,
      author_name: reply.user.handle,
      author_avatar: reply.user.img_url,
      author_email: reply.user.email ?? null,
      raw_content: reply.message,
      figma_node_id: null,
      figma_created_at: reply.created_at,
      resolved_at: reply.resolved_at ?? null,
    });
    count++;

    // Auto-reopen: if the parent feedback_item is "resolved", a new reply
    // from Figma means discussion has resumed — transition it back to "open".
    // Archived items are intentionally excluded from auto-reopen.
    try {
      const { data: feedbackItem } = await admin
        .from("feedback_items")
        .select("id, status")
        .eq("figma_comment_id", (parent as { id: string }).id)
        .maybeSingle();

      if (feedbackItem && (feedbackItem as { status: string }).status === "resolved") {
        const now = new Date().toISOString();
        await admin
          .from("feedback_items")
          .update({ status: "open", updated_at: now })
          .eq("id", (feedbackItem as { id: string }).id);

        // Best-effort history record (table exists after status_system migration)
        try {
          await admin
            .from("feedback_item_status_history")
            .insert({
              item_id: (feedbackItem as { id: string }).id,
              workspace_id: workspaceId,
              from_status: "resolved",
              to_status: "open",
              changed_by: null,
              reason: "New reply from Figma",
              created_at: now,
            });
        } catch {
          // history table may not exist yet
        }
      }
    } catch {
      // Non-fatal: auto-reopen failure should not break the sync
    }
  }
  return count;
}

// ─── Soft-delete detection ────────────────────────────────────────────────────

type SoftDeleteRow = {
  id: string;
  figma_comment_id: string;
  parent_figma_comment_id: string | null;
};

/**
 * For every row in liveRows whose figma_comment_id is absent from figmaLiveIds,
 * stamp deleted_at on the figma_comment, cascade to its replies, and mark the
 * linked feedback_item deleted. No AI data, Slack refs, or history is removed.
 *
 * Returns the number of top-level + standalone-reply rows marked deleted.
 */
async function softDeleteStale(
  admin: ReturnType<typeof createAdminClient>,
  liveRows: SoftDeleteRow[],
  figmaLiveIds: Set<string>,
  workspaceId: string,
): Promise<number> {
  const stale = liveRows.filter(r => !figmaLiveIds.has(r.figma_comment_id));
  if (stale.length === 0) return 0;

  const now = new Date().toISOString();

  const staleParents  = stale.filter(r => !r.parent_figma_comment_id);
  const staleReplies  = stale.filter(r =>  !!r.parent_figma_comment_id);

  // IDs of parents being deleted — used to exclude their replies from the
  // standalone-reply update (cascade handles those already).
  const staleParentDbIds = new Set(staleParents.map(p => p.id));

  for (const parent of staleParents) {
    // Mark the top-level comment deleted
    await admin
      .from("figma_comments")
      .update({ deleted_at: now })
      .eq("id", parent.id);

    // Cascade: mark all child replies deleted
    await admin
      .from("figma_comments")
      .update({ deleted_at: now })
      .eq("parent_figma_comment_id", parent.id)
      .is("deleted_at", null);

    // Mark the linked feedback_item deleted (preserves all AI + Slack columns)
    await admin
      .from("feedback_items")
      .update({ deleted_at: now, status: "deleted", updated_at: now })
      .eq("figma_comment_id", parent.id)
      .is("deleted_at", null);
  }

  // Mark standalone stale replies (parent is still live) deleted
  const standaloneReplies = staleReplies.filter(
    r => !staleParentDbIds.has(r.parent_figma_comment_id ?? ""),
  );
  if (standaloneReplies.length > 0) {
    await admin
      .from("figma_comments")
      .update({ deleted_at: now })
      .in("id", standaloneReplies.map(r => r.id))
      .is("deleted_at", null);
  }

  const count = staleParents.length + standaloneReplies.length;
  if (count > 0) {
    console.log(
      `[sync] soft-deleted ${count} stale item(s) ` +
      `(${staleParents.length} top-level, ${standaloneReplies.length} standalone replies) ` +
      `workspace=${workspaceId}`,
    );
  }
  return count;
}
