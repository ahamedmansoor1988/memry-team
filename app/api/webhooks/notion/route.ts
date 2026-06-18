/**
 * POST /api/webhooks/notion
 *
 * Receives Notion webhooks. Configure in Notion's integration settings at:
 *   https://www.notion.so/profile/integrations → your integration → Webhooks
 *
 * Events handled:
 *   comment.created  → created
 *   comment.deleted  → deleted
 *   page.updated     → edited (used to sync the page title onto the thread)
 *
 * Verification: HMAC-SHA256 of the raw body, compared to X-Notion-Signature header
 * (format: "v1=<hex>"). Set NOTION_WEBHOOK_SECRET in your env.
 *
 * Workspace routing: include ?wsid=<workspace_uuid> when registering the webhook URL.
 * Example: https://memry.app/api/webhooks/notion?wsid=abc-123
 *
 * Thread identity: Notion's source_thread_id is the page_id — all comments on a
 * page belong to the same logical thread.
 *
 * Queue pattern: returns 200 immediately; processes async.
 */
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { processSyncEvent } from "@/lib/sync/process-sync-event";

const NOTION_EVENT_MAP: Record<string, string> = {
  "comment.created": "created",
  "comment.deleted": "deleted",
  "page.updated":    "edited",
};

async function verifyNotionSignature(req: NextRequest, body: string): Promise<boolean> {
  const secret = process.env.NOTION_WEBHOOK_SECRET;
  if (!secret) return false;

  // Notion sends: X-Notion-Signature: v1=<hex>
  const signature = req.headers.get("x-notion-signature");
  if (!signature?.startsWith("v1=")) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sigBytes = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  const computed = "v1=" + Array.from(new Uint8Array(sigBytes))
    .map(b => b.toString(16).padStart(2, "0")).join("");

  return computed === signature;
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();

  // ── 1. Verify signature ───────────────────────────────────────────────────
  const valid = await verifyNotionSignature(req, rawBody);
  if (!valid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // ── 2. Parse payload ──────────────────────────────────────────────────────
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const notionType = (payload.type as string) ?? "";
  const eventType  = NOTION_EVENT_MAP[notionType];
  if (!eventType) return NextResponse.json({ ok: true });

  // Extract page_id — location differs between comment and page events
  const data   = (payload.data   as Record<string, unknown>) ?? {};
  const parent = (data.parent    as Record<string, string>)  ?? {};

  // comment events: data.parent.page_id
  // page events:    payload.entity.id (the page itself)
  const entity = (payload.entity as Record<string, string>) ?? {};
  const pageId  = parent.page_id
    ?? (notionType.startsWith("page.") ? entity.id : null)
    ?? (payload.page_id as string)
    ?? null;

  if (!pageId) return NextResponse.json({ ok: true });

  // ── 3. Workspace from URL param ───────────────────────────────────────────
  const workspaceId = req.nextUrl.searchParams.get("wsid");
  if (!workspaceId) {
    console.warn("[webhooks/notion] missing wsid query param — register URL as /api/webhooks/notion?wsid=<workspace_uuid>");
    return NextResponse.json({ ok: true });
  }

  // ── 4. Write sync_event ───────────────────────────────────────────────────
  const admin = createAdminClient();
  const { data: syncEvent, error: insertError } = await admin
    .from("sync_events")
    .insert({
      workspace_id:     workspaceId,
      source:           "notion",
      event_type:       eventType,
      source_thread_id: pageId,   // page_id is the thread identity
      raw_payload:      payload,
    })
    .select("id")
    .single();

  if (insertError) {
    console.error("[webhooks/notion] sync_events insert error:", insertError.message);
    return NextResponse.json({ ok: true });
  }

  // ── 5. Return 200 immediately, process async ──────────────────────────────
  const syncEventId = (syncEvent as { id: string } | null)?.id;
  if (syncEventId) {
    processSyncEvent(syncEventId).catch(err =>
      console.error("[webhooks/notion] processSyncEvent error:", err),
    );
  }

  return NextResponse.json({ ok: true });
}
