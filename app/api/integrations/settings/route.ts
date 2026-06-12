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

  // When a Slack bot token is saved, verify it with auth.test and report the
  // result — a token that fails verification is useless and the user must know.
  const savedToken = body.slack_bot_token?.trim();
  if (savedToken) {
    const REQUIRED_SCOPES = ["channels:history", "channels:read", "channels:join", "groups:history", "chat:write"];
    try {
      const authRes  = await fetch("https://slack.com/api/auth.test", {
        headers: { Authorization: `Bearer ${savedToken}` },
      });
      const authData = await authRes.json() as {
        ok: boolean; error?: string; team_id?: string; team?: string; user?: string;
      };

      if (!authData.ok) {
        // Token is invalid — clear it so the events route doesn't use a dead token
        await admin.from("workspaces")
          .update({ slack_bot_token: null, slack_team_id: null })
          .eq("id", workspaceId);
        return NextResponse.json({
          ok: false,
          slack_error: `Slack rejected the token (${authData.error ?? "unknown error"}). Check that you copied the Bot User OAuth Token (starts with xoxb-).`,
        }, { status: 400 });
      }

      if (authData.team_id) {
        await admin.from("workspaces")
          .update({ slack_team_id: authData.team_id })
          .eq("id", workspaceId);
      }

      const grantedScopes = (authRes.headers.get("x-oauth-scopes") ?? "")
        .split(",").map(s => s.trim()).filter(Boolean);
      const missingScopes = grantedScopes.length > 0
        ? REQUIRED_SCOPES.filter(s => !grantedScopes.includes(s))
        : [];

      return NextResponse.json({
        ok: true,
        slack_verified: {
          team:           authData.team ?? null,
          bot_user:       authData.user ?? null,
          missing_scopes: missingScopes,
        },
      });
    } catch {
      return NextResponse.json({
        ok: false,
        slack_error: "Could not reach Slack to verify the token. Try again.",
      }, { status: 502 });
    }
  }

  return NextResponse.json({ ok: true });
}
