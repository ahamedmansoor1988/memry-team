import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import crypto from "crypto";

function verifySlackSignature(secret: string, sig: string, ts: string, body: string): boolean {
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;
  const expected = "v0=" + crypto.createHmac("sha256", secret).update(`v0:${ts}:${body}`).digest("hex");
  try { return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig)); } catch { return false; }
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const sig  = req.headers.get("x-slack-signature")         ?? "";
  const ts   = req.headers.get("x-slack-request-timestamp") ?? "";
  const secret = process.env.SLACK_SIGNING_SECRET ?? "";

  if (secret && !verifySlackSignature(secret, sig, ts, rawBody)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const params  = new URLSearchParams(rawBody);
  const teamId  = params.get("team_id")   ?? "";
  const text    = (params.get("text") ?? "").trim();

  const admin = createAdminClient();

  // Look up workspace by Slack team ID
  const { data: ws } = await admin
    .from("workspaces")
    .select("id")
    .eq("slack_team_id", teamId)
    .maybeSingle();

  if (!ws) {
    return NextResponse.json({ response_type: "ephemeral", text: "Memry isn't connected to this workspace yet." });
  }

  const workspaceId = (ws as any).id as string;
  const query       = text.replace(/^ask\s*/i, "").trim();

  if (!query) {
    return NextResponse.json({
      response_type: "ephemeral",
      text: "Usage: `/memry ask <your question>` — e.g. `/memry ask what was decided about the API?`",
    });
  }

  // Search decisions by keyword match on what/why fields
  const { data: decisions } = await admin
    .from("decisions")
    .select("what, why, who, thread_id, threads(title, source, source_url, created_at)")
    .eq("workspace_id", workspaceId)
    .or(`what.ilike.%${query}%,why.ilike.%${query}%`)
    .order("created_at", { ascending: false })
    .limit(5);

  const appUrl = process.env.APP_URL ?? "https://memry-team-opal.vercel.app";

  if (!decisions?.length) {
    return NextResponse.json({
      response_type: "ephemeral",
      text: `No decisions found matching _"${query}"_.`,
    });
  }

  const blocks: any[] = [
    {
      type: "section",
      text: { type: "mrkdwn", text: `*Decisions matching "${query}":*` },
    },
    { type: "divider" },
  ];

  for (const d of decisions) {
    const thread = (d as any).threads as any;
    const url    = `${appUrl}/threads/${d.thread_id}`;
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*${thread?.title ?? "Untitled"}*\n${d.what}${d.who ? `\n_by ${d.who}_` : ""}`,
      },
      accessory: {
        type: "button",
        text: { type: "plain_text", text: "View →" },
        url,
        action_id: "view_thread",
      },
    });
  }

  return NextResponse.json({ response_type: "ephemeral", blocks });
}
