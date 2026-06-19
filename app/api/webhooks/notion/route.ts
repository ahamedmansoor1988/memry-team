import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { processSyncEvent } from "@/lib/sync-engine";

const EVENT_MAP: Record<string, "created" | "deleted" | "edited"> = {
  "comment.created": "created",
  "comment.deleted": "deleted",
  "page.updated":    "edited",
};

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  let body: any;
  try { body = JSON.parse(rawBody); }
  catch { return NextResponse.json({ ok: true }); }

  // Workspace routed via ?ws=<workspace_id>
  const workspaceId = new URL(req.url).searchParams.get("ws");
  if (!workspaceId) return NextResponse.json({ ok: true });

  const eventType    = body.type as string;
  const syncEventType = EVENT_MAP[eventType];
  if (!syncEventType) return NextResponse.json({ ok: true });

  const admin = createAdminClient();

  // Extract page/comment identifiers
  const data      = body.data ?? {};
  const comment   = data.comment ?? body.entity ?? {};
  const pageId    = (comment.parent?.id ?? data.parent?.id ?? comment.id ?? data.id) as string;
  if (!pageId) return NextResponse.json({ ok: true });

  // Plain text from rich_text array
  const richText  = comment.rich_text ?? [];
  const plainText = richText.map((rt: any) => rt.plain_text ?? "").join("");

  const commentId = body.entity?.id ?? comment.id as string | undefined;

  await admin.from("sync_events").insert({
    workspace_id:     workspaceId,
    source:           "notion",
    event_type:       syncEventType,
    source_thread_id: pageId,
    raw_payload:      body,
  });

  await admin
    .from("workspaces")
    .update({ last_notion_webhook_at: new Date().toISOString() })
    .eq("id", workspaceId);

  void processSyncEvent({
    event_type:        syncEventType,
    workspace_id:      workspaceId,
    source:            "notion",
    source_thread_id:  pageId,
    source_comment_id: commentId,
    title:             data.title ?? null,
    source_url:        `https://notion.so/${pageId.replace(/-/g, "")}`,
    author_name:       data.created_by?.name ?? null,
    body:              plainText,
  }).catch(err => console.error("[webhooks/notion] process error:", err));

  return NextResponse.json({ ok: true });
}
