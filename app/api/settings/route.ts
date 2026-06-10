import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { validatePat, getFigmaMe } from "@/lib/figma/api";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const { data } = await admin
    .from("users")
    .select("figma_pat, figma_handle, figma_email")
    .eq("id", user.id)
    .single();

  const u = data as Record<string, string | null> | null;

  // Get workspace + members
  const { data: membership } = await admin
    .from("workspace_members")
    .select("workspace_id, role")
    .eq("user_id", user.id)
    .limit(1)
    .single();

  let members: { id: string; user_id: string; role: string; email?: string; full_name?: string }[] = [];
  if (membership) {
    const { data: memberRows } = await admin
      .from("workspace_members")
      .select("id, user_id, role")
      .eq("workspace_id", membership.workspace_id);

    if (memberRows && memberRows.length > 0) {
      void memberRows.map((m: { user_id: string }) => m.user_id);
      const { data: { users: authUsers } } = await admin.auth.admin.listUsers();
      const userMap = Object.fromEntries((authUsers ?? []).map((u: { id: string; email?: string; user_metadata?: { full_name?: string } }) => [u.id, u]));
      members = memberRows.map((m: { id: string; user_id: string; role: string }) => ({
        id: m.id,
        user_id: m.user_id,
        role: m.role,
        email: userMap[m.user_id]?.email,
        full_name: userMap[m.user_id]?.user_metadata?.full_name,
      }));
    }
  }

  const currentMembership = membership as { workspace_id: string; role?: string } | null;

  return NextResponse.json({
    figma_pat:       u?.figma_pat ? "set" : null,
    figma_handle:    u?.figma_handle ?? null,
    figma_email:     u?.figma_email ?? null,
    workspace_id:    currentMembership?.workspace_id ?? null,
    current_user_id: user.id,
    current_role:    currentMembership?.role ?? "member",
    members,
  });
}

export async function PATCH(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json() as { figma_pat?: string };
  const admin = createAdminClient();

  if (body.figma_pat !== undefined) {
    const pat = body.figma_pat.trim();

    // Validate PAT
    const valid = await validatePat(pat);
    if (!valid) {
      return NextResponse.json({ error: "Invalid Figma PAT — check token and scopes" }, { status: 400 });
    }

    // Fetch Figma identity
    const me = await getFigmaMe(pat);

    // Save to user row
    await admin.from("users").update({
      figma_pat: pat,
      figma_handle: me?.handle ?? null,
      figma_email: me?.email ?? null,
    }).eq("id", user.id);

    // Also update PAT on all workspace figma_files
    const { data: membership } = await admin
      .from("workspace_members")
      .select("workspace_id")
      .eq("user_id", user.id)
      .limit(1)
      .single();

    if (membership) {
      await admin
        .from("figma_files")
        .update({ figma_pat: pat })
        .eq("workspace_id", membership.workspace_id);
    }

    return NextResponse.json({ ok: true, figma_handle: me?.handle });
  }

  return NextResponse.json({ ok: true });
}
