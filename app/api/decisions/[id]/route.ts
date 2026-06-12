/**
 * GET /api/decisions/[id]
 * Full decision record for the Decision Detail screen: decision, rationale,
 * approval info, outcome, alternatives, evidence links and participants.
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const { data: membership } = await admin
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", user.id)
    .limit(1).single();

  const workspaceId = (membership as { workspace_id: string } | null)?.workspace_id;
  if (!workspaceId) return NextResponse.json({ error: "No workspace" }, { status: 404 });

  const { data: decision } = await admin
    .from("decisions")
    .select(`
      id, decision_text, reason, owner_name, owner_profile_id, source,
      decided_at, feedback_item_id, outcome, alternatives,
      slack_channel_name, slack_thread_url
    `)
    .eq("workspace_id", workspaceId)
    .eq("id", id)
    .maybeSingle();

  if (!decision) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const d = decision as {
    id: string; decision_text: string; reason: string | null;
    owner_name: string | null; owner_profile_id: string | null;
    source: string; decided_at: string; feedback_item_id: string | null;
    outcome: string | null; alternatives: string[] | null;
    slack_channel_id: string | null; slack_message_ts: string | null;
    slack_channel_name: string | null; slack_thread_url: string | null;
  };

  // ── Slack discussion: fetch the actual thread so the decision shows its
  //    full context (original message, replies, who said what) ──────────────
  let slackMessages: { author: string; text: string; ts: string }[] = [];
  if (d.source === "slack" && d.slack_channel_id && d.slack_message_ts) {
    const { data: ws } = await admin
      .from("workspaces")
      .select("slack_bot_token")
      .eq("id", workspaceId)
      .maybeSingle();
    const token = (ws as { slack_bot_token?: string | null } | null)?.slack_bot_token;

    if (token) {
      try {
        const url = new URL("https://slack.com/api/conversations.replies");
        url.searchParams.set("channel", d.slack_channel_id);
        url.searchParams.set("ts", d.slack_message_ts);
        url.searchParams.set("limit", "25");
        const res  = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        const data = await res.json() as {
          ok: boolean;
          messages?: { user?: string; bot_id?: string; text?: string; ts: string }[];
        };

        if (data.ok && data.messages?.length) {
          const human = data.messages.filter(m => m.user && !m.bot_id);
          const userIds = Array.from(new Set(human.map(m => m.user!)));
          const names: Record<string, string> = {};
          await Promise.all(userIds.map(async uid => {
            try {
              const r = await fetch(`https://slack.com/api/users.info?user=${uid}`, {
                headers: { Authorization: `Bearer ${token}` },
              });
              const j = await r.json() as {
                ok: boolean;
                user?: { real_name?: string; name?: string; profile?: { display_name?: string } };
              };
              names[uid] = (j.ok && (j.user?.profile?.display_name || j.user?.real_name || j.user?.name)) || "Unknown";
            } catch {
              names[uid] = "Unknown";
            }
          }));
          slackMessages = human.map(m => ({
            author: names[m.user!] ?? "Unknown",
            text:   m.text ?? "",
            ts:     m.ts,
          }));
        }
      } catch {
        // best-effort — page still renders without the thread
      }
    }
  }

  // Linked feedback item context (project, file, comment author, replies)
  let item: {
    id: string;
    title: string | null;
    project: { id: string; name: string } | null;
    file_name: string | null;
    author_name: string | null;
    reply_authors: string[];
    comment_count: number;
  } | null = null;

  if (d.feedback_item_id) {
    const { data: fi } = await admin
      .from("feedback_items")
      .select(`
        id, ai_key_question, ai_summary, project_id,
        project:projects!project_id(id, name),
        figma_comment:figma_comments!figma_comment_id(
          id, figma_comment_id, figma_file_id, author_name,
          figma_file:figma_files!figma_file_id(name)
        )
      `)
      .eq("id", d.feedback_item_id)
      .maybeSingle();

    if (fi) {
      const raw = fi as {
        id: string; ai_key_question: string | null; ai_summary: string | null;
        project_id: string | null;
        project: { id: string; name: string } | { id: string; name: string }[] | null;
        figma_comment:
          | { id: string; figma_comment_id: string; figma_file_id: string; author_name: string | null; figma_file: { name: string } | { name: string }[] | null }
          | { id: string; figma_comment_id: string; figma_file_id: string; author_name: string | null; figma_file: { name: string } | { name: string }[] | null }[]
          | null;
      };
      const project = raw.project ? (Array.isArray(raw.project) ? raw.project[0] : raw.project) : null;
      const comment = raw.figma_comment ? (Array.isArray(raw.figma_comment) ? raw.figma_comment[0] : raw.figma_comment) : null;
      const file    = comment?.figma_file ? (Array.isArray(comment.figma_file) ? comment.figma_file[0] : comment.figma_file) : null;

      // Replies → participants + evidence comment count
      let replyAuthors: string[] = [];
      let commentCount = 0;
      if (comment) {
        const { data: replies } = await admin
          .from("figma_comments")
          .select("author_name")
          .eq("figma_file_id", comment.figma_file_id)
          .eq("parent_figma_comment_id", comment.figma_comment_id);
        replyAuthors = Array.from(new Set(
          ((replies ?? []) as { author_name: string | null }[])
            .map(r => r.author_name)
            .filter((n): n is string => !!n)
        ));
        commentCount = (replies ?? []).length + 1;
      }

      item = {
        id: raw.id,
        title: raw.ai_key_question && raw.ai_key_question !== "None" ? raw.ai_key_question : raw.ai_summary,
        project,
        file_name: file?.name ?? null,
        author_name: comment?.author_name ?? null,
        reply_authors: replyAuthors,
        comment_count: commentCount,
      };
    }
  }

  const participants = Array.from(new Set([
    ...(d.owner_name ? [d.owner_name] : []),
    ...(item?.author_name ? [item.author_name] : []),
    ...(item?.reply_authors ?? []),
    ...slackMessages.map(m => m.author).filter(n => n !== "Unknown"),
  ]));

  return NextResponse.json({
    decision: {
      ...d,
      project: item?.project ?? null,
      file_name: item?.file_name ?? null,
      item_title: item?.title ?? null,
      participants,
      slack_messages: slackMessages,
      evidence: {
        figma_comments: item?.comment_count ?? 0,
        slack_thread: d.slack_thread_url,
        slack_channel: d.slack_channel_name,
        feedback_item_id: d.feedback_item_id,
        project_id: item?.project?.id ?? null,
      },
    },
  });
}
