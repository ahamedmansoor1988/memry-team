import { NextRequest, NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/server";

function getAdminClient() {
  return createAdminClient();
}

export async function POST(req: NextRequest) {
  try {
    console.log("STEP 1 - Parse token");
    const token = req.headers.get("Authorization")?.replace("Bearer ", "");
    if (!token) return NextResponse.json({ error: "No token" }, { status: 401 });
    console.log("STEP 1 OK - token length:", token.length);

    console.log("STEP 2 - Create anon client");
    console.log("STEP 2 URL:", process.env.NEXT_PUBLIC_SUPABASE_URL?.slice(0, 30));
    console.log("STEP 2 ANON KEY prefix:", process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.slice(0, 10));
    const anonClient = createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
    console.log("STEP 2 OK");

    console.log("STEP 3 - Verify JWT via anon client");
    const { data: { user }, error: authErr } = await anonClient.auth.getUser(token);
    if (authErr || !user) {
      console.log("STEP 3 FAIL:", authErr);
      return NextResponse.json({ error: "Auth: " + (authErr?.message ?? "no user") }, { status: 401 });
    }
    console.log("STEP 3 OK - user:", user.id);

    console.log("STEP 4 - Create admin client");
    console.log("STEP 4 SERVICE_ROLE prefix:", process.env.SUPABASE_SERVICE_ROLE_KEY?.slice(0, 10));
    const admin = getAdminClient();
    console.log("STEP 4 OK");

    console.log("STEP 5 - Parse body");
    const body = await req.json();
    const workspaceName: string = body.workspaceName?.trim() || "My Workspace";
    const figmaPat: string = body.figmaPat?.trim() || "";
    console.log("STEP 5 OK - workspaceName:", workspaceName, "hasPAT:", !!figmaPat);

    console.log("STEP 6 - Lookup existing workspace");
    const { data: existing, error: existErr } = await admin
      .from("workspace_members")
      .select("workspace_id")
      .eq("user_id", user.id)
      .maybeSingle();
    if (existErr) {
      console.log("STEP 6 FAIL:", JSON.stringify(existErr));
      return NextResponse.json({ error: "Lookup: " + existErr.message }, { status: 500 });
    }
    console.log("STEP 6 OK - existing:", existing);

    let workspaceId: string;

    if (existing?.workspace_id) {
      workspaceId = existing.workspace_id;
      console.log("STEP 7 - Skipping create, using existing:", workspaceId);
    } else {
      console.log("STEP 7 - Create workspace");
      const { data: ws, error: wsErr } = await admin
        .from("workspaces")
        .insert({ name: workspaceName })
        .select("id")
        .single();
      if (wsErr) {
        console.log("STEP 7a FAIL:", JSON.stringify(wsErr));
        return NextResponse.json({ error: "Workspace: " + wsErr.message }, { status: 500 });
      }
      console.log("STEP 7a OK - workspace:", ws.id);

      console.log("STEP 7b - Add member");
      const { error: memErr } = await admin
        .from("workspace_members")
        .insert({ workspace_id: ws.id, user_id: user.id, role: "owner" });
      if (memErr) {
        console.log("STEP 7b FAIL:", JSON.stringify(memErr));
        return NextResponse.json({ error: "Member: " + memErr.message }, { status: 500 });
      }
      console.log("STEP 7b OK");
      workspaceId = ws.id;
    }

    if (figmaPat) {
      console.log("STEP 8 - Save Figma PAT to workspace:", workspaceId);
      const { error: patErr } = await admin
        .from("workspaces")
        .update({ figma_access_token: figmaPat, figma_connected_at: new Date().toISOString() })
        .eq("id", workspaceId);
      if (patErr) {
        console.log("STEP 8 FAIL:", JSON.stringify(patErr));
        return NextResponse.json({ error: "PAT: " + patErr.message }, { status: 500 });
      }
      console.log("STEP 8 OK");
    }

    console.log("STEP 9 - Success");
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.log("CRASH:", e);
    return NextResponse.json({ error: "Crash: " + String(e) }, { status: 500 });
  }
}
