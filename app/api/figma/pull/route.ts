/**
 * POST /api/figma/pull
 *
 * Phase 1: discovers all team files and upserts figma_files + projects rows.
 * Phase 2: fires POST /api/figma-files/{id}/sync for each file independently.
 *
 * This two-phase approach keeps this request well within Vercel's 10-second
 * Hobby timeout. Each per-file sync gets its own 10-second budget.
 *
 * Accepts user session OR cron secret.
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { listTeamFiles } from "@/lib/figma/team-sync";

export async function POST(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization");
  const isCron = cronSecret && authHeader === `Bearer ${cronSecret}`;

  const admin = createAdminClient();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://memry-team-opal.vercel.app";

  if (isCron) {
    // Cron path: discover + fan out for all workspaces
    const { data: workspaces } = await admin
      .from("workspaces")
      .select("id, figma_team_id, figma_pat, figma_user_id")
      .not("figma_team_id", "is", null)
      .not("figma_pat", "is", null);

    if (!workspaces?.length) {
      return NextResponse.json({ synced: 0, message: "No workspaces with team config" });
    }

    let totalFiles = 0;
    for (const ws of workspaces) {
      try {
        const count = await discoverAndFanOut(
          admin, appUrl, cronSecret!,
          ws.id, ws.figma_team_id as string, ws.figma_pat as string,
        );
        totalFiles += count;
      } catch (e) {
        console.error("[pull] cron workspace error", ws.id, e);
      }
    }
    return NextResponse.json({ ok: true, filesQueued: totalFiles });
  }

  // ── Authenticated user pull ────────────────────────────────────────────────
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: member } = await admin
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", user.id)
    .single();

  if (!member) return NextResponse.json({ error: "No workspace found" }, { status: 404 });
  const workspaceId = (member as { workspace_id: string }).workspace_id;

  // Atomic workspace-level cooldown: claim the sync slot by writing last_pull_at,
  // but only if the cooldown has elapsed. PostgreSQL re-evaluates the WHERE clause
  // after acquiring the row lock, so exactly one concurrent caller gets the row back.
  const PULL_COOLDOWN_MS = 45_000; // 45s — slightly under client INTERVAL_MS so legitimate syncs are never rejected
  const cooldownThreshold = new Date(Date.now() - PULL_COOLDOWN_MS).toISOString();

  const { data: claimed, error: claimError } = await admin
    .from("workspaces")
    .update({ last_pull_at: new Date().toISOString() })
    .eq("id", workspaceId)
    .not("figma_team_id", "is", null)
    .not("figma_pat", "is", null)
    .or(`last_pull_at.is.null,last_pull_at.lt.${cooldownThreshold}`)
    .select("figma_team_id, figma_pat")
    .maybeSingle();

  if (claimError) {
    console.error("[pull] workspace claim failed", claimError);
    return NextResponse.json({ error: "Sync unavailable" }, { status: 503 });
  }

  if (!claimed) {
    // 0 rows updated: either cooldown is active or workspace is not configured.
    // Check which to return the right message.
    const { data: ws } = await admin
      .from("workspaces")
      .select("figma_team_id, figma_pat")
      .eq("id", workspaceId)
      .single();

    if (!ws?.figma_team_id || !ws?.figma_pat) {
      return NextResponse.json(
        { error: "Figma Team ID and PAT must be configured in Integrations" },
        { status: 400 }
      );
    }

    return NextResponse.json({ ok: true, skipped: true, message: "Sync already in progress" });
  }

  const filesQueued = await discoverAndFanOut(
    admin, appUrl, cronSecret ?? "",
    workspaceId,
    claimed.figma_team_id as string,
    claimed.figma_pat as string,
  );

  return NextResponse.json({ ok: true, filesQueued });
}

/**
 * Phase 1: call Figma to discover all team files, upsert figma_files rows.
 * Phase 2: fire POST /api/figma-files/{id}/sync for each file (fire-and-forget).
 * Returns the number of files queued.
 */
async function discoverAndFanOut(
  admin: ReturnType<typeof createAdminClient>,
  appUrl: string,
  cronSecret: string,
  workspaceId: string,
  teamId: string,
  pat: string,
): Promise<number> {
  const files = await listTeamFiles(teamId, pat);
  console.log(`[pull] workspace=${workspaceId} discovered ${files.length} files`);

  let fileIndex = 0;
  for (const file of files) {
    // Upsert project
    const projectId = await ensureProject(admin, workspaceId, file.projectName);

    // Upsert figma_file row (insert if new, update name/pat if existing)
    const { data: existing } = await admin
      .from("figma_files")
      .select("id")
      .eq("figma_file_key", file.key)
      .eq("workspace_id", workspaceId)
      .maybeSingle();

    let figmaFileId: string;
    if (existing) {
      figmaFileId = (existing as { id: string }).id;
      await admin.from("figma_files")
        .update({ name: file.name, figma_pat: pat, project_id: projectId })
        .eq("id", figmaFileId);
    } else {
      const { data: created } = await admin
        .from("figma_files")
        .insert({
          workspace_id: workspaceId,
          project_id: projectId,
          name: file.name,
          figma_file_key: file.key,
          figma_pat: pat,
          sync_status: "idle",
        })
        .select("id")
        .single();
      if (!created) continue;
      figmaFileId = (created as { id: string }).id;
    }

    // Fire per-file sync independently (each gets its own 10s budget).
    // Stagger by 2s per file to avoid Figma rate limits from concurrent requests.
    const delayMs = fileIndex * 2000;
    setTimeout(() => {
      fetch(`${appUrl}/api/figma-files/${figmaFileId}/sync`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(cronSecret ? { authorization: `Bearer ${cronSecret}` } : {}),
        },
      }).catch(e => console.warn(`[pull] fire-and-forget sync failed for ${file.name}:`, e));
    }, delayMs);

    fileIndex++;
  }
  return files.length;
}

async function ensureProject(
  admin: ReturnType<typeof createAdminClient>,
  workspaceId: string,
  projectName: string,
): Promise<string> {
  const { data: existing } = await admin
    .from("projects")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("name", projectName)
    .maybeSingle();

  if (existing) return (existing as { id: string }).id;

  const { data: created } = await admin
    .from("projects")
    .insert({ workspace_id: workspaceId, name: projectName })
    .select("id")
    .single();

  return (created as { id: string }).id;
}
