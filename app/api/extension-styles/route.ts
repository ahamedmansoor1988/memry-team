import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function supabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// Extension POSTs styles here after extracting from active tab
export async function POST(req: NextRequest) {
  const { url, styles } = await req.json();
  if (!url || !Array.isArray(styles)) {
    return NextResponse.json({ error: "url and styles required" }, { status: 400 });
  }

  const { error } = await supabaseAdmin()
    .from("extension_styles")
    .upsert({ url, styles, captured_at: new Date().toISOString() }, { onConflict: "url" });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, count: styles.length });
}

// Loupe app GETs styles by URL
export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url");
  if (!url) return NextResponse.json({ error: "url required" }, { status: 400 });

  const { data, error } = await supabaseAdmin()
    .from("extension_styles")
    .select("styles, captured_at")
    .eq("url", url)
    .single();

  if (error) return NextResponse.json({ styles: [] });
  return NextResponse.json(data);
}
