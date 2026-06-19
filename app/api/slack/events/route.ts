import { NextRequest, NextResponse } from "next/server";
import { createAdminClient }         from "@/lib/supabase/server";
import { processSyncEvent }          from "@/lib/sync-engine";
import crypto                        from "crypto";

function verifySlackSignature(
  signingSecret: string,
  signature:     string,
  timestamp:     string,
  body:          string,
): boolean {
  // Reject stale requests (replay protection)
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const expected =
    "v0=" +
    crypto
      .createHmac("sha256", signingSecret)
      .update(`v0:${timestamp}:${body}`)
      .digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  let body: any;
  try { body = JSON.parse(rawBody); }
  catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }

  // Slack URL verification challenge
  if (body.type === "url_verification") {
    return NextResponse.json({ challenge: body.challenge });
  }

  if (body.type !== "event_callback") return NextResponse.json({ ok: true });

  const admin  = createAdminClient();
  const teamId = body.team_id as string;

  // Look up workspace by Slack team ID
  const { data: ws } = await admin
    .from("workspaces")
    .select("id, slack_signing_secret")
    .eq("slack_team_id", teamId)
    .maybeSingle();

  const workspace = ws as { id: string; slack_signing_secret: string | null } | null;
  if (!workspace) return NextResponse.json({ ok: true });

  // Verify Slack signature
  const signingSecret = workspace.slack_signing_secret ?? process.env.SLACK_SIGNING_SECRET;
  if (signingSecret) {
    const sig = req.headers.get("x-slack-signature")          ?? "";
    const ts  = req.headers.get("x-slack-request-timestamp")  ?? "";
    if (!verifySlackSignature(signingSecret, sig, ts, rawBody)) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const event    = body.event   ?? {};
  const subtype  = event.subtype as string | undefined;
  const workspaceId = workspace.id;

  // Skip bot messages
  if (event.bot_id || subtype === "bot_message") return NextResponse.json({ ok: true });

  const stamp = new Date().toISOString();

  if (!subtype) {
    // ── New message ───────────────────────────────────────────────────────────
    const ts             = event.ts      as string;
    const threadTs       = event.thread_ts as string | undefined;
    const channel        = event.channel  as string;
    const sourceThreadId = `${channel}:${threadTs ?? ts}`;

    await admin.from("sync_events").insert({
      workspace_id: workspaceId, source: "slack",
      event_type: "created", source_thread_id: sourceThreadId, raw_payload: body,
    });
    await admin.from("workspaces").update({ last_slack_webhook_at: stamp }).eq("id", workspaceId);

    void processSyncEvent({
      event_type:        "created",
      workspace_id:      workspaceId,
      source:            "slack",
      source_thread_id:  sourceThreadId,
      source_comment_id: ts,
      author_name:       event.user ?? null,
      body:              event.text ?? "",
    }).catch(err => console.error("[slack/events] process error:", err));

  } else if (subtype === "message_changed") {
    // ── Edited message ────────────────────────────────────────────────────────
    const msg            = event.message ?? {};
    const ts             = msg.ts        as string;
    const threadTs       = msg.thread_ts as string | undefined;
    const channel        = event.channel  as string;
    const sourceThreadId = `${channel}:${threadTs ?? ts}`;

    await admin.from("sync_events").insert({
      workspace_id: workspaceId, source: "slack",
      event_type: "edited", source_thread_id: sourceThreadId, raw_payload: body,
    });
    await admin.from("workspaces").update({ last_slack_webhook_at: stamp }).eq("id", workspaceId);

    void processSyncEvent({
      event_type:        "edited",
      workspace_id:      workspaceId,
      source:            "slack",
      source_thread_id:  sourceThreadId,
      source_comment_id: ts,
      body:              msg.text ?? "",
    }).catch(err => console.error("[slack/events] process error:", err));

  } else if (subtype === "message_deleted") {
    // ── Deleted message ───────────────────────────────────────────────────────
    const deletedTs      = event.deleted_ts as string;
    const channel        = event.channel    as string;
    const sourceThreadId = `${channel}:${deletedTs}`;

    await admin.from("sync_events").insert({
      workspace_id: workspaceId, source: "slack",
      event_type: "deleted", source_thread_id: sourceThreadId, raw_payload: body,
    });
    await admin.from("workspaces").update({ last_slack_webhook_at: stamp }).eq("id", workspaceId);

    void processSyncEvent({
      event_type:        "deleted",
      workspace_id:      workspaceId,
      source:            "slack",
      source_thread_id:  sourceThreadId,
      source_comment_id: deletedTs,
    }).catch(err => console.error("[slack/events] process error:", err));
  }

  return NextResponse.json({ ok: true });
}
