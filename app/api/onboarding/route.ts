import { NextRequest, NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

export async function POST(req: NextRequest) {
  try {
    const token = req.headers.get("Authorization")?.replace("Bearer ", "");
    if (!token) return NextResponse.json({ error: "No token" }, { status: 401 });

    // Verify token and get user
    const anonClient = createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
    const { data: { user }, error: authErr } = await anonClient.auth.getUser(token);
    if (authErr || !user) {
      return NextResponse.json({ error: "Auth failed: " + (authErr?.message ?? "no user") }, { status: 401 });
    }

    const { workspaceName, figmaPat } = await req.json();

    // Use user's own JWT so RLS applies correctly
    const db = createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { global: { headers: { Authorization: `Bearer ${token}` } } }
    );

    // Check if user already has a workspace
    const { data: existingMember } = await db
      .from("workspace_members")
      .select("workspace_id")
      .eq("user_id", user.id)
      .maybeSingle();

    let workspaceId: string;

    if (existingMember?.workspace_id) {
      workspaceId = existingMember.workspace_id;
    } else {
      const { data: workspace, error: wsErr } = await db
        .from("workspaces")
        .insert({ name: workspaceName?.trim() || "My Workspace" })
        .select("id")
        .single();

      if (wsErr) {
        return NextResponse.json({ error: "Workspace failed: " + wsErr.message + " | code: " + wsErr.code }, { status: 500 });
      }

      const { error: memberErr } = await db
        .from("workspace_members")
        .insert({ workspace_id: workspace.id, user_id: user.id, role: "owner" });

      if (memberErr) {
        return NextResponse.json({ error: "Member failed: " + memberErr.message + " | code: " + memberErr.code }, { status: 500 });
      }

      workspaceId = workspace.id;
    }

    if (figmaPat?.trim()) {
      const { error: patErr } = await db
        .from("workspaces")
        .update({ figma_access_token: figmaPat.trim(), figma_connected_at: new Date().toISOString() })
        .eq("id", workspaceId);

      if (patErr) {
        return NextResponse.json({ error: "PAT failed: " + patErr.message }, { status: 500 });
      }
    }

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return NextResponse.json({ error: "Uncaught: " + String(e) }, { status: 500 });
  }
}
