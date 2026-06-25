import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getWorkspace, WorkspaceRow } from "@/lib/workspace";
import { processSyncEvent } from "@/lib/sync-engine";

export const maxDuration = 60;

// ── Figma ──────────────────────────────────────────────────────────────────────

async function figmaGet<T>(pat: string, path: string): Promise<{ data: T | null; status: number }> {
  try {
    const res = await fetch(`https://api.figma.com/v1${path}`, {
      headers: { "X-Figma-Token": pat },
    });
    if (!res.ok) {
      console.error(`[sync/figma] GET ${path} → ${res.status}:`, await res.text());
      return { data: null, status: res.status };
    }
    return { data: await res.json() as T, status: res.status };
  } catch (e) {
    console.error(`[sync/figma] GET ${path} threw:`, e);
    return { data: null, status: 0 };
  }
}

function parseFigmaFileKeys(raw: string): string[] {
  return raw.split(/[\s,\n]+/).map(s => {
    // Extract key from full URL like figma.com/file/KEY/... or figma.com/design/KEY/...
    const m = s.match(/figma\.com\/(?:file|design)\/([A-Za-z0-9]+)/);
    return m ? m[1] : s.trim();
  }).filter(k => k.length > 4); // file keys are alphanumeric, >4 chars
}

async function syncFigma(ws: WorkspaceRow): Promise<{ synced: number; detail: string }> {
  if (!ws.figma_pat || !ws.figma_team_id) return { synced: 0, detail: "Not connected" };

  const raw      = ws.figma_team_id;
  const isTeamId = /^\d+$/.test(raw.trim());

  // ── File-key mode (non-Enterprise) ──────────────────────────────────────────
  if (!isTeamId) {
    const fileKeys = parseFigmaFileKeys(raw);
    if (!fileKeys.length) return { synced: 0, detail: "No valid file keys found in stored value" };

    let n = 0;
    for (const key of fileKeys) {
      const { data: cdata, status } = await figmaGet<{ comments: Array<{
        id: string; message: string; created_at: string;
        parent_id: string | null; user: { handle: string; email?: string };
      }> }>(ws.figma_pat, `/files/${key}/comments`);

      if (!cdata) { console.error(`[sync/figma] file ${key} returned ${status}`); continue; }

      for (const c of cdata.comments ?? []) {
        await processSyncEvent({
          event_type: "created", workspace_id: ws.id, source: "figma",
          source_thread_id:  `${key}:${c.parent_id ?? c.id}`,
          source_comment_id: c.id,
          title:             key,
          source_url:        `https://www.figma.com/file/${key}`,
          author_name:       c.user.handle,
          author_email:      c.user.email ?? null,
          body:              c.message,
          created_at:        c.created_at,
        });
        n++;
      }
    }
    return { synced: n, detail: `${fileKeys.length} files scanned` };
  }

  // ── Team mode (Enterprise) ────────────────────────────────────────────────
  const { data: proj, status: s1 } = await figmaGet<{ projects: Array<{ id: string; name: string }> }>(
    ws.figma_pat, `/teams/${raw.trim()}/projects`,
  );
  if (!proj) return { synced: 0, detail: `Teams API returned ${s1} — paste file URLs instead of a team ID` };
  if (!proj.projects?.length) return { synced: 0, detail: "No projects found in team" };

  let n = 0;
  for (const project of proj.projects) {
    const { data: filesData } = await figmaGet<{ files: Array<{ key: string; name: string }> }>(
      ws.figma_pat, `/projects/${project.id}/files`,
    );
    if (!filesData?.files?.length) continue;

    for (const file of filesData.files) {
      const { data: cdata } = await figmaGet<{ comments: Array<{
        id: string; message: string; created_at: string;
        parent_id: string | null; user: { handle: string; email?: string };
      }> }>(ws.figma_pat, `/files/${file.key}/comments`);
      if (!cdata?.comments?.length) continue;

      for (const c of cdata.comments) {
        await processSyncEvent({
          event_type: "created", workspace_id: ws.id, source: "figma",
          source_thread_id:  `${file.key}:${c.parent_id ?? c.id}`,
          source_comment_id: c.id,
          title:             file.name,
          source_url:        `https://www.figma.com/file/${file.key}`,
          author_name:       c.user.handle,
          author_email:      c.user.email ?? null,
          body:              c.message,
          created_at:        c.created_at,
        });
        n++;
      }
    }
  }
  return { synced: n, detail: `${proj.projects.length} projects scanned` };
}

