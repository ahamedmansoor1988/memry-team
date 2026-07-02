import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const maxDuration = 120;

const RUN_MARKER_CATEGORY = "__run";

function supabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

async function figmaFetch(
  pat: string,
  path: string,
  opts: { method?: string; body?: string } = {},
): Promise<Response> {
  const { method = "GET", body } = opts;
  const reqId = Math.random().toString(36).slice(2, 10);

  async function doFetch(retried: boolean): Promise<Response> {
    const t0  = Date.now();
    const res = await fetch(`https://api.figma.com/v1${path}`, {
      method,
      headers: {
        "X-Figma-Token": pat,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body } : {}),
    });
    const ms = Date.now() - t0;
    const ra = res.headers.get("Retry-After");
    console.log(`[figma-publish] [${reqId}] ${method} ${path} → ${res.status} ${ms}ms${ra ? ` retry-after:${ra}s` : ""}`);

    if (res.status === 429) {
      if (retried) throw new Error(`Figma rate limit persists (Retry-After: ${ra ?? "unknown"}s).`);
      const waitSec = ra !== null ? parseInt(ra, 10) : 65;
      await new Promise(r => setTimeout(r, waitSec * 1_000));
      return doFetch(true);
    }
    return res;
  }

  return doFetch(false);
}

export async function POST(req: NextRequest) {
  let snapshotId: string, fileKey: string, nodeId: string, pat: string, assignTo: string | undefined;
  try {
    ({ snapshotId, fileKey, nodeId, pat, assignTo } = await req.json() as {
      snapshotId: string; fileKey: string; nodeId: string; pat: string; assignTo?: string;
    });
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!snapshotId || !fileKey || !nodeId || !pat) {
    return NextResponse.json({ error: "snapshotId, fileKey, nodeId, and pat are required" }, { status: 400 });
  }

  const db = supabaseAdmin();

  // Load snapshot metadata for frame bounds (used for comment positioning)
  const { data: snap } = await db
    .from("figma_snapshots")
    .select("frame_bounds, frame_name")
    .eq("id", snapshotId)
    .maybeSingle();

  const frameBounds = (snap?.frame_bounds as any) ?? { x: 0, y: 0, width: 800, height: 600 };

  // Load text nodes for comment position mapping
  const { data: textRows } = await db
    .from("snapshot_text")
    .select("node_id, content, bounds")
    .eq("snapshot_id", snapshotId);
  const textNodeMap = new Map<string, { content: string; bounds: any }>(
    (textRows ?? []).map(r => [r.content?.slice(0, 60) ?? "", { content: r.content ?? "", bounds: r.bounds }])
  );

  // Load unpublished issues for this snapshot
  const { data: issues, error: issuesErr } = await db
    .from("qa_issues")
    .select("id, element, category, issue, severity")
    .eq("snapshot_id", snapshotId)
    .neq("category", RUN_MARKER_CATEGORY)
    .is("figma_comment_id", null);

  if (issuesErr) return NextResponse.json({ error: issuesErr.message }, { status: 500 });
  if (!issues || issues.length === 0) {
    return NextResponse.json({ posted: 0, skipped: 0, message: "No unpublished issues to post." });
  }

  // Fetch existing comments for dedup
  let existingMessages = new Set<string>();
  try {
    const existingRes = await figmaFetch(pat, `/files/${fileKey}/comments`);
    if (existingRes.ok) {
      const existingData = await existingRes.json() as { comments: Array<{ message: string }> };
      existingMessages = new Set(existingData.comments.map(c => c.message));
    }
  } catch {}

  // Deduplicate issues by element + issue text (multiple runs create duplicates)
  const seenIssueKeys = new Set<string>();
  const dedupedIssues = issues.filter(issue => {
    const key = `${issue.element}||${issue.issue}`;
    if (seenIssueKeys.has(key)) return false;
    seenIssueKeys.add(key);
    return true;
  });

  // Group issues by element (one comment per element, listing all its issues)
  const groupedByElement = new Map<string, typeof issues>();
  for (const issue of dedupedIssues) {
    const key = issue.element.slice(0, 60);
    if (!groupedByElement.has(key)) groupedByElement.set(key, []);
    groupedByElement.get(key)!.push(issue);
  }

  let posted = 0;
  let skipped = 0;
  const updates: Array<{ id: string; figma_comment_id: string; published_at: string }> = [];

  for (const [elementText, items] of Array.from(groupedByElement.entries())) {
    // Find position from snapshot text nodes
    const textMatch = textNodeMap.get(elementText);
    const bbox      = textMatch?.bounds as any ?? null;
    const offsetX   = bbox ? Math.max(0, (bbox.x ?? 0) - (frameBounds.x ?? 0)) : 20;
    const offsetY   = bbox ? Math.max(0, (bbox.y ?? 0) - (frameBounds.y ?? 0)) : 20 + posted * 40;

    const severity  = items.some(d => d.severity === "high") ? "❌" : items.some(d => d.severity === "medium") ? "⚠️" : "ℹ️";
    const issueLines = items.map(d => `• ${(d.category ?? "issue").replace(/_/g, " ")}: ${d.issue}`).join("\n");
    const message   = `${severity} "${elementText}"\n\n${issueLines}`;

    if (existingMessages.has(message)) {
      for (const item of items) {
        updates.push({ id: item.id, figma_comment_id: "already-posted", published_at: new Date().toISOString() });
      }
      skipped++;
      continue;
    }

    try {
      const commentRes = await figmaFetch(pat, `/files/${fileKey}/comments`, {
        method: "POST",
        body:   JSON.stringify({ message, client_meta: { node_id: nodeId, node_offset: { x: offsetX, y: offsetY } } }),
      });

      if (commentRes.ok) {
        const cd = await commentRes.json() as { id?: string };
        const commentId = cd.id ?? `posted-${Date.now()}`;
        for (const item of items) {
          updates.push({ id: item.id, figma_comment_id: commentId, published_at: new Date().toISOString() });
        }
        posted++;
      }
    } catch {}

    await new Promise(r => setTimeout(r, 400));
  }

  // Post summary report comment if anything was posted
  if (posted > 0) {
    const byCategory = issues.reduce((acc, d) => {
      const cat = d.category ?? "other";
      acc[cat] = (acc[cat] ?? 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    const categoryLines = Object.entries(byCategory)
      .map(([cat, count]) => `  • ${count}× ${cat.replace(/_/g, " ")}`)
      .join("\n");
    const mentionLine   = assignTo ? `\nAssigned to: @${assignTo}` : "";
    const reportDate    = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    const reportMsg     = `📋 Loupe QA Report — ${reportDate}\n\n${issues.length} issue${issues.length !== 1 ? "s" : ""} found:\n${categoryLines}${mentionLine}\n\nSee individual comments on each element for details.`;

    if (!existingMessages.has(reportMsg)) {
      await figmaFetch(pat, `/files/${fileKey}/comments`, {
        method: "POST",
        body:   JSON.stringify({ message: reportMsg, client_meta: { node_id: nodeId, node_offset: { x: 0, y: 0 } } }),
      }).catch(() => {});
    }
  }

  // Persist comment IDs
  if (updates.length > 0) {
    await Promise.all(
      updates.map(u =>
        db.from("qa_issues").update({
          figma_comment_id: u.figma_comment_id,
          published_at:     u.published_at,
        }).eq("id", u.id)
      )
    );
  }

  return NextResponse.json({ posted, skipped, total: issues.length });
}
