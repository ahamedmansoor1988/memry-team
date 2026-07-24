import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

// Hit daily by the Vercel cron in vercel.json. Supabase pauses free-tier
// projects after ~7 days without activity, which takes the whole site down
// (see the July 2026 outage) — a daily query keeps the project awake.
export async function GET() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { error } = await supabase
    .from("live_style_sessions")
    .select("id")
    .limit(1);

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, pingedAt: new Date().toISOString() });
}
