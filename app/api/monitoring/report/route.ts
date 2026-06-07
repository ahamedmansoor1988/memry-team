/**
 * GET  /api/monitoring/report — authenticated (Supabase user session)
 *   Runs detectIssues(), persists result, returns MonitoringReport.
 *
 * POST /api/monitoring/report — secret-gated (x-notify-secret header)
 *   Same as GET but also triggers runWorkspaceScan() for Slack DMs.
 *   Returns { report, notified, skipped }.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { detectIssues } from "@/lib/monitoring/detect-issues";
import { runWorkspaceScan } from "@/lib/notifications/scan";

// ─── Shared helper ────────────────────────────────────────────────────────────

async function persistReport(
  admin: ReturnType<typeof createAdminClient>,
  workspaceId: string,
  report: Awaited<ReturnType<typeof detectIssues>>,
) {
  await admin
    .from("workspaces")
    .update({
      last_monitoring_report:       report,
      last_monitoring_health_score: report.health_score,
      notifications_last_scan:      report.scanned_at,
    })
    .eq("id", workspaceId);
}

// ─── GET — authenticated ──────────────────────────────────────────────────────

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();

  const { data: membership } = await admin
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", user.id)
    .limit(1)
    .single();

  const workspaceId = (membership as { workspace_id: string } | null)?.workspace_id;
  if (!workspaceId) return NextResponse.json({ error: "No workspace" }, { status: 400 });

  const report = await detectIssues(workspaceId);
  await persistReport(admin, workspaceId, report);

  return NextResponse.json(report);
}

// ─── POST — secret-gated (cron / external trigger) ───────────────────────────

export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-notify-secret");
  if (!secret || secret !== process.env.NOTIFY_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();

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

  if (!ws?.id) return NextResponse.json({ error: "No workspace" }, { status: 404 });

  const report = await detectIssues(ws.id);
  await persistReport(admin, ws.id, report);

  let notified = 0;
  let skipped  = 0;
  if (ws.notifications_enabled !== false) {
    const slackToken = ws.slack_bot_token ?? process.env.SLACK_BOT_TOKEN ?? "";
    const appUrl     = process.env.NEXT_PUBLIC_APP_URL ?? "";
    const scanResult = await runWorkspaceScan(ws.id, slackToken, appUrl);
    notified = scanResult.notified;
    skipped  = scanResult.skipped;
  }

  return NextResponse.json({ report, notified, skipped });
}
