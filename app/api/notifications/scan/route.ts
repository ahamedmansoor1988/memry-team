/**
 * POST /api/notifications/scan  — triggered by a cron job
 * GET  /api/notifications/scan  — for easy browser testing
 *
 * Auth: requires header `x-notify-secret` matching env var NOTIFY_SECRET.
 * (No user session — this is called by an external scheduler, not the UI.)
 *
 * Required env vars:
 *   NOTIFY_SECRET          — shared secret checked in the x-notify-secret header
 *   NEXT_PUBLIC_APP_URL    — base URL used to build deep links in DMs
 *   SLACK_BOT_TOKEN        — fallback if workspace has no slack_bot_token row
 */

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { runWorkspaceScan } from "@/lib/notifications/scan";

async function handleScan(req: NextRequest) {
  // ── Secret check ────────────────────────────────────────────────────────────
  const secret = req.headers.get("x-notify-secret");
  if (!secret || secret !== process.env.NOTIFY_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin   = createAdminClient();
  const appUrl  = process.env.NEXT_PUBLIC_APP_URL ?? "";

  // ── Load first workspace ────────────────────────────────────────────────────
  const { data: wsRow } = await admin
    .from("workspaces")
    .select("id, slack_bot_token, notifications_enabled")
    .limit(1)
    .maybeSingle();

  const ws = wsRow as {
    id: string;
    slack_bot_token: string | null;
    notifications_enabled: boolean | null;
  } | null;

  if (!ws?.id) {
    return NextResponse.json({ error: "No workspace found" }, { status: 404 });
  }

  if (ws.notifications_enabled === false) {
    return NextResponse.json({ notified: 0, skipped: 0, message: "Notifications disabled" });
  }

  const slackToken = ws.slack_bot_token ?? process.env.SLACK_BOT_TOKEN ?? "";

  // ── Run scan ────────────────────────────────────────────────────────────────
  const result = await runWorkspaceScan(ws.id, slackToken, appUrl);

  // ── Stamp last-scan time ────────────────────────────────────────────────────
  const scannedAt = new Date().toISOString();
  await admin
    .from("workspaces")
    .update({ notifications_last_scan: scannedAt })
    .eq("id", ws.id);

  return NextResponse.json({ ...result, notifications_last_scan: scannedAt });
}

export async function POST(req: NextRequest) {
  return handleScan(req);
}

export async function GET(req: NextRequest) {
  return handleScan(req);
}
