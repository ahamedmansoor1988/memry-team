/**
 * GET /api/people
 * Team members with contribution metrics: decisions owned, items authored,
 * distinct projects touched.
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
  if (!workspaceId) return NextResponse.json({ people: [] });

  const [{ data: profiles }, { data: decisions }, { data: items }] = await Promise.all([
    admin.from("profiles")
      .select("id, display_name, email, avatar_url, figma_handle, slack_handle, created_at")
      .eq("workspace_id", workspaceId)
      .order("display_name", { ascending: true }),
    admin.from("decisions")
      .select("owner_profile_id, owner_name")
      .eq("workspace_id", workspaceId),
    admin.from("feedback_items")
      .select("author_profile_id, owner_profile_id, project_id")
      .eq("workspace_id", workspaceId)
      .is("deleted_at", null),
  ]);

  type ProfileRow = {
    id: string; display_name: string; email: string | null;
    avatar_url: string | null; figma_handle: string | null;
    slack_handle: string | null; created_at: string;
  };
  type DecisionRow = { owner_profile_id: string | null; owner_name: string | null };
  type ItemRow = { author_profile_id: string | null; owner_profile_id: string | null; project_id: string | null };

  const people = ((profiles ?? []) as ProfileRow[]).map(p => {
    const myDecisions = ((decisions ?? []) as DecisionRow[]).filter(d =>
      d.owner_profile_id === p.id ||
      (!d.owner_profile_id && d.owner_name && d.owner_name === p.display_name)
    ).length;

    const authored = ((items ?? []) as ItemRow[]).filter(i => i.author_profile_id === p.id);
    const owned    = ((items ?? []) as ItemRow[]).filter(i => i.owner_profile_id === p.id);
    const projectIds = new Set(
      [...authored, ...owned].map(i => i.project_id).filter(Boolean)
    );

    return {
      id: p.id,
      display_name: p.display_name,
      email: p.email,
      avatar_url: p.avatar_url,
      figma_handle: p.figma_handle,
      slack_handle: p.slack_handle,
      decisions: myDecisions,
      contributions: authored.length + owned.length,
      projects: projectIds.size,
    };
  });

  return NextResponse.json({ people });
}
