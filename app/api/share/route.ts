import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get("slug");
  if (!slug) return NextResponse.json({ error: "missing slug" }, { status: 400 });

  let decoded: string;
  try {
    decoded = Buffer.from(slug, "base64url").toString("utf8");
  } catch {
    return NextResponse.json({ error: "invalid slug" }, { status: 400 });
  }

  const sep = decoded.lastIndexOf("||");
  if (sep === -1) return NextResponse.json({ error: "invalid slug" }, { status: 400 });
  const live_url = decoded.slice(0, sep);
  const minute   = decoded.slice(sep + 2); // "2025-06-27T12:34"

  const { data, error } = await supabase
    .from("qa_issues")
    .select("id, element, category, issue, severity, live_url, scanned_at")
    .eq("live_url", live_url)
    .gte("scanned_at", minute + ":00")
    .lte("scanned_at", minute + ":59")
    .order("scanned_at", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Deduplicate
  const seen = new Set<string>();
  const issues = (data ?? []).filter(row => {
    const key = `${row.element}||${row.issue}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const scanned_at = data?.[0]?.scanned_at ?? null;
  return NextResponse.json({ live_url, scanned_at, issues });
}
