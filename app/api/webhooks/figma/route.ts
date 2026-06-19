import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { processSyncEvent } from "@/lib/sync-engine";

export async function POST(req: NextRequest) {
  let body: any;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }

  // Verify passcode (set when registering the Figma webhook)
  const passcode = body.passcode ?? req.headers.get("x-figma-passcode");
  if (process.env.FIGMA_WEBHOOK_PASSCODE && passcode !== process.env.FIGMA_WEBHOOK_PASSCODE) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Route to workspace — prefer ?ws= param, fall back to team_id lookup
  const wsParam = new URL(req.url).searchParams.get("ws");
  const admin   = createAdminClient();
  let workspaceId: string | null = wsParam;

  if (!workspaceId && body.team_id) {
    const { data } = await admin
      .from("workspaces")
      .select("id")
      .eq("figma_team_id", body.team_id)
      .maybeSingle();
    workspaceId = (data as any)?.id ?? null;
  }

  if (!workspaceId) return NextResponse.json({ ok: true }); // ack but no-op

  const eventType = body.event_type as string;

  // Determine source_thread_id before writing sync_event
  const fileKey        = body.file_key as string;
  const comment        = body.comment ?? {};
  const commentId      = body.comment_id ?? comment.id as string;

  const sourceThreadId =
    eventType === "FILE_COMMENT"
      ? `${fileKey}:${comment.parent_id ?? comment.id}`
      : `${fileKey}:${commentId}`;

  const normalizedType =
    eventType === "COMMENT_RESOLVED" ? "resolved" : "created";

  await admin.from("sync_events").insert({
    workspace_id:     workspaceId,
    source:           "figma",
    event_type:       normalizedType,
    source_thread_id: sourceThreadId,
    raw_payload:      body,
  });

  await admin
    .from("workspaces")
    .update({ last_figma_webhook_at: new Date().toISOString() })
    .eq("id", workspaceId);

  if (eventType === "FILE_COMMENT") {
    void processSyncEvent({
      event_type:        "created",
      workspace_id:      workspaceId,
      source:            "figma",
      source_thread_id:  sourceThreadId,
      source_comment_id: comment.id as string,
      title:             body.file_name ?? null,
      source_url:        fileKey ? `https://www.figma.com/file/${fileKey}` : undefined,
      author_name:       comment.user?.handle ?? null,
      author_email:      comment.user?.email  ?? null,
      body:              comment.message ?? "",
      created_at:        comment.created_at ?? undefined,
    }).catch(err => console.error("[webhooks/figma] process error:", err));
  } else if (eventType === "COMMENT_RESOLVED") {
    void processSyncEvent({
      event_type:       "resolved",
      workspace_id:     workspaceId,
      source:           "figma",
      source_thread_id: sourceThreadId,
      source_url:       fileKey ? `https://www.figma.com/file/${fileKey}` : undefined,
    }).catch(err => console.error("[webhooks/figma] process error:", err));
  }

  return NextResponse.json({ ok: true });
}
