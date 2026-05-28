import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization");

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://memry-team-opal.vercel.app";

  // Trigger team-based pull (Stage 01) — syncs all workspaces with team config
  const res = await fetch(`${appUrl}/api/figma/pull`, {
    method: "POST",
    headers: { authorization: `Bearer ${cronSecret}` },
  });

  const data = await res.json() as Record<string, unknown>;
  return NextResponse.json({ ok: res.ok, ...data });
}