// ── Jira ───────────────────────────────────────────────────────────────────────

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
  return ((await res.json()) as { access_token?: string }).access_token ?? null;
}

function jiraTextBody(body: unknown): string {
  if (typeof body === "string") return body;
  const b = body as any;
  return b?.content?.map((block: any) =>
    block.content?.map((c: any) => c.text ?? "").join("") ?? ""
  ).join("\n") ?? "";
}

async function syncJira(ws: WorkspaceRow): Promise<{ synced: number; detail: string }> {
  if (!ws.jira_access_token || !ws.jira_cloud_id) return { synced: 0, detail: "Not connected" };

  let token = ws.jira_access_token;
  const cloud = ws.jira_cloud_id;
  // Atlassian migrated /search → /search/jql
  const searchUrl = `https://api.atlassian.com/ex/jira/${cloud}/rest/api/3/search/jql`;
  const jql = `comment is not EMPTY ORDER BY updated DESC`;
  const qs  = `jql=${encodeURIComponent(jql)}&fields=summary,comment&maxResults=100`;

  let res = await fetch(`${searchUrl}?${qs}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });

  if (res.status === 401 && ws.jira_refresh_token) {
    const fresh = await refreshJiraToken(ws.jira_refresh_token);
    if (fresh) {
      token = fresh;
      const admin = createAdminClient();
      await admin.from("workspaces").update({ jira_access_token: fresh }).eq("id", ws.id);
      res = await fetch(`${searchUrl}?${qs}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      });
    }
  }

  if (!res.ok) {
    const txt = await res.text();
    console.error("[sync/jira] search failed:", res.status, txt);
    return { synced: 0, detail: `Jira API returned ${res.status}: ${txt.slice(0, 200)}` };
  }

  const data = await res.json() as { issues: any[]; total?: number };
  console.log(`[sync/jira] found ${data.issues?.length ?? 0} issues (total ${data.total})`);
  let n = 0;

  for (const issue of data.issues ?? []) {
    const sourceUrl = `https://${cloud}.atlassian.net/browse/${issue.key}`;
    for (const comment of issue.fields?.comment?.comments ?? []) {
      await processSyncEvent({
        event_type:        "created",
        workspace_id:      ws.id,
        source:            "jira",
        source_thread_id:  issue.key as string,
        source_comment_id: String(comment.id),
        title:             issue.fields?.summary ?? null,
        source_url:        sourceUrl,
        author_name:       comment.author?.displayName  ?? null,
        author_email:      comment.author?.emailAddress ?? null,
        body:              jiraTextBody(comment.body),
        created_at:        comment.created,
      });
      n++;
    }
  }
  return { synced: n, detail: `${data.issues?.length ?? 0} issues scanned` };
}

// ── Notion ─────────────────────────────────────────────────────────────────────

