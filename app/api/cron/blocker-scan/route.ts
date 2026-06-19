import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";

export async function GET(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin  = createAdminClient();
  const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

  // Blocker threads unresolved for 48+ hours
  const { data: blockers, error } = await admin
    .from("threads")
    .select("id, workspace_id, project_id, title, source, created_at")
    .eq("classification", "blocker")
    .in("status", ["open", "reopened"])
    .lt("created_at", cutoff);

  if (error) {
    console.error("[blocker-scan] query error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!blockers?.length) return NextResponse.json({ scanned: 0, notified: 0 });

  let notified = 0;

  for (const thread of blockers) {
    try {
      const t = thread as any;

      // Get workspace Slack token + default channel
      const { data: ws } = await admin
        .from("workspaces")
        .select("slack_bot_token, slack_channel_id")
        .eq("id", t.workspace_id)
        .maybeSingle();

      const workspace = ws as any;
      if (!workspace?.slack_bot_token) continue;

      // Try project channel first
      let channelId = workspace.slack_channel_id as string | null;
      if (t.project_id) {
        const { data: proj } = await admin
          .from("projects")
          .select("slack_channel_id")
          .eq("id", t.project_id)
          .maybeSingle();
        if ((proj as any)?.slack_channel_id) channelId = (proj as any).slack_channel_id;
      }
      if (!channelId) continue;

      const hoursBlocked = Math.round(
        (Date.now() - new Date(t.created_at).getTime()) / 3_600_000
      );
      const threadUrl = `https://memry.link/${t.id}`;
      const title     = t.title ?? "Untitled thread";

      await fetch("https://slack.com/api/chat.postMessage", {
        method:  "POST",
        headers: {
          Authorization:  `Bearer ${workspace.slack_bot_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          channel: channelId,
          text:    `⚠️ *Still blocked* — "${title}" has been blocked for ${hoursBlocked}h. <${threadUrl}|View context →>`,
        }),
      });

      notified++;
    } catch (err) {
      console.error("[blocker-scan] notify error for thread:", (thread as any).id, err);
    }
  }

  return NextResponse.json({ scanned: blockers.length, notified });
}
