import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { name, workspaceName, figmaPat } = await req.json();
  const admin = createAdminClient();

  if (name?.trim()) {
    await admin.auth.admin.updateUserById(user.id, {
      user_metadata: { full_name: name.trim() },
    });
  }

  // Check if user already has a workspace
  const { data: existingMember } = await admin
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", user.id)
    .maybeSingle();

  let workspaceId: string;

  if (existingMember?.workspace_id) {
    workspaceId = existingMember.workspace_id;
  } else {
    const { data: workspace, error: wsErr } = await admin
      .from("workspaces")
      .insert({ name: workspaceName?.trim() || "My Workspace" })
      .select("id")
      .single();
    if (wsErr) return NextResponse.json({ error: "Workspace failed: " + wsErr.message }, { status: 500 });

    const { error: memberErr } = await admin
      .from("workspace_members")
      .insert({ workspace_id: workspace.id, user_id: user.id, role: "owner" });
    if (memberErr) return NextResponse.json({ error: "Member failed: " + memberErr.message }, { status: 500 });

    workspaceId = workspace.id;
  }

  if (figmaPat?.trim()) {
    await admin
      .from("workspaces")
      .update({ figma_access_token: figmaPat.trim(), figma_connected_at: new Date().toISOString() })
      .eq("id", workspaceId);
  }

  return NextResponse.json({ ok: true });
}
