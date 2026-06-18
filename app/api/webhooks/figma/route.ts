/**
 * POST /api/webhooks/figma
 *
 * Receives Figma comment webhooks. Register this URL in your Figma app at:
 *   https://www.figma.com/developers/api#webhooks-v2
 *
 * Events handled:
 *   FILE_COMMENT     → creates a comment_threads row + thread_comments row
 *   COMMENT_RESOLVED → marks the thread resolved
 *
 * Verification: Figma sends a passcode in the x-figma-passcode request header.
 * Set FIGMA_WEBHOOK_PASSCODE in your env and use the same value when registering.
 *
 * Workspace lookup: uses figma_team_id from the payload — the Figma team ID
 * must be stored in workspaces.figma_team_id for routing to work.
 *
 * Queue pattern: returns 200 immediately, writes to sync_events, then processes
 * async. Figma will retry on non-2xx, so we always return 200.
 */
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { processSyncEvent } from "@/lib/sync/process-sync-event";

const FIGMA_EVENT_MAP: Record<string, string> = {
  FILE_COMMENT:     "created",
  COMMENT_RESOLVED: "resolved",
};

export async function POST(req: NextRequest) {
  const rawBody = await req.text();

  // ── 1. Verify passcode ────────────────────────────────────────────────────
  const passcode         = req.headers.get("x-figma-passcode");
  const expectedPasscode = process.env.FIGMA_WEBHOOK_PASSCODE;
  if (!expectedPasscode || passcode !== expectedPasscode) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ── 2. Parse payload ──────────────────────────────────────────────────────
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const figmaEventType = (payload.event_type as string) ?? "";
  const eventType      = FIGMA_EVENT_MAP[figmaEventType];

  // Return 200 for unrecognised event types — Figma may send new types in future
  if (!eventType) return NextResponse.json({ ok: true });

  const figmaTeamId = (payload.team_id  as string) ?? null;
  const fileKey     = (payload.file_key as string) ?? null;
  if (!fileKey) return NextResponse.json({ ok: true });

  // Derive source_thread_id: file_key:root_comment_id
  // parent_id is null for root comments; replies carry the root comment's id as parent_id
  const comments    = (payload.comment as Array<Record<string, unknown>>) ?? [];
  const firstComment = comments[0] ?? {};
  const commentId    = (firstComment.id        as string) ?? "";
  const parentId     = (firstComment.parent_id as string | null) ?? null;
  const rootId       = parentId ?? commentId;
  const sourceThreadId = rootId ? `${fileKey}:${rootId}` : fileKey;

  // ── 3. Workspace lookup ───────────────────────────────────────────────────
  const admin = createAdminClient();
  let workspaceId: string | null = null;

  if (figmaTeamId) {
    const { data: ws } = await admin
      .from("workspaces")
      .select("id")
      .eq("figma_team_id", figmaTeamId)
      .maybeSingle();
    workspaceId = (ws as { id: string } | null)?.id ?? null;
  }

  if (!workspaceId) return NextResponse.json({ ok: true });

  // ── 4. Write sync_event ───────────────────────────────────────────────────
  const { data: syncEvent, error: insertError } = await admin
    .from("sync_events")
    .insert({
      workspace_id:     workspaceId,
      source:           "figma",
      event_type:       eventType,
      source_thread_id: sourceThreadId,
      raw_payload:      payload,
    })
    .select("id")
    .single();

  if (insertError) {
    console.error("[webhooks/figma] sync_events insert error:", insertError.message);
    return NextResponse.json({ ok: true });
  }

  // ── 5. Return 200 immediately, process async ──────────────────────────────
  const syncEventId = (syncEvent as { id: string } | null)?.id;
  if (syncEventId) {
    processSyncEvent(syncEventId).catch(err =>
      console.error("[webhooks/figma] processSyncEvent error:", err),
    );
  }

  return NextResponse.json({ ok: true });
}
