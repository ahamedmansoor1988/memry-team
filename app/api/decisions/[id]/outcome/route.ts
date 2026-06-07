/**
 * PATCH /api/decisions/:id/outcome
 * Records what actually happened after a decision, and alternatives considered.
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json() as { outcome?: string; alternatives?: string[] };

  const admin = createAdminClient();

  const { data: membership } = await admin
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", user.id)
    .limit(1)
    .single();

  const workspaceId = (membership as { workspace_id: string } | null)?.workspace_id;
  if (!workspaceId) return NextResponse.json({ error: "No workspace" }, { status: 400 });

  const update: Record<string, unknown> = {
    outcome_recorded_at: new Date().toISOString(),
  };
  if (body.outcome      !== undefined) update.outcome      = body.outcome;
  if (body.alternatives !== undefined) update.alternatives = body.alternatives;

  const { error } = await admin
    .from("decisions")
    .update(update)
    .eq("id", id)
    .eq("workspace_id", workspaceId);

  if (error) {
    console.error("[outcome] update failed:", error.message);
    return NextResponse.json({ error: "Update failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
