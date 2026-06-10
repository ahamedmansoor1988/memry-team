import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";

type Params = Promise<{ token: string }>;

interface InviteRow {
  id:           string;
  workspace_id: string;
  email:        string;
  role:         string;
  expires_at:   string;
  invited_by:   string | null;
  workspace:    { name: string } | null;
}

// ── GET — get invite details (public) ────────────────────────────────────────
export async function GET(_req: Request, { params }: { params: Params }) {
  const { token } = await params;
  const admin = createAdminClient();

  const { data: invite } = await admin
    .from("workspace_invites")
    .select("id, workspace_id, email, role, expires_at, invited_by, workspace:workspaces(name)")
    .eq("token", token)
    .is("accepted_at", null)
    .gt("expires_at", new Date().toISOString())
    .single();

  if (!invite) {
    return NextResponse.json({ error: "Invalid or expired invite" }, { status: 404 });
  }

  const row = invite as unknown as InviteRow;

  // Get inviter name if available
  let inviter_name: string | null = null;
  if (row.invited_by) {
    const { data: authUser } = await admin.auth.admin.getUserById(row.invited_by);
    inviter_name = authUser?.user?.user_metadata?.full_name ?? authUser?.user?.email ?? null;
  }

  const ws = Array.isArray(row.workspace) ? row.workspace[0] : row.workspace;

  return NextResponse.json({
    workspace_name: ws?.name ?? "Unknown workspace",
    inviter_name,
    email:      row.email,
    role:       row.role,
    expires_at: row.expires_at,
  });
}

// ── POST — accept invite ──────────────────────────────────────────────────────
export async function POST(_req: Request, { params }: { params: Params }) {
  const { token } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();

  const { data: invite } = await admin
    .from("workspace_invites")
    .select("id, workspace_id, email, role")
    .eq("token", token)
    .is("accepted_at", null)
    .gt("expires_at", new Date().toISOString())
    .single();

  if (!invite) {
    return NextResponse.json({ error: "Invalid or expired invite" }, { status: 404 });
  }

  const row = invite as { id: string; workspace_id: string; email: string; role: string };

  if (user.email?.toLowerCase() !== row.email.toLowerCase()) {
    return NextResponse.json(
      { error: `This invite was sent to ${row.email}. Please log in with that email.` },
      { status: 403 }
    );
  }

  // Check if already a member
  const { data: existingMember } = await admin
    .from("workspace_members")
    .select("id")
    .eq("workspace_id", row.workspace_id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (existingMember) {
    await admin
      .from("workspace_invites")
      .update({ accepted_at: new Date().toISOString() })
      .eq("id", row.id);
    return NextResponse.json({ ok: true, already_member: true, workspace_id: row.workspace_id });
  }

  // Add to workspace
  await admin.from("workspace_members").insert({
    workspace_id: row.workspace_id,
    user_id:      user.id,
    role:         row.role,
  });

  // Mark accepted
  await admin
    .from("workspace_invites")
    .update({ accepted_at: new Date().toISOString() })
    .eq("id", row.id);

  return NextResponse.json({ ok: true, workspace_id: row.workspace_id });
}
