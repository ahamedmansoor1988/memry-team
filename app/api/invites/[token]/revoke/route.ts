import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";

type Params = Promise<{ id: string }>;

export async function DELETE(_req: Request, { params }: { params: Params }) {
  const { id } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();

  const { data: membership } = await admin
    .from("workspace_members")
    .select("workspace_id, role")
    .eq("user_id", user.id)
    .limit(1)
    .single();

  const mem = membership as { workspace_id: string; role: string } | null;
  if (!mem) return NextResponse.json({ error: "No workspace" }, { status: 400 });
  if (mem.role !== "admin") return NextResponse.json({ error: "Admin only" }, { status: 403 });

  const { error } = await admin
    .from("workspace_invites")
    .delete()
    .eq("id", id)
    .eq("workspace_id", mem.workspace_id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
