import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const admin = createAdminClient();

  // Allow marking personal notifications AND workspace-level ones
  // (user_id null) belonging to the caller's workspace.
  const { data: membership } = await admin
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", user.id)
    .limit(1)
    .single();
  const workspaceId = (membership as { workspace_id: string } | null)?.workspace_id;

  const { data: notif } = await admin
    .from("notifications")
    .select("id, user_id, workspace_id")
    .eq("id", id)
    .single();

  const row = notif as { id: string; user_id: string | null; workspace_id: string } | null;
  const owned = row && (row.user_id === user.id || (row.user_id === null && row.workspace_id === workspaceId));
  if (!owned) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { error } = await admin
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
