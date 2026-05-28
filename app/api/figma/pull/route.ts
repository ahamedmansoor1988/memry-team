/**
 * POST /api/figma/pull
 * Triggers a full team-based Figma sync for the current user's workspace.
 * Uses the workspace-level PAT + Team ID (Stage 01 approach).
 * Also accepts cron secret for scheduled runs.
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { syncTeam } from "@/lib/figma/team-sync";
import { backfillPreviews } from "@/lib/figma/preview-backfill";

export async function POST(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization");
  const isCron = cronSecret && authHeader === `Bearer ${cronSecret}`;

  const admin = createAdminClient();

  if (isCron) {
    // Cron: sync all workspaces that have a team ID + PAT
    const { data: workspaces } = await admin
      .from("workspaces")
      .select("id, figma_team_id, figma_pat, figma_user_id")
      .not("figma_team_id", "is", null)
      .not("figma_pat", "is", null);

    if (!workspaces?.length) {
      return NextResponse.json({ synced: 0, message: "No workspaces with team config" });
    }

    let totalAdded = 0;
    const allResults = [];
    for (const ws of workspaces) {
      try {
        const result = await syncTeam(
          ws.id,
          ws.figma_team_id as string,
          ws.figma_pat as string,
          ws.figma_user_id as string | null,
        );
        totalAdded += result.totalAdded;
        allResults.push({ workspaceId: ws.id, ...result });
      } catch (e) {
        allResults.push({ workspaceId: ws.id, error: String(e) });
      }
    }

    return NextResponse.json({ synced: workspaces.length, totalAdded, results: allResults });
  }

  // Authenticated user pull
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Get workspace + figma settings
  const { data: member } = await admin
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", user.id)
    .single();

  if (!member) return NextResponse.json({ error: "No workspace found" }, { status: 404 });
  const workspaceId = (member as { workspace_id: string }).workspace_id;

  const { data: workspace } = await admin
    .from("workspaces")
    .select("figma_team_id, figma_pat, figma_user_id, slack_bot_token, slack_channel_id, slack_signing_secret")
    .eq("id", workspaceId)
    .single();

  if (!workspace?.figma_team_id || !workspace?.figma_pat) {
    return NextResponse.json(
      { error: "Figma Team ID and PAT must be configured in Integrations" },
      { status: 400 }
    );
  }

  const result = await syncTeam(
    workspaceId,
    workspace.figma_team_id as string,
    workspace.figma_pat as string,
    workspace.figma_user_id as string | null,
  );

  // Backfill any items that are missing preview screenshots
  await backfillPreviews(workspaceId, workspace.figma_pat as string).catch(
    e => console.warn("[pull] backfill-previews failed:", e)
  );

  return NextResponse.json({ ok: true, ...result });
}
