import { createClient, createAdminClient } from "@/lib/supabase/server";

export interface WorkspaceRow {
  id: string;
  name: string;
  slug: string;
  slack_bot_token: string | null;
  slack_team_id: string | null;
  slack_team_name: string | null;
  slack_channel_id: string | null;
  slack_signing_secret: string | null;
  slack_connected_at: string | null;
  figma_pat: string | null;
  figma_team_id: string | null;
  figma_connected_at: string | null;
  figma_webhook_id_comment: string | null;
  figma_webhook_id_resolved: string | null;
  figma_webhook_passcode: string | null;
  jira_access_token: string | null;
  jira_refresh_token: string | null;
  jira_cloud_id: string | null;
  jira_connected_at: string | null;
  notion_access_token: string | null;
  notion_connected_at: string | null;
  last_slack_webhook_at: string | null;
  last_figma_webhook_at: string | null;
  last_jira_webhook_at: string | null;
  last_notion_webhook_at: string | null;
}

export async function getWorkspace(): Promise<{ userId: string; workspace: WorkspaceRow } | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const admin = createAdminClient();
  const { data } = await admin
    .from("workspace_members")
    .select("workspace_id, workspaces(*)")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!data?.workspaces) return null;
  return { userId: user.id, workspace: data.workspaces as WorkspaceRow };
}