async function notionPost<T>(token: string, path: string, body: object): Promise<T | null> {
  const res = await fetch(`https://api.notion.com/v1${path}`, {
    method: "POST",
    headers: {
      Authorization:    `Bearer ${token}`,
      "Notion-Version": "2022-06-28",
      "Content-Type":   "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    console.error(`[sync/notion] POST ${path} → ${res.status}:`, await res.text());
    return null;
  }
  return res.json() as T;
}

async function notionGet<T>(token: string, path: string): Promise<T | null> {
  const res = await fetch(`https://api.notion.com/v1${path}`, {
    headers: {
      Authorization:    `Bearer ${token}`,
      "Notion-Version": "2022-06-28",
    },
  });
  if (!res.ok) {
    console.error(`[sync/notion] GET ${path} → ${res.status}:`, await res.text());
    return null;
  }
  return res.json() as T;
}

async function syncNotion(ws: WorkspaceRow): Promise<{ synced: number; detail: string }> {
  if (!ws.notion_access_token) return { synced: 0, detail: "Not connected" };

  const token = ws.notion_access_token;
  const pages = await notionPost<{ results: any[] }>(token, "/search", {
    filter:    { property: "object", value: "page" },
    sort:      { direction: "descending", timestamp: "last_edited_time" },
    page_size: 100,
  });

  if (!pages) return { synced: 0, detail: "Notion /search API failed" };
  if (!pages.results?.length) return {
    synced: 0,
    detail: "No pages found — make sure you've shared pages with the Memry integration in Notion",
  };

  let n = 0;
  for (const page of pages.results) {
    const pageId    = page.id as string;
    const pageTitle = page.properties?.title?.title?.[0]?.plain_text
      ?? page.properties?.Name?.title?.[0]?.plain_text
      ?? "Untitled";

    const comments = await notionGet<{ results: any[] }>(token, `/comments?block_id=${pageId}`);
    if (!comments?.results?.length) continue;

    for (const c of comments.results) {
      const text = (c.rich_text ?? []).map((rt: any) => rt.plain_text ?? "").join("");
      if (!text) continue;

      await processSyncEvent({
        event_type:        "created",
        workspace_id:      ws.id,
        source:            "notion",
        source_thread_id:  c.discussion_id ?? pageId,
        source_comment_id: c.id,
        title:             pageTitle,
        source_url:        `https://notion.so/${pageId.replace(/-/g, "")}`,
        author_name:       c.created_by?.name ?? null,
        body:              text,
        created_at:        c.created_time,
      });
      n++;
    }
  }
  return { synced: n, detail: `${pages.results.length} pages scanned` };
}

// ── Slack ──────────────────────────────────────────────────────────────────────

async function slackGet<T>(token: string, path: string): Promise<T> {
  const res = await fetch(`https://slack.com/api/${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.json() as T;
}

async function syncSlack(ws: WorkspaceRow): Promise<{ synced: number; detail: string }> {
  if (!ws.slack_bot_token) return { synced: 0, detail: "Not connected" };

  const token  = ws.slack_bot_token;
  const oldest = String(Math.floor((Date.now() - 90 * 24 * 60 * 60 * 1000) / 1000));

  // List public channels — bot can read history with channels:history even without being a member
  const chData = await slackGet<{ ok: boolean; channels: any[]; error?: string }>(
    token, "conversations.list?types=public_channel&limit=100&exclude_archived=true",
  );

  if (!chData.ok) {
    console.error("[sync/slack] conversations.list failed:", chData.error);
    return { synced: 0, detail: `conversations.list failed: ${chData.error}` };
  }
  if (!chData.channels?.length) return { synced: 0, detail: "No public channels found in workspace" };

  let n = 0;
  let channelsRead = 0;

  for (const ch of chData.channels.slice(0, 20)) {
    const hist = await slackGet<{ ok: boolean; messages: any[]; error?: string }>(
      token, `conversations.history?channel=${ch.id}&oldest=${oldest}&limit=200&inclusive=true`,
    );
    // not_in_channel or missing_scope — skip silently
    if (!hist.ok) {
      console.log(`[sync/slack] skipping ${ch.name}: ${hist.error}`);
      continue;
    }
    if (!hist.messages?.length) continue;
    channelsRead++;

    for (const msg of hist.messages) {
      if (msg.bot_id || msg.subtype || !msg.text?.trim()) continue;

      const ts             = msg.ts as string;
      const sourceThreadId = `${ch.id}:${ts}`;
      const createdAt      = new Date(Number(ts) * 1000).toISOString();

      await processSyncEvent({
        event_type: "created", workspace_id: ws.id, source: "slack",
        source_thread_id: sourceThreadId, source_comment_id: ts,
        author_name: msg.user ?? null, body: msg.text, created_at: createdAt,
      });
      n++;

      if (msg.reply_count > 0) {
        const thread = await slackGet<{ ok: boolean; messages: any[] }>(
          token, `conversations.replies?channel=${ch.id}&ts=${ts}&limit=100`,
        );
        if (thread.ok) {
          for (const reply of thread.messages.slice(1)) {
            if (reply.bot_id || !reply.text?.trim()) continue;
            await processSyncEvent({
              event_type: "created", workspace_id: ws.id, source: "slack",
              source_thread_id:  sourceThreadId,
              source_comment_id: reply.ts as string,
              author_name:       reply.user ?? null,
              body:              reply.text,
              created_at:        new Date(Number(reply.ts) * 1000).toISOString(),
            });
            n++;
          }
        }
      }
    }
  }

  const detail = channelsRead === 0
    ? `No readable channels — add the bot to channels with /invite @Memry`
    : `${channelsRead} channels read`;

  return { synced: n, detail };
}

// ── Route handler ──────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const ctx = await getWorkspace();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { source } = await req.json() as { source: string };
  const ws = ctx.workspace;

  try {
    let result: { synced: number; detail: string };

    if      (source === "figma")  result = await syncFigma(ws);
    else if (source === "jira")   result = await syncJira(ws);
    else if (source === "notion") result = await syncNotion(ws);
    else if (source === "slack")  result = await syncSlack(ws);
    else return NextResponse.json({ error: "Unknown source" }, { status: 400 });

    console.log(`[sync/${source}] done — synced: ${result.synced}, detail: ${result.detail}`);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[sync]", source, err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
