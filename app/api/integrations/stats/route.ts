/**
 * GET /api/integrations/stats
 * Sync statistics for the Integrations source cards: per-source totals
 * and last activity timestamps.
 */
import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const { data: membership } = await admin
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", user.id)
    .limit(1).single();

  const workspaceId = (membership as { workspace_id: string } | null)?.workspace_id;
  if (!workspaceId) return NextResponse.json({ error: "No workspace" }, { status: 404 });

  const [
    { count: figmaComments },
    { count: figmaFiles },
    { count: figmaDecisions },
    { count: risksDetected },
    { count: slackMessages },
    { count: slackDecisions },
    { data: latestFile },
    { data: lastSlackDecision },
  ] = await Promise.all([
    admin.from("figma_comments").select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId),
    admin.from("figma_files").select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId),
    admin.from("decisions").select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId).eq("source", "ai"),
    admin.from("feedback_items").select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId).eq("ai_risk_flag", true),
    admin.from("slack_processed_messages").select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId),
    admin.from("decisions").select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId).eq("source", "slack"),
    admin.from("figma_files").select("last_synced_at")
      .eq("workspace_id", workspaceId)
      .order("last_synced_at", { ascending: false }).limit(1).maybeSingle(),
    admin.from("decisions").select("created_at")
      .eq("workspace_id", workspaceId).eq("source", "slack")
      .order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);

  return NextResponse.json({
    figma: {
      files: figmaFiles ?? 0,
      comments: figmaComments ?? 0,
      decisions: figmaDecisions ?? 0,
      risks: risksDetected ?? 0,
      last_synced: (latestFile as { last_synced_at?: string | null } | null)?.last_synced_at ?? null,
    },
    slack: {
      messages: slackMessages ?? 0,
      decisions: slackDecisions ?? 0,
      last_activity: (lastSlackDecision as { created_at?: string } | null)?.created_at ?? null,
    },
  });
}
