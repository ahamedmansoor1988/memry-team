/**
 * Notification settings + on-demand scan — requires Supabase user session.
 *
 * GET   /api/notifications/test  — return { notifications_enabled, notifications_last_scan }
 * POST  /api/notifications/test  — run scan now, return { notified, skipped, notifications_last_scan }
 * PATCH /api/notifications/test  — update { notifications_enabled }, return { ok: true }
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { runWorkspaceScan } from "@/lib/notifications/scan";

// ── Shared helpers ────────────────────────────────────────────────────────────

async function resolveWorkspace(userId: string) {
  const admin = createAdminClient();
  const { data } = await admin
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", userId)
    .limit(1)
    .single();
  return (data as { workspace_id: string } | null)?.workspace_id ?? null;
}

async function requireUser() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

// ── GET — return notification settings ───────────────────────────────────────

export async function GET() {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const workspaceId = await resolveWorkspace(user.id);
  if (!workspaceId) return NextResponse.json({ error: "No workspace" }, { status: 400 });

  const admin = createAdminClient();

  try {
    const { data: ws } = await admin
      .from("workspaces")
      .select("notifications_enabled, notifications_last_scan")
      .eq("id", workspaceId)
      .single();

    const row = ws as {
      notifications_enabled: boolean | null;
      notifications_last_scan: string | null;
    } | null;

    return NextResponse.json({
      notifications_enabled:   row?.notifications_enabled ?? true,
      notifications_last_scan: row?.notifications_last_scan ?? null,
    });
  } catch {
    // Migration may not have been run yet — return safe defaults
    return NextResponse.json({ notifications_enabled: true, notifications_last_scan: null });
  }
}

// ── POST — run scan now ───────────────────────────────────────────────────────

export async function POST() {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const workspaceId = await resolveWorkspace(user.id);
  if (!workspaceId) return NextResponse.json({ error: "No workspace" }, { status: 400 });

  const admin      = createAdminClient();
  const appUrl     = process.env.NEXT_PUBLIC_APP_URL ?? "";

  // Load Slack token (DB-first, env fallback)
  const { data: ws } = await admin
    .from("workspaces")
    .select("slack_bot_token, notifications_enabled")
    .eq("id", workspaceId)
    .single();

  const row = ws as { slack_bot_token: string | null; notifications_enabled: boolean | null } | null;
  const slackToken = row?.slack_bot_token ?? process.env.SLACK_BOT_TOKEN ?? "";

  if (row?.notifications_enabled === false) {
    return NextResponse.json({ notified: 0, skipped: 0, message: "Notifications disabled" });
  }

  const result = await runWorkspaceScan(workspaceId, slackToken, appUrl);

  const scannedAt = new Date().toISOString();
  await admin
    .from("workspaces")
    .update({ notifications_last_scan: scannedAt })
    .eq("id", workspaceId);

  return NextResponse.json({ ...result, notifications_last_scan: scannedAt });
}

// ── PATCH — toggle notifications_enabled ─────────────────────────────────────

export async function PATCH(req: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json() as { notifications_enabled?: boolean };
  if (typeof body.notifications_enabled !== "boolean") {
    return NextResponse.json({ error: "notifications_enabled (boolean) required" }, { status: 400 });
  }

  const workspaceId = await resolveWorkspace(user.id);
  if (!workspaceId) return NextResponse.json({ error: "No workspace" }, { status: 400 });

  const admin = createAdminClient();
  await admin
    .from("workspaces")
    .update({ notifications_enabled: body.notifications_enabled })
    .eq("id", workspaceId);

  return NextResponse.json({ ok: true });
}
