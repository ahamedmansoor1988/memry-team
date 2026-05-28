/**
 * GET  /api/integrations/settings  — load workspace Figma + Slack config
 * POST /api/integrations/settings  — save workspace Figma settings
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";

async function getWorkspaceId(userId: string, admin: ReturnType<typeof createAdminClient>) {
  const { data } = await admin
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", userId)
    .single();
  return (data as { workspace_id: string } | null)?.workspace_id ?? null;
}

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const workspaceId = await getWorkspaceId(user.id, admin);
  if (!workspaceId) return NextResponse.json({ error: "No workspace" }, { status: 404 });

  const { data: ws } = await admin
    .from("workspaces")
    .select("figma_team_id, figma_pat, figma_user_id, slack_webhook_url")
    .eq("id", workspaceId)
    .single();

  // Get last synced from figma_files
  const { data: latestFile } = await admin
    .from("figma_files")
    .select("last_synced_at")
    .eq("workspace_id", workspaceId)
    .order("last_synced_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return NextResponse.json({
    figma_team_id: (ws as Record<string, unknown>)?.figma_team_id ?? null,
    figma_pat: (ws as Record<string, unknown>)?.figma_pat ?? null,
    figma_user_id: (ws as Record<string, unknown>)?.figma_user_id ?? null,
    slack_webhook_url:   (ws as Record<string, unknown>)?.slack_webhook_url ?? null,
    slack_bot_token:     (ws as Record<string, unknown>)?.slack_bot_token ? "configured" : null,
    slack_channel_id:    (ws as Record<string, unknown>)?.slack_channel_id ?? null,
    last_synced_at: (latestFile as Record<string, unknown> | null)?.last_synced_at ?? null,
  });
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json() as {
    figma_team_id?: string;
    figma_pat?: string;
    figma_user_id?: string;
    slack_bot_token?: string;
    slack_channel_id?: string;
    slack_signing_secret?: string;
  };

  const admin = createAdminClient();
  const workspaceId = await getWorkspaceId(user.id, admin);
  if (!workspaceId) return NextResponse.json({ error: "No workspace" }, { status: 404 });

  const patch: Record<string, string | null> = {};
  if (body.figma_team_id !== undefined)      patch.figma_team_id      = body.figma_team_id      || null;
  if (body.figma_pat !== undefined)          patch.figma_pat          = body.figma_pat          || null;
  if (body.figma_user_id !== undefined)      patch.figma_user_id      = body.figma_user_id      || null;
  if (body.slack_bot_token !== undefined)    patch.slack_bot_token    = body.slack_bot_token    || null;
  if (body.slack_channel_id !== undefined)   patch.slack_channel_id   = body.slack_channel_id   || null;
  if (body.slack_signing_secret !== undefined) patch.slack_signing_secret = body.slack_signing_secret || null;

  const { error } = await admin
    .from("workspaces")
    .update(patch)
    .eq("id", workspaceId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
