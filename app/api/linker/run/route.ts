/**
 * POST /api/linker/run
 * Runs the Linker over unprocessed items (historical backfill + sweep).
 * Processes up to `limit` items per call, oldest first — call repeatedly
 * until `remaining` is 0. Auth: session user or x-cron-secret.
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { linkUnprocessed } from "@/lib/linker/linker";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const admin = createAdminClient();

  // Auth: cron secret (header) or logged-in user
  let workspaceId: string | null = null;
  const cronSecret = req.headers.get("x-cron-secret");
  if (cronSecret && cronSecret === process.env.CRON_SECRET) {
    const body = await req.json().catch(() => ({})) as { workspace_id?: string };
    workspaceId = body.workspace_id ?? null;
    if (!workspaceId) {
      // No workspace given — take the first one (single-tenant dogfood)
      const { data: ws } = await admin.from("workspaces").select("id").limit(1).maybeSingle();
      workspaceId = (ws as { id: string } | null)?.id ?? null;
    }
  } else {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { data: membership } = await admin
      .from("workspace_members")
      .select("workspace_id")
      .eq("user_id", user.id)
      .limit(1).single();
    workspaceId = (membership as { workspace_id: string } | null)?.workspace_id ?? null;
  }

  if (!workspaceId) return NextResponse.json({ error: "No workspace" }, { status: 404 });
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY is not configured — the Linker needs it for embeddings" },
      { status: 503 },
    );
  }

  const url   = new URL(req.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "15", 10) || 15, 40);

  const stats = await linkUnprocessed(workspaceId, limit);

  // How many are still waiting?
  const [{ count: itemCount }, { count: decisionCount }, { count: embeddedCount }] = await Promise.all([
    admin.from("feedback_items").select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId).is("deleted_at", null),
    admin.from("decisions").select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId),
    admin.from("item_embeddings").select("item_id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId),
  ]);
  const remaining = Math.max(0, (itemCount ?? 0) + (decisionCount ?? 0) - (embeddedCount ?? 0));

  return NextResponse.json({ ...stats, remaining });
}
