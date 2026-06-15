import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";

async function getWorkspaceId() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", user.id)
    .single();
  return (data as { workspace_id: string } | null)?.workspace_id ?? null;
}

// GET — list all channel→project mappings for the workspace
export async function GET() {
  const workspaceId = await getWorkspaceId();
  if (!workspaceId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("slack_channel_mappings")
    .select("id, slack_channel_id, slack_channel_name, project_id, projects(name)")
    .eq("workspace_id", workspaceId)
    .order("created_at");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ mappings: data ?? [] });
}

// POST — create or update a mapping { slack_channel_id, slack_channel_name?, project_id }
export async function POST(req: Request) {
  const workspaceId = await getWorkspaceId();
  if (!workspaceId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json() as { slack_channel_id?: string; slack_channel_name?: string; project_id?: string };
  const { slack_channel_id, slack_channel_name, project_id } = body;
  if (!slack_channel_id?.trim() || !project_id?.trim()) {
    return NextResponse.json({ error: "slack_channel_id and project_id are required" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("slack_channel_mappings")
    .upsert({
      workspace_id: workspaceId,
      slack_channel_id: slack_channel_id.trim(),
      slack_channel_name: slack_channel_name?.trim() ?? null,
      project_id: project_id.trim(),
    }, { onConflict: "workspace_id,slack_channel_id" })
    .select("id, slack_channel_id, slack_channel_name, project_id")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, mapping: data });
}

// DELETE — remove a mapping by id
export async function DELETE(req: Request) {
  const workspaceId = await getWorkspaceId();
  if (!workspaceId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await req.json() as { id?: string };
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const admin = createAdminClient();
  const { error } = await admin
    .from("slack_channel_mappings")
    .delete()
    .eq("id", id)
    .eq("workspace_id", workspaceId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
