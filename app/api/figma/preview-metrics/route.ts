/**
 * GET /api/figma/preview-metrics
 * Returns preview generation stats for the current workspace.
 */
import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { getPreviewMetrics } from "@/lib/figma/enrich-previews";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const { data: member } = await admin
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", user.id)
    .single();

  if (!member) return NextResponse.json({ error: "No workspace" }, { status: 404 });
  const workspaceId = (member as { workspace_id: string }).workspace_id;

  const metrics = await getPreviewMetrics(workspaceId);
  return NextResponse.json(metrics);
}
