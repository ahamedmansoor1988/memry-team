import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { processSyncEvent } from "@/lib/sync-engine";

interface FigmaProject { id: string; name: string }
interface FigmaFile    { key: string; name: string }
interface FigmaComment {
  id: string;
  message: string;
  created_at: string;
  resolved_at: string | null;
  parent_id: string | null;
  user: { handle: string; email?: string };
}

async function figmaGet<T>(pat: string, path: string): Promise<T | null> {
  const res = await fetch(`https://api.figma.com/v1${path}`, {
    headers: { "X-Figma-Token": pat },
  });
  if (!res.ok) {
    console.error(`[figma-poll] GET ${path} failed:`, res.status, await res.text());
    return null;
  }
  return res.json() as T;
}

export async function GET(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();

  // All workspaces with Figma connected
  const { data: workspaces } = await admin
    .from("workspaces")
    .select("id, figma_pat, figma_team_id")
    .not("figma_pat", "is", null)
    .not("figma_team_id", "is", null);

  if (!workspaces?.length) return NextResponse.json({ polled: 0 });

  // Only process comments newer than 25h (cron runs daily, 1h overlap for safety)
  const since = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
  let totalNew = 0;

  for (const ws of workspaces) {
    const { id: workspaceId, figma_pat: pat, figma_team_id: teamId } = ws as any;
    try {
      // List projects in team
      const projectsData = await figmaGet<{ projects: FigmaProject[] }>(
        pat, `/teams/${teamId}/projects`,
      );
      if (!projectsData?.projects?.length) continue;

      for (const project of projectsData.projects) {
        // List files in project
        const filesData = await figmaGet<{ files: FigmaFile[] }>(
          pat, `/projects/${project.id}/files`,
        );
        if (!filesData?.files?.length) continue;

        for (const file of filesData.files) {
          // Fetch comments for file
          const commentsData = await figmaGet<{ comments: FigmaComment[] }>(
            pat, `/files/${file.key}/comments`,
          );
          if (!commentsData?.comments?.length) continue;

          for (const comment of commentsData.comments) {
            // Only process recent comments
            if (comment.created_at < since) continue;

            const sourceThreadId = `${file.key}:${comment.parent_id ?? comment.id}`;

            void processSyncEvent({
              event_type:        "created",
              workspace_id:      workspaceId,
              source:            "figma",
              source_thread_id:  sourceThreadId,
              source_comment_id: comment.id,
              title:             file.name,
              source_url:        `https://www.figma.com/file/${file.key}`,
              author_name:       comment.user.handle,
              author_email:      comment.user.email ?? null,
              body:              comment.message,
              created_at:        comment.created_at,
            }).catch(err => console.error("[figma-poll] process error:", err));

            totalNew++;
          }
        }
      }

      await admin
        .from("workspaces")
        .update({ last_figma_webhook_at: new Date().toISOString() })
        .eq("id", workspaceId);

    } catch (err) {
      console.error("[figma-poll] workspace error:", workspaceId, err);
    }
  }

  return NextResponse.json({ polled: workspaces.length, new_comments: totalNew });
}
