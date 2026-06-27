import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { name, workspaceName, figmaPat } = await req.json();
  const admin = createAdminClient();

  await admin.auth.admin.updateUserById(user.id, {
    user_metadata: { full_name: name?.trim() },
  });

  const { data: workspace, error: wsErr } = await admin
    .from("workspaces")
    .insert({ name: workspaceName?.trim() })
    .select("id")
    .single();
  if (wsErr) return NextResponse.json({ error: "Workspace failed: " + wsErr.message }, { status: 500 });

  const { error: memberErr } = await admin
    .from("workspace_members")
    .insert({ workspace_id: workspace.id, user_id: user.id, role: "owner" });
  if (memberErr) return NextResponse.json({ error: "Member failed: " + memberErr.message }, { status: 500 });

  if (figmaPat?.trim()) {
    const { error: patErr } = await admin
      .from("workspaces")
      .update({ figma_access_token: figmaPat.trim(), figma_connected_at: new Date().toISOString() })
      .eq("id", workspace.id);
    if (patErr) return NextResponse.json({ error: "PAT failed: " + patErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
