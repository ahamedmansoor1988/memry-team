import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { normalizeNodes } from "@/lib/figma-normalize";
import { parseBrandGuide } from "@/lib/brand-guide";
import { checkBrandConsistency, type BrandFinding } from "@/lib/brand-check";
import { getValidFigmaAccessToken } from "@/lib/figma-oauth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

async function figmaFetch(accessToken: string, path: string): Promise<Response> {
  return fetch(`https://api.figma.com/v1${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

// One key per distinct violation, stable across runs — used to diff this
// scan's findings against last time's so only genuinely new ones get posted.
function findingKey(f: BrandFinding): string {
  return `${f.kind}:${f.value}`;
}

async function postFigmaComment(accessToken: string, fileKey: string, nodeId: string | null, message: string) {
  const body: Record<string, unknown> = { message };
  if (nodeId) body.client_meta = { node_id: nodeId, node_offset: { x: 0, y: 0 } };
  await fetch(`https://api.figma.com/v1/files/${fileKey}/comments`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => {});
}

interface WatchRow {
  id: string;
  user_id: string;
  file_key: string;
  node_id: string | null;
  label: string | null;
  brand_guide_text: string;
  last_findings: BrandFinding[];
}

export async function GET(req: NextRequest) {
  // Vercel sets this automatically for scheduled cron invocations when
  // CRON_SECRET is configured on the project — rejects anyone else hitting
  // this URL and triggering unattended Figma API calls / comment posts.
  const authHeader = req.headers.get("authorization");
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = admin();
  const { data: watches, error } = await db.from("brand_watches").select("*");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const results: Array<{ id: string; status: string; newIssues?: number }> = [];

  for (const watch of (watches ?? []) as WatchRow[]) {
    try {
      const accessToken = await getValidFigmaAccessToken(watch.user_id);
      if (!accessToken) {
        results.push({ id: watch.id, status: "skipped_not_connected" });
        continue;
      }

      const path = watch.node_id
        ? `/files/${watch.file_key}/nodes?ids=${encodeURIComponent(watch.node_id)}&depth=15`
        : `/files/${watch.file_key}?depth=15`;
      const res = await figmaFetch(accessToken, path);
      if (!res.ok) {
        results.push({ id: watch.id, status: `figma_error_${res.status}` });
        continue;
      }
      const data = await res.json();
      const rootDoc = watch.node_id ? data?.nodes?.[watch.node_id]?.document : data?.document;
      if (!rootDoc) {
        results.push({ id: watch.id, status: "frame_not_found" });
        continue;
      }

      const snapshot = normalizeNodes(rootDoc);
      const brand = parseBrandGuide(watch.brand_guide_text);
      const findings = checkBrandConsistency(snapshot, brand);

      const previousKeys = new Set((watch.last_findings ?? []).map(findingKey));
      const newFindings = findings.filter(f => !previousKeys.has(findingKey(f)));

      if (newFindings.length > 0) {
        const lines = newFindings.slice(0, 20).map(f =>
          `• ${f.kind}: ${f.value}${f.nearestMatch ? ` (nearest approved: ${f.nearestMatch})` : ""} — ${f.count}× found`
        ).join("\n");
        const message = `🔍 Loupe Brand Watch — ${newFindings.length} new issue${newFindings.length === 1 ? "" : "s"} since last check\n\n${lines}`;
        await postFigmaComment(accessToken, watch.file_key, watch.node_id, message);
      }

      await db.from("brand_watches").update({
        last_findings: findings,
        last_scanned_at: new Date().toISOString(),
      }).eq("id", watch.id);

      results.push({ id: watch.id, status: "ok", newIssues: newFindings.length });
    } catch (e) {
      results.push({ id: watch.id, status: `error: ${e instanceof Error ? e.message : String(e)}` });
    }
  }

  return NextResponse.json({ checkedAt: new Date().toISOString(), watches: results });
}
