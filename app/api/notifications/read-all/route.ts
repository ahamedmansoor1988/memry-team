import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";

export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();

  const { data: membership } = await admin
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", user.id)
    .limit(1)
    .single();
  const workspaceId = (membership as { workspace_id: string } | null)?.workspace_id;

  let query = admin
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .is("read_at", null);

  // Personal + workspace-level (user_id null) notifications
  query = workspaceId
    ? query.eq("workspace_id", workspaceId).or(`user_id.eq.${user.id},user_id.is.null`)
    : query.eq("user_id", user.id);

  const { error } = await query;

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
