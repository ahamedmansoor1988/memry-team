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
  const payload = JSON.parse(params.get("payload") ?? "{}") as any;

  if (payload.type !== "block_actions") return NextResponse.json({ ok: true });

  const action   = payload.actions?.[0];
  const threadId = action?.value as string | undefined;

  if (action?.action_id === "mark_clear" && threadId) {
    const admin = createAdminClient();
    await admin
      .from("threads")
      .update({ classification: "question" })
      .eq("id", threadId);

    // Acknowledge to Slack (replace message)
    const responseUrl = payload.response_url as string;
    if (responseUrl) {
      await fetch(responseUrl, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          replace_original: true,
          text: "✅ Marked as clear — Memry will re-classify on the next update.",
        }),
      });
    }
  }

  return NextResponse.json({ ok: true });
}
