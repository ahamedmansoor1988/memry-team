import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function supabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

const RUN_MARKER_CATEGORY = "__run";

export async function GET() {
  const { data, error } = await supabaseAdmin()
    .from("qa_issues")
    .select("id, element, category, issue, severity, live_url, scanned_at")
    .order("scanned_at", { ascending: false })
    .limit(1000);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Group by live_url + scanned_at (rounded to minute) to form runs
  const runMap = new Map<string, { live_url: string; scanned_at: string; issues: typeof data }>();
  for (const row of data ?? []) {
    const minute = row.scanned_at?.slice(0, 16) ?? "";
    const key = `${row.live_url}||${minute}`;
    if (!runMap.has(key)) runMap.set(key, { live_url: row.live_url, scanned_at: row.scanned_at, issues: [] });
    if (row.category !== RUN_MARKER_CATEGORY) runMap.get(key)!.issues.push(row);
  }

  // Deduplicate issues within each run
  const runs = Array.from(runMap.values()).map(run => ({
    ...run,
    issues: run.issues.filter((issue, idx, arr) =>
      arr.findIndex(i => i.element === issue.element && i.issue === issue.issue) === idx
    ),
  }));

  return NextResponse.json({ runs });
}
