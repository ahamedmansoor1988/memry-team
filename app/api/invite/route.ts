import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { email } = await req.json() as { email?: string };
  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: "Invalid email address" }, { status: 400 });
  }

  const admin = createAdminClient();

  // Get workspace
  const { data: membership } = await admin
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", user.id)
    .limit(1)
    .single();

  if (!membership) return NextResponse.json({ error: "No workspace found" }, { status: 404 });

  // Send magic link invite via Supabase Auth
  const { error } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/callback?next=/inbox`,
    data: {
      invited_to_workspace: membership.workspace_id,
    },
  });

  if (error) {
    // If user already exists, just add them to workspace
    if (error.message?.includes("already been registered")) {
      const { data: { users } } = await admin.auth.admin.listUsers();
      const existingUser = users.find(u => u.email === email);
      if (existingUser) {
        // Check if already a member
        const { data: existing } = await admin
          .from("workspace_members")
          .select("id")
          .eq("workspace_id", membership.workspace_id)
          .eq("user_id", existingUser.id)
          .single();

        if (!existing) {
          await admin.from("workspace_members").insert({
            workspace_id: membership.workspace_id,
            user_id: existingUser.id,
            role: "member",
          });
        }
        return NextResponse.json({ ok: true, message: "User added to workspace" });
      }
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
