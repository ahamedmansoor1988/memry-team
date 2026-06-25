import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { processSyncEvent } from "@/lib/sync-engine";

async function refreshJiraToken(refreshToken: string): Promise<string | null> {
  const res = await fetch("https://auth.atlassian.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type:    "refresh_token",
      client_id:     process.env.JIRA_CLIENT_ID!,
      client_secret: process.env.JIRA_CLIENT_SECRET!,
      refresh_token: refreshToken,
    }),
  });
  if (!res.ok) return null;
  const data = await res.json() as { access_token?: string };
  return data.access_token ?? null;
}

export async function GET(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();

  const { data: workspaces } = await admin
    .from("workspaces")
    .select("id, jira_access_token, jira_refresh_token, jira_cloud_id")
    .not("jira_access_token", "is", null)
    .not("jira_cloud_id", "is", null);

  if (!workspaces?.length) return NextResponse.json({ polled: 0 });

  let totalNew = 0;

  for (const ws of workspaces) {
    let { jira_access_token: token, jira_refresh_token: refreshToken, jira_cloud_id: cloudId } = ws as any;
    const workspaceId = (ws as any).id;

    try {
      // Search issues updated in last 25h
      const jql         = "updated >= -25h ORDER BY updated DESC";
      const searchUrl   = `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/search/jql`;
      let searchRes     = await fetch(`${searchUrl}?jql=${encodeURIComponent(jql)}&fields=summary,comment&maxResults=50`, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      });

      // Refresh token if expired
      if (searchRes.status === 401 && refreshToken) {
        const newToken = await refreshJiraToken(refreshToken);
        if (newToken) {
          token = newToken;
          await admin.from("workspaces").update({ jira_access_token: newToken }).eq("id", workspaceId);
          searchRes = await fetch(`${searchUrl}?jql=${encodeURIComponent(jql)}&fields=summary,comment&maxResults=50`, {
            headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
          });
        }
      }

      if (!searchRes.ok) {
        console.error("[jira-poll] search failed:", workspaceId, searchRes.status, await searchRes.text());
        continue;
      }

      const searchData = await searchRes.json() as { issues: any[] };
      const since      = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();

      for (const issue of searchData.issues ?? []) {
        const issueKey  = issue.key as string;
        const summary   = issue.fields?.summary ?? null;
        const sourceUrl = `https://${cloudId}.atlassian.net/browse/${issueKey}`;
        const comments  = issue.fields?.comment?.comments ?? [];

        for (const comment of comments) {
          if (comment.created < since && comment.updated < since) continue;

          const body = typeof comment.body === "string"
            ? comment.body
            : comment.body?.content?.map((b: any) =>
                b.content?.map((c: any) => c.text ?? "").join("") ?? ""
              ).join("\n") ?? "";

          const eventType = comment.created >= since ? "created" : "edited";

          void processSyncEvent({
            event_type:        eventType,
            workspace_id:      workspaceId,
            source:            "jira",
            source_thread_id:  issueKey,
            source_comment_id: String(comment.id),
            title:             summary,
            source_url:        sourceUrl,
            author_name:       comment.author?.displayName  ?? null,
            author_email:      comment.author?.emailAddress ?? null,
            body,
            created_at:        comment.created,
          }).catch(err => console.error("[jira-poll] process error:", err));

          totalNew++;
        }
      }

      await admin
        .from("workspaces")
        .update({ last_jira_webhook_at: new Date().toISOString() })
        .eq("id", workspaceId);

    } catch (err) {
      console.error("[jira-poll] workspace error:", workspaceId, err);
    }
  }

  return NextResponse.json({ polled: workspaces.length, new_comments: totalNew });
}
