import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { processSyncEvent } from "@/lib/sync-engine";

const EVENT_MAP: Record<string, "created" | "edited" | "deleted"> = {
  comment_created:      "created",
  comment_updated:      "edited",
  comment_deleted:      "deleted",
  issue_comment_edited: "edited",
};

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  let body: any;
  try { body = JSON.parse(rawBody); }
  catch { return NextResponse.json({ ok: true }); }

  // Workspace routed via ?ws=<workspace_id>
  const workspaceId = new URL(req.url).searchParams.get("ws");
  if (!workspaceId) return NextResponse.json({ ok: true });

  const webhookEvent = body.webhookEvent as string;
  const eventType    = EVENT_MAP[webhookEvent];
  if (!eventType) return NextResponse.json({ ok: true });

  const admin          = createAdminClient();
  const issue          = body.issue   ?? {};
  const comment        = body.comment ?? {};
  const issueKey       = (issue.key ?? issue.id ?? "unknown") as string;
  const sourceThreadId = issueKey;

  // Construct browse URL from REST API self URL
  const selfUrl  = issue.self as string | undefined;
  const sourceUrl = selfUrl
    ? selfUrl.replace(/\/rest\/api\/[^/]+\/issue\/.*/, "") + "/browse/" + issueKey
    : null;

  await admin.from("sync_events").insert({
    workspace_id:     workspaceId,
    source:           "jira",
    event_type:       eventType,
    source_thread_id: sourceThreadId,
    raw_payload:      body,
  });

  await admin
    .from("workspaces")
    .update({ last_jira_webhook_at: new Date().toISOString() })
    .eq("id", workspaceId);

  void processSyncEvent({
    event_type:        eventType,
    workspace_id:      workspaceId,
    source:            "jira",
    source_thread_id:  sourceThreadId,
    source_comment_id: comment.id ? String(comment.id) : undefined,
    title:             issue.fields?.summary ?? null,
    source_url:        sourceUrl,
    author_name:       comment.author?.displayName  ?? null,
    author_email:      comment.author?.emailAddress ?? null,
    body:              comment.body ?? "",
    created_at:        comment.created ?? undefined,
  }).catch(err => console.error("[webhooks/jira] process error:", err));

  return NextResponse.json({ ok: true });
}
