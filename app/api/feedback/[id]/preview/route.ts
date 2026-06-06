/**
 * GET /api/feedback/:id/preview
 *
 * Returns { preview_url: string | null } from the DB.
 * Thumbnails are now populated at sync time (lib/figma/team-sync.ts), so this
 * endpoint is a pure cache read — no Figma API calls, no rate-limit risk.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();

  const { data: item } = await admin
    .from("feedback_items")
    .select("preview_url")
    .eq("id", id)
    .single();

  if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({
    preview_url: (item as { preview_url: string | null }).preview_url ?? null,
  });
}
