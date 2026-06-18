import { NextResponse } from "next/server";
import { getWorkspace } from "@/lib/workspace";

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

function webhookHealth(lastAt: string | null): "healthy" | "stale" | "waiting" {
  if (!lastAt) return "waiting";
  return Date.now() - new Date(lastAt).getTime() < SIX_HOURS_MS ? "healthy" : "stale";
}

export async function GET() {
  const ctx = await getWorkspace();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { workspace: ws } = ctx;

  return NextResponse.json({
    workspace_id: ws.id,
    workspace_name: ws.name,
    slack: {
      connected: !!ws.slack_bot_token,
      team_name: ws.slack_team_name,
      connected_at: ws.slack_connected_at,
      webhook: webhookHealth(ws.last_slack_webhook_at),
    },
    figma: {
      connected: !!ws.figma_pat,
      team_id: ws.figma_team_id,
      connected_at: ws.figma_connected_at,
      webhook: webhookHealth(ws.last_figma_webhook_at),
    },
    jira: {
      connected: !!ws.jira_access_token,
      cloud_id: ws.jira_cloud_id,
      connected_at: ws.jira_connected_at,
      webhook: webhookHealth(ws.last_jira_webhook_at),
    },
    notion: {
      connected: !!ws.notion_access_token,
      connected_at: ws.notion_connected_at,
      webhook: webhookHealth(ws.last_notion_webhook_at),
    },
  });
}
