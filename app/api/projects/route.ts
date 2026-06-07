import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";

async function getWorkspaceId(admin: ReturnType<typeof createAdminClient>, userId: string) {
  const { data } = await admin
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", userId)
    .limit(1)
    .single();
  return data?.workspace_id as string | null;
}

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const wsId = await getWorkspaceId(admin, user.id);
  if (!wsId) return NextResponse.json({ projects: [] });

  const { data: projects } = await admin
    .from("projects")
    .select("*, figma_files(id, name, figma_file_key, sync_status, last_synced_at)")
    .eq("workspace_id", wsId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  if (!projects?.length) return NextResponse.json({ projects: [] });

  // Attach feedback stats per project
  const { data: stats } = await admin
    .from("feedback_items")
    .select("project_id, status, ai_classification, ai_vague_flag, created_at")
    .eq("workspace_id", wsId)
    .is("deleted_at", null);

  const projectsWithStats = projects.map(p => {
    const items = (stats ?? []).filter(s => s.project_id === p.id);
    return {
      ...p,
      stats: {
        total: items.length,
        needs_decision: items.filter(i => i.ai_classification === "Needs Decision" || i.ai_classification === "Blocked").length,
        open: items.filter(i => i.status === "open").length,
        vague: items.filter(i => i.ai_vague_flag).length,
        resolved: items.filter(i => i.status === "resolved").length,
        last_activity: items.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0]?.created_at ?? null,
      },
    };
  });

  return NextResponse.json({ projects: projectsWithStats });
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { name } = await req.json() as { name: string };
  if (!name?.trim()) return NextResponse.json({ error: "Name required" }, { status: 400 });

  const admin = createAdminClient();
  const wsId = await getWorkspaceId(admin, user.id);
  if (!wsId) return NextResponse.json({ error: "No workspace" }, { status: 400 });

  const { data: project, error } = await admin
    .from("projects")
    .insert({ workspace_id: wsId, name: name.trim() })
    .select()
    .single();

  if (error) return NextResponse.json({ error: "Failed to create project" }, { status: 500 });

  return NextResponse.json({ project });
}

export async function DELETE(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await req.json() as { id: string };
  const admin = createAdminClient();
  const wsId = await getWorkspaceId(admin, user.id);
  if (!wsId) return NextResponse.json({ error: "No workspace" }, { status: 400 });

  // Soft-delete: stamp deleted_at rather than hard-deleting so linked
  // feedback_items, decisions, and history records are preserved.
  await admin
    .from("projects")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id)
    .eq("workspace_id", wsId);
  return NextResponse.json({ ok: true });
}
