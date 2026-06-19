import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { processSyncEvent } from "@/lib/sync-engine";

const NOTION_VERSION = "2022-06-28";

async function notionGet<T>(token: string, path: string): Promise<T | null> {
  const res = await fetch(`https://api.notion.com/v1${path}`, {
    headers: {
      Authorization:    `Bearer ${token}`,
      "Notion-Version": NOTION_VERSION,
    },
  });
  if (!res.ok) {
    console.error(`[notion-poll] GET ${path} failed:`, res.status, await res.text());
    return null;
  }
  return res.json() as T;
}

async function notionPost<T>(token: string, path: string, body: object): Promise<T | null> {
  const res = await fetch(`https://api.notion.com/v1${path}`, {
    method: "POST",
    headers: {
      Authorization:    `Bearer ${token}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type":   "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    console.error(`[notion-poll] POST ${path} failed:`, res.status, await res.text());
    return null;
  }
  return res.json() as T;
}

export async function GET(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();

  const { data: workspaces } = await admin
    .from("workspaces")
    .select("id, notion_access_token")
    .not("notion_access_token", "is", null);

  if (!workspaces?.length) return NextResponse.json({ polled: 0 });

  const since = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
  let totalNew = 0;

  for (const ws of workspaces) {
    const { id: workspaceId, notion_access_token: token } = ws as any;
    try {
      // Search for all pages the integration has access to
      const searchData = await notionPost<{ results: any[] }>(token, "/search", {
        filter: { property: "object", value: "page" },
        sort:   { direction: "descending", timestamp: "last_edited_time" },
        page_size: 50,
      });
      if (!searchData?.results?.length) continue;

      for (const page of searchData.results) {
        // Skip pages not edited recently
        if (page.last_edited_time < since) continue;

        const pageId    = page.id as string;
        const pageTitle = page.properties?.title?.title?.[0]?.plain_text
          ?? page.properties?.Name?.title?.[0]?.plain_text
          ?? "Untitled";

        // Fetch comments on this page
        const commentsData = await notionGet<{ results: any[] }>(
          token, `/comments?block_id=${pageId}`,
        );
        if (!commentsData?.results?.length) continue;

        for (const comment of commentsData.results) {
          if (comment.created_time < since) continue;

          const richText  = comment.rich_text ?? [];
          const plainText = richText.map((rt: any) => rt.plain_text ?? "").join("");
          if (!plainText) continue;

          const threadId = comment.discussion_id ?? pageId;

          void processSyncEvent({
            event_type:        "created",
            workspace_id:      workspaceId,
            source:            "notion",
            source_thread_id:  threadId,
            source_comment_id: comment.id,
            title:             pageTitle,
            source_url:        `https://notion.so/${pageId.replace(/-/g, "")}`,
            author_name:       comment.created_by?.name ?? null,
            body:              plainText,
            created_at:        comment.created_time,
          }).catch(err => console.error("[notion-poll] process error:", err));

          totalNew++;
        }
      }

      await admin
        .from("workspaces")
        .update({ last_notion_webhook_at: new Date().toISOString() })
        .eq("id", workspaceId);

    } catch (err) {
      console.error("[notion-poll] workspace error:", workspaceId, err);
    }
  }

  return NextResponse.json({ polled: workspaces.length, new_comments: totalNew });
}
