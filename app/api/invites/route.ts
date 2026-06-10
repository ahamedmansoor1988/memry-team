import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";

// ── GET — list pending invites ────────────────────────────────────────────────
export async function GET() {
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

  if (!membership) return NextResponse.json({ error: "No workspace" }, { status: 400 });

  const { data: invites, error } = await admin
    .from("workspace_invites")
    .select("id, email, role, expires_at, created_at")
    .eq("workspace_id", (membership as { workspace_id: string; role: string }).workspace_id)
    .is("accepted_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ invites: invites ?? [] });
}

// ── POST — send invite ────────────────────────────────────────────────────────
export async function POST(req: Request) {
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

  const body = await req.json() as { email?: string; role?: string };
  const email = body.email?.trim().toLowerCase();
  const role  = body.role === "admin" ? "admin" : "member";

  if (!email) return NextResponse.json({ error: "Email required" }, { status: 400 });

  const workspaceId = mem.workspace_id;

  // Check if already a member via auth users list
  const { data: authUsers } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const existingUser = authUsers?.users?.find(u => u.email?.toLowerCase() === email);
  if (existingUser) {
    const { data: existingMember } = await admin
      .from("workspace_members")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("user_id", existingUser.id)
      .maybeSingle();
    if (existingMember) {
      return NextResponse.json({ error: "Already a member" }, { status: 400 });
    }
  }

  // Check for existing pending invite
  const { data: existing } = await admin
    .from("workspace_invites")
    .select("id")
    .eq("email", email)
    .eq("workspace_id", workspaceId)
    .is("accepted_at", null)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();

  if (existing) return NextResponse.json({ error: "Invite already sent" }, { status: 400 });

  // Insert invite
  const { data: invite, error: insertErr } = await admin
    .from("workspace_invites")
    .insert({ workspace_id: workspaceId, email, role, invited_by: user.id })
    .select("id, token")
    .single();

  if (insertErr || !invite) {
    return NextResponse.json({ error: insertErr?.message ?? "Failed to create invite" }, { status: 500 });
  }

  const inv = invite as { id: string; token: string };
  const inviteUrl = `${process.env.NEXT_PUBLIC_APP_URL}/invite/${inv.token}`;

  // Send email via Supabase if user doesn't have an account yet
  if (!existingUser) {
    try {
      await admin.auth.admin.inviteUserByEmail(email, {
        redirectTo: inviteUrl,
      });
    } catch {
      // Non-fatal — invite link still works
    }
  }

  return NextResponse.json({ ok: true, invite_id: inv.id, invite_url: inviteUrl });
}
