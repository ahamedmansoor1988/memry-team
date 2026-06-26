import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function supabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

// POST — store styles under a session key
export async function POST(req: NextRequest) {
  const { styles, sessionKey } = await req.json() as {
    styles: Array<{ text: string; fontFamily: string; fontSize: string; fontWeight: string; color: string | null }>;
    sessionKey: string;
  };

  if (!sessionKey || !Array.isArray(styles)) {
    return NextResponse.json({ error: "sessionKey and styles are required" }, { status: 400 });
  }

  const db = supabaseAdmin();
  const { error } = await db
    .from("live_style_sessions")
    .upsert({ session_key: sessionKey, styles }, { onConflict: "session_key" });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, sessionKey });
}

// GET — retrieve styles for a session key
export async function GET(req: NextRequest) {
  const sessionKey = req.nextUrl.searchParams.get("sessionKey");
  if (!sessionKey) return NextResponse.json({ error: "sessionKey is required" }, { status: 400 });

  const db = supabaseAdmin();
  const { data, error } = await db
    .from("live_style_sessions")
    .select("styles, created_at")
    .eq("session_key", sessionKey)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Session not found" }, { status: 404 });

  return NextResponse.json({ styles: data.styles, createdAt: data.created_at });
}
