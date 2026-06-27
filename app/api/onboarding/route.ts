import { NextRequest, NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/server";

function getAdminClient() {
  return createAdminClient();
}

export async function POST(req: NextRequest) {
  try {
    // 1. Verify JWT using anon key (confirmed correct)
    const token = req.headers.get("Authorization")?.replace("Bearer ", "");
    if (!token) return NextResponse.json({ error: "No token" }, { status: 401 });

    const anonClient = createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
    const { data: { user }, error: authErr } = await anonClient.auth.getUser(token);
    if (authErr || !user) {
      return NextResponse.json({ error: "Auth: " + (authErr?.message ?? "no user") }, { status: 401 });
    }

    // 2. Parse body
    const admin = getAdminClient();
    const body = await req.json();
    const workspaceName: string = body.workspaceName?.trim() || "My Workspace";
    const figmaPat: string = body.figmaPat?.trim() || "";

    // 3. Check existing workspace
    const { data: existing, error: existErr } = await admin
      .from("workspace_members")
      .select("workspace_id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (existErr) {
      return NextResponse.json({ error: "Lookup: " + existErr.message }, { status: 500 });
    }

    let workspaceId: string;

    if (existing?.workspace_id) {
      workspaceId = existing.workspace_id;
    } else {
      // 4a. Create workspace
      const { data: ws, error: wsErr } = await admin
        .from("workspaces")
        .insert({ name: workspaceName })
        .select("id")
        .single();
      if (wsErr) return NextResponse.json({ error: "Workspace: " + wsErr.message }, { status: 500 });

      // 4b. Add member
      const { error: memErr } = await admin
        .from("workspace_members")
        .insert({ workspace_id: ws.id, user_id: user.id, role: "owner" });
      if (memErr) return NextResponse.json({ error: "Member: " + memErr.message }, { status: 500 });

      workspaceId = ws.id;
    }

    // 5. Save Figma PAT
    if (figmaPat) {
      const { error: patErr } = await admin
        .from("workspaces")
        .update({ figma_access_token: figmaPat, figma_connected_at: new Date().toISOString() })
        .eq("id", workspaceId);
      if (patErr) return NextResponse.json({ error: "PAT: " + patErr.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: "Crash: " + String(e) }, { status: 500 });
  }
}
