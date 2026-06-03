/**
 * POST /api/figma-files/:id/sync
 * Syncs all comments for a Figma file.
 * Accepts user session OR cron secret.
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { fetchComments } from "@/lib/figma/sync";
import { classifyComment } from "@/lib/ai/classify";

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
  const fileKey: string = file.figma_file_key;
  const workspaceId: string = file.workspace_id;
  const projectId: string = (file.project as { id: string }).id;

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

    // 3. Get already-synced comment IDs
    const { data: existing } = await admin
      .from("figma_comments")
      .select("figma_comment_id")
      .eq("figma_file_id", figmaFileId);

    const existingIds = new Set((existing ?? []).map(c => c.figma_comment_id as string));

    // 4. Find new top-level comments
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
      return NextResponse.json({ added: 0, replies_added: 0, total: topLevel.length });
    }

    // 6. Insert new top-level comments + their feedback_items
    // Note: previews are fetched lazily via /api/feedback/:id/preview to avoid rate limits
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

      // AI classification
      const ai = await classifyComment(comment.message);

      // Insert feedback_item with AI data
      await admin.from("feedback_items").insert({
        figma_comment_id: (newComment as { id: string }).id,
        workspace_id: workspaceId,
        project_id: projectId,
        status: "open",
        priority: ai?.priority ?? "medium",
        ai_summary: ai?.summary ?? null,
        ai_classification: ai?.classification ?? null,
        ai_confidence: ai?.confidence ?? null,
        ai_key_question: ai?.key_question ?? null,
        ai_tags: ai?.tags ?? null,
        ai_risk_flag: ai?.risk_flag ?? false,
        ai_vague_flag: ai?.vague_flag ?? false,
        ai_vague_reason: ai?.vague_reason ?? null,
        figma_node_id: nodeId,
        figma_preview_url: previewUrl,
        ...(designReferenceId ? { design_reference_id: designReferenceId } : {}),
      });

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

    // 9. Fire background preview generation — only if new design_references were created.
    // Avoids triggering concurrent enrich-previews workers when no new preview work exists.
    // Existing pending/failed records are handled by the next scheduled cron/sync cycle.
    if (newDrCount > 0) {
      console.log(`[sync] ${newDrCount} new DR(s) — triggering background enrich`);
      fireBackgroundEnrich(appUrl, cronSecret ?? "", workspaceId);
    }

    return NextResponse.json({ added, replies_added: repliesAdded, total: topLevel.length });

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

