/**
 * POST /api/webhooks/jira
 *
 * Receives Jira comment webhooks. Register this URL in your Jira project at:
 *   Project Settings → Webhooks → Create webhook
 *
 * Events handled:
 *   comment_created      → created
 *   comment_updated      → edited
 *   issue_comment_edited → edited
 *   comment_deleted      → deleted
 *
 * Verification: HMAC-SHA256 of the raw body, compared to the X-Hub-Signature header
 * (format: "sha256=<hex>"). Set JIRA_WEBHOOK_SECRET in your env and use the same
 * value in Jira's "Secret" field when registering.
 *
 * Workspace routing: include ?wsid=<workspace_uuid> when registering the webhook URL.
 * Example: https://memry.app/api/webhooks/jira?wsid=abc-123
 *
 * Queue pattern: returns 200 immediately after writing to sync_events; processes async.
 */
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { processSyncEvent } from "@/lib/sync/process-sync-event";

const JIRA_EVENT_MAP: Record<string, string> = {
  comment_created:      "created",
  comment_updated:      "edited",
  issue_comment_edited: "edited",
  comment_deleted:      "deleted",
};

async function verifyJiraSignature(req: NextRequest, body: string): Promise<boolean> {
  const secret = process.env.JIRA_WEBHOOK_SECRET;
  if (!secret) return false;

  const signature = req.headers.get("x-hub-signature");
  if (!signature?.startsWith("sha256=")) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sigBytes = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  const computed = "sha256=" + Array.from(new Uint8Array(sigBytes))
    .map(b => b.toString(16).padStart(2, "0")).join("");

  return computed === signature;
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();

  // ── 1. Verify signature ───────────────────────────────────────────────────
  const valid = await verifyJiraSignature(req, rawBody);
  if (!valid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // ── 2. Parse payload ──────────────────────────────────────────────────────
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const webhookEvent = (payload.webhookEvent as string) ?? "";
  const eventType    = JIRA_EVENT_MAP[webhookEvent];
  if (!eventType) return NextResponse.json({ ok: true });

  const issue    = (payload.issue as Record<string, unknown>) ?? {};
  const issueKey = (issue.key    as string) ?? null;
  if (!issueKey) return NextResponse.json({ ok: true });

  // ── 3. Workspace from URL param ───────────────────────────────────────────
  const workspaceId = req.nextUrl.searchParams.get("wsid");
  if (!workspaceId) {
    console.warn("[webhooks/jira] missing wsid query param — register URL as /api/webhooks/jira?wsid=<workspace_uuid>");
    return NextResponse.json({ ok: true });
  }

  // ── 4. Write sync_event ───────────────────────────────────────────────────
  const admin = createAdminClient();
  const { data: syncEvent, error: insertError } = await admin
    .from("sync_events")
    .insert({
      workspace_id:     workspaceId,
      source:           "jira",
      event_type:       eventType,
      source_thread_id: issueKey,   // issue key is the thread identity (e.g. PROJ-42)
      raw_payload:      payload,
    })
    .select("id")
    .single();

  if (insertError) {
    console.error("[webhooks/jira] sync_events insert error:", insertError.message);
    return NextResponse.json({ ok: true });
  }

  // ── 5. Return 200 immediately, process async ──────────────────────────────
  const syncEventId = (syncEvent as { id: string } | null)?.id;
  if (syncEventId) {
    processSyncEvent(syncEventId).catch(err =>
      console.error("[webhooks/jira] processSyncEvent error:", err),
    );
  }

  return NextResponse.json({ ok: true });
}
