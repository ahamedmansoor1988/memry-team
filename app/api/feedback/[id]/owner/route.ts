/**
 * PATCH /api/feedback/:id/owner
 *
 * Manually assign (or clear) the owner of a feedback item.
 * Body: { owner_profile_id?: string; owner_name?: string }
 * Returns: { ok: true }
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json() as { owner_profile_id?: string | null; owner_name?: string | null };

  const admin = createAdminClient();

  // Read current status to decide whether to stamp waiting_since
  const { data: current } = await admin
    .from("feedback_items")
    .select("status")
    .eq("id", id)
    .single();

  const isActive =
    current &&
    ((current as { status: string }).status === "open" ||
      (current as { status: string }).status === "needs_decision");

  await admin
    .from("feedback_items")
    .update({
      owner_profile_id: body.owner_profile_id ?? null,
      owner_name:       body.owner_name ?? null,
      ownership_source: "manual",
      ...(isActive ? { waiting_since: new Date().toISOString() } : {}),
    })
    .eq("id", id);

  return NextResponse.json({ ok: true });
}
