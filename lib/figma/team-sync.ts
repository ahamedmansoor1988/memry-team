/**
 * Team-based Figma sync — ported from the decode Chrome extension.
 *
 * Flow:
 *   PAT + Team ID
 *     → list all projects in team
 *     → list all files in each project
 *     → for each file: fetch comments + build threads
 *     → upsert into Supabase (figma_files, figma_comments, feedback_items)
 */

import { figmaHeaders } from "./api";
import { classifyComment } from "@/lib/ai/classify";
import { createAdminClient } from "@/lib/supabase/server";
import { postCommentToSlack } from "@/lib/slack/bot";

const FIGMA_API = "https://api.figma.com/v1";

// ─── Figma API shapes ─────────────────────────────────────────────────────────

interface FigmaProject { id: string; name: string }
interface FigmaFile    { key: string; name: string; last_modified?: string; thumbnail_url?: string }

interface FigmaApiComment {
  id: string;
  order_id: string;
  parent_id?: string | null;
  message: string;
  created_at: string;
  resolved_at: string | null;
  user?: { id?: string; handle?: string; img_url?: string | null; email?: string };
  client_meta?: { node_id?: string; node_offset?: { x: number; y: number } };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function figmaGet<T>(path: string, pat: string): Promise<T> {
  const res = await fetch(`${FIGMA_API}${path}`, { headers: figmaHeaders(pat) });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Figma API ${res.status} on ${path}: ${text.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

function detectMention(message: string, userId: string): boolean {
  if (!userId || !/^\d+$/.test(userId)) return false;
  return new RegExp(`/user/${userId}(?:\\D|$)`).test(message);
}

// ─── Public surface ───────────────────────────────────────────────────────────

export interface TeamFile {
  key: string;
  name: string;
  projectId: string;
  projectName: string;
  thumbnailUrl?: string;
}

export async function listTeamFiles(teamId: string, pat: string): Promise<TeamFile[]> {
  const team = await figmaGet<{ projects: FigmaProject[] }>(
    `/teams/${encodeURIComponent(teamId)}/projects`,
    pat,
  );
  const all: TeamFile[] = [];
  for (const project of team.projects ?? []) {
    try {
      const proj = await figmaGet<{ files: FigmaFile[] }>(
        `/projects/${project.id}/files`,
        pat,
      );
      for (const f of proj.files ?? []) {
        all.push({ key: f.key, name: f.name, projectId: project.id, projectName: project.name, thumbnailUrl: f.thumbnail_url });
      }
    } catch (e) {
      console.warn(`[team-sync] skipping project ${project.name}:`, e);
    }
  }
  return all;
}

export interface SyncFileResult {
  fileKey: string;
  fileName: string;
  added: number;
  repliesAdded: number;
  deleted: number;
  total: number;
  error?: string;
}

/**
 * Full team sync — discovers all files and syncs comments for each.
 * Returns per-file results.
 */
export async function syncTeam(
  workspaceId: string,
  teamId: string,
  pat: string,
  figmaUserId?: string | null,
): Promise<{ files: SyncFileResult[]; totalAdded: number }> {
  const admin = createAdminClient();
  const files = await listTeamFiles(teamId, pat);

  // Load Slack credentials once for the workspace — DB values take priority over env vars.
  // This ensures the Integrations page config is actually used.
  const { data: wsRow } = await admin
    .from("workspaces")
    .select("slack_bot_token, slack_channel_id")
    .eq("id", workspaceId)
    .maybeSingle();
  const slackToken   = (wsRow as { slack_bot_token?: string | null }   | null)?.slack_bot_token   ?? process.env.SLACK_BOT_TOKEN   ?? "";
  const slackChannel = (wsRow as { slack_channel_id?: string | null } | null)?.slack_channel_id ?? process.env.SLACK_CHANNEL_ID ?? "";

  const results: SyncFileResult[] = [];
  let totalAdded = 0;

  for (const file of files) {
    try {
      const result = await syncFile(admin, workspaceId, file, pat, figmaUserId ?? undefined, slackToken, slackChannel);
      results.push(result);
      totalAdded += result.added;
    } catch (e) {
      results.push({
        fileKey: file.key,
        fileName: file.name,
        added: 0,
        repliesAdded: 0,
        deleted: 0,
        total: 0,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return { files: results, totalAdded };
}

// ─── Per-file sync ────────────────────────────────────────────────────────────

async function syncFile(
  admin: ReturnType<typeof createAdminClient>,
  workspaceId: string,
  file: TeamFile,
  pat: string,
  figmaUserId?: string,
  slackToken: string = "",
  slackChannel: string = "",
): Promise<SyncFileResult> {
  // 1. Ensure figma_file record exists — upsert by file key + workspace
  const { data: existingFile } = await admin
    .from("figma_files")
    .select("id, project_id")
    .eq("figma_file_key", file.key)
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  let figmaFileId: string;
  let projectId: string;

  if (existingFile) {
    figmaFileId = existingFile.id as string;
    projectId = existingFile.project_id as string;
    // Always refresh the file name from Figma in case it changed
    await admin.from("figma_files").update({ name: file.name, figma_pat: pat }).eq("id", figmaFileId);
  } else {
    // Ensure project exists
    const pid = await ensureProject(admin, workspaceId, file.projectName);
    projectId = pid;

    const { data: newFile, error } = await admin
      .from("figma_files")
      .insert({
        workspace_id: workspaceId,
        project_id: projectId,
        name: file.name,
        figma_file_key: file.key,
        figma_pat: pat,
        sync_status: "idle",
      })
      .select("id")
      .single();

    if (error || !newFile) throw new Error(`Failed to create figma_file: ${error?.message}`);
    figmaFileId = (newFile as { id: string }).id;
  }

  // Also update project_id from file record if needed
  if (!projectId) {
    const pid = await ensureProject(admin, workspaceId, file.projectName);
    projectId = pid;
  }

  await admin.from("figma_files").update({ sync_status: "syncing" }).eq("id", figmaFileId);

  // 2. Fetch all comments from Figma
  const data = await figmaGet<{ comments?: FigmaApiComment[] }>(
    `/files/${file.key}/comments`,
    pat,
  );
  const allComments = data.comments ?? [];

  // Figma: parent_id is empty string "" for top-level, comment ID for replies
  const topLevel = allComments.filter(c => !c.parent_id);
  const replies   = allComments.filter(c => !!c.parent_id);
  console.log(`[team-sync] ${file.name}: ${allComments.length} total comments — ${topLevel.length} parents, ${replies.length} replies`);

  // NOTE: we intentionally do NOT fetch file structure (?depth=2) or node images
  // during sync. Those calls hammer the Figma rate limit (60 req/min per PAT).
  // Frame names, page names, and frame thumbnails are populated later by the
  // dedicated enrichment job: POST /api/figma/enrich-previews
  const nodeToPage = new Map<string, string>();
  const nodeToFrame = new Map<string, string>();

  // NOTE: No file thumbnail, no Images API call.
  // figma_preview_url starts as null and is populated ONLY by the enrichment job.
  // This ensures sync never shows wrong/file-level images in the UI.
  const fileThumbnailUrl: string | null = null;

  // 3. Get existing comment IDs
  const { data: existing } = await admin
    .from("figma_comments")
    .select("id, figma_comment_id, parent_figma_comment_id")
    .eq("figma_file_id", figmaFileId);

  const existingRows = existing ?? [];
  const existingIds = new Set(existingRows.map(c => c.figma_comment_id as string));

  // 3b. Delete comments that were removed from Figma
  const liveIds = new Set(allComments.map(c => c.id));
  const deletedRows = existingRows.filter(c => !liveIds.has(c.figma_comment_id as string));

  if (deletedRows.length > 0) {
    const deletedDbIds = deletedRows.map(c => c.id as string);
    // Delete feedback_items linked to top-level deleted comments
    const deletedTopLevelDbIds = deletedRows
      .filter(c => !c.parent_figma_comment_id)
      .map(c => c.id as string);
    if (deletedTopLevelDbIds.length > 0) {
      await admin.from("feedback_items").delete().in("figma_comment_id", deletedTopLevelDbIds);
    }
    // Delete the figma_comment rows (replies first to avoid FK issues)
    const deletedReplyDbIds = deletedRows
      .filter(c => !!c.parent_figma_comment_id)
      .map(c => c.id as string);
    if (deletedReplyDbIds.length > 0) {
      await admin.from("figma_comments").delete().in("id", deletedReplyDbIds);
    }
    const deletedTopIds = deletedRows
      .filter(c => !c.parent_figma_comment_id)
      .map(c => c.id as string);
    if (deletedTopIds.length > 0) {
      await admin.from("figma_comments").delete().in("id", deletedTopIds);
    }
    console.log(`[team-sync] deleted ${deletedDbIds.length} removed comments in ${file.name}`);
  }

  const newTopLevel = topLevel.filter(c => !existingIds.has(c.id));

  let added = 0;
  let repliesAdded = 0;
  const deleted = deletedRows.length;

  for (const comment of newTopLevel) {
    const mentionsMe = figmaUserId ? detectMention(comment.message, figmaUserId) : false;
    const nodeId = comment.client_meta?.node_id ?? null;
    const pageName = nodeId ? (nodeToPage.get(nodeId) ?? null) : null;
    const frameName = nodeId ? (nodeToFrame.get(nodeId) ?? null) : null;

    const { data: newComment, error: commentErr } = await admin
      .from("figma_comments")
      .insert({
        figma_file_id: figmaFileId,
        workspace_id: workspaceId,
        figma_comment_id: comment.id,
        figma_order_id: comment.order_id,
        parent_figma_comment_id: null,
        author_name: comment.user?.handle ?? null,
        author_avatar: comment.user?.img_url ?? null,
        author_email: comment.user?.email ?? null,
        raw_content: comment.message,
        figma_node_id: nodeId,
        figma_created_at: comment.created_at,
        resolved_at: comment.resolved_at ?? null,
        mentions_me: mentionsMe,
        project_name: file.projectName,
        ...(pageName ? { page_name: pageName } : {}),
        ...(frameName ? { frame_name: frameName } : {}),
      })
      .select("id")
      .single();

    if (commentErr || !newComment) {
      console.error("[team-sync] failed comment insert", comment.id, commentErr);
      continue;
    }

    const figmaCommentDbId = (newComment as { id: string }).id;

    // Upsert design_reference — thumbnail fetching happens later via enrich-previews
    let designReferenceId: string | null = null;
    if (nodeId) {
      try {
        const { data: dr } = await admin
          .from("design_references")
          .upsert({
            workspace_id: workspaceId,
            file_key: file.key,
            node_id: nodeId,
            frame_name: frameName,  // null until enrichment runs
            page_name: pageName,    // null until enrichment runs
            thumbnail_url: null,
            preview_status: "pending",
            updated_at: new Date().toISOString(),
          }, { onConflict: "workspace_id,file_key,node_id" })
          .select("id")
          .single();
        if (dr) designReferenceId = (dr as { id: string }).id;
      } catch (e) {
        console.warn("[team-sync] design_references upsert failed (migration not run?):", e);
      }
    }

    // AI classify — pass created_at so the classifier can apply age-based suggested-action rules
    const ai = await classifyComment(comment.message, comment.created_at).catch(() => null);

    const { data: newFeedbackItem } = await admin.from("feedback_items").insert({
      figma_comment_id: figmaCommentDbId,
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
      ai_suggested_action: ai?.suggested_action ?? null,
      figma_node_id: nodeId,
      figma_preview_url: fileThumbnailUrl,  // file-level thumbnail as initial placeholder
      ...(designReferenceId ? { design_reference_id: designReferenceId } : {}),
    }).select("id").single();
    const feedbackItemDbId = (newFeedbackItem as { id: string } | null)?.id ?? null;

    // Post to Slack if this needs a decision and bot is configured.
    // slackToken + slackChannel come from the workspace DB record (DB-first, env fallback).
    if (slackChannel && (ai?.classification === "Needs Decision" || ai?.classification === "Blocked")) {
      const figmaUrl = nodeId
        ? `https://www.figma.com/file/${file.key}?node-id=${encodeURIComponent(nodeId)}`
        : `https://www.figma.com/file/${file.key}`;

      postCommentToSlack({
        feedbackItemId: figmaCommentDbId,
        comment: comment.message,
        authorName: comment.user?.handle ?? "Unknown",
        projectName: file.projectName,
        fileName: file.name,
        pageName: pageName,
        classification: ai.classification,
        aiKeyQuestion: ai.key_question ?? null,
        figmaUrl,
        channel: slackChannel,
        itemId: feedbackItemDbId,
        projectId,
      }, slackToken)
        .then(({ ts, channel: ch }) => {
          // Store Slack message ts so we can update it later
          return admin.from("feedback_items")
            .update({ slack_message_ts: ts, slack_channel_id: ch })
            .eq("figma_comment_id", figmaCommentDbId);
        })
        .catch(e => console.warn("[team-sync] Slack post failed (non-critical):", e));
    }

    // Insert replies belonging to this new comment.
    // Figma reply.parent_id = parent's comment ID (e.g. "1779913087"), NOT order_id.
    const commentReplies = replies.filter(r => r.parent_id === comment.id);
    for (const reply of commentReplies) {
      if (!existingIds.has(reply.id)) {
        const { error: replyErr } = await admin.from("figma_comments").insert({
          figma_file_id: figmaFileId,
          workspace_id: workspaceId,
          figma_comment_id: reply.id,
          figma_order_id: reply.order_id,
          parent_figma_comment_id: figmaCommentDbId,
          author_name: reply.user?.handle ?? null,
          author_avatar: reply.user?.img_url ?? null,
          author_email: reply.user?.email ?? null,
          raw_content: reply.message,
          figma_node_id: null,
          figma_created_at: reply.created_at,
          resolved_at: reply.resolved_at ?? null,
          mentions_me: figmaUserId ? detectMention(reply.message, figmaUserId) : false,
          project_name: file.projectName,
        });
        if (replyErr) {
          console.error("[team-sync] failed reply insert", reply.id, replyErr);
        } else {
          repliesAdded++;
        }
      }
    }

    added++;
  }

  // Sync new replies to already-existing threads.
  // reply.parent_id = parent's figma_comment_id (NOT figma_order_id).
  for (const reply of replies) {
    if (existingIds.has(reply.id)) continue;
    const { data: parent } = await admin
      .from("figma_comments")
      .select("id")
      .eq("figma_comment_id", reply.parent_id ?? "")   // ← was figma_order_id (wrong)
      .eq("figma_file_id", figmaFileId)
      .maybeSingle();
    if (!parent) {
      console.warn(`[team-sync] reply ${reply.id} — parent ${reply.parent_id} not found in DB, skipping`);
      continue;
    }
    const { error: replyErr } = await admin.from("figma_comments").insert({
      figma_file_id: figmaFileId,
      workspace_id: workspaceId,
      figma_comment_id: reply.id,
      figma_order_id: reply.order_id,
      parent_figma_comment_id: (parent as { id: string }).id,
      author_name: reply.user?.handle ?? null,
      author_avatar: reply.user?.img_url ?? null,
      author_email: reply.user?.email ?? null,
      raw_content: reply.message,
      figma_node_id: null,
      figma_created_at: reply.created_at,
      resolved_at: reply.resolved_at ?? null,
      mentions_me: figmaUserId ? detectMention(reply.message, figmaUserId) : false,
      project_name: file.projectName,
    });
    if (replyErr) {
      console.error("[team-sync] failed reply insert (existing thread)", reply.id, replyErr);
    } else {
      repliesAdded++;
    }
  }

  await admin.from("figma_files").update({
    sync_status: "idle",
    last_synced_at: new Date().toISOString(),
    figma_pat: pat, // keep PAT fresh
  }).eq("id", figmaFileId);

  console.log(`[team-sync] ${file.name}: added ${added} parents, ${repliesAdded} replies, deleted ${deleted}`);
  return { fileKey: file.key, fileName: file.name, added, repliesAdded, deleted, total: topLevel.length };
}

async function ensureProject(
  admin: ReturnType<typeof createAdminClient>,
  workspaceId: string,
  projectName: string,
): Promise<string> {
  const { data: existing } = await admin
    .from("projects")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("name", projectName)
    .maybeSingle();

  if (existing) return (existing as { id: string }).id;

  const { data: created } = await admin
    .from("projects")
    .insert({ workspace_id: workspaceId, name: projectName })
    .select("id")
    .single();

  return (created as { id: string }).id;
}
