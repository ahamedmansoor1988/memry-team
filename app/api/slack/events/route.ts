/**
 * POST /api/slack/events
 * Handles Slack Event API (URL verification challenge + future events).
 */
import { NextRequest, NextResponse } from "next/server";
import { verifySlackSignature } from "@/lib/slack/bot";

interface SlackEvent {
  type: string;
  challenge?: string;
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();

  // Verify signature (skip for URL verification challenge)
  const body = JSON.parse(rawBody) as SlackEvent;
  if (body.type !== "url_verification") {
    const valid = await verifySlackSignature(req, rawBody);
    if (!valid) return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  // Respond to URL verification challenge
  if (body.type === "url_verification") {
    return NextResponse.json({ challenge: body.challenge });
  }

  return NextResponse.json({ ok: true });
}
