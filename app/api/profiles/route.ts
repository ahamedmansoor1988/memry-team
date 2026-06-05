/**
 * GET  /api/profiles  — list all profiles for the workspace
 * PATCH /api/profiles — update a profile (Slack handle, display name, etc.)
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";

async function getWorkspaceId(userId: string, admin: ReturnType<typeof createAdminClient>) {
  const { data } = await admin
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", userId)
    .limit(1)
    .single();
  return (data as { workspace_id: string } | null)?.workspace_id ?? null;
}

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const wsId = await getWorkspaceId(user.id, admin);
  if (!wsId) return NextResponse.json({ error: "No workspace" }, { status: 400 });

  const { data: profiles, error } = await admin
    .from("profiles")
    .select("id, display_name, email, avatar_url, figma_handle, slack_handle, slack_user_id, figma_user_id, created_at")
    .eq("workspace_id", wsId)
    .order("display_name", { ascending: true });

  if (error) {
    console.error("[profiles] GET failed:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ profiles: profiles ?? [] });
}

export async function PATCH(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json() as {
    id: string;
    slack_handle?: string | null;
    slack_user_id?: string | null;
    display_name?: string;
  };

  if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const admin = createAdminClient();
  const wsId = await getWorkspaceId(user.id, admin);
  if (!wsId) return NextResponse.json({ error: "No workspace" }, { status: 400 });

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.slack_handle  !== undefined) patch.slack_handle  = body.slack_handle  ?? null;
  if (body.slack_user_id !== undefined) patch.slack_user_id = body.slack_user_id ?? null;
  if (body.display_name  !== undefined && body.display_name.trim()) {
    patch.display_name = body.display_name.trim();
  }

  const { data: profile, error } = await admin
    .from("profiles")
    .update(patch)
    .eq("id", body.id)
    .eq("workspace_id", wsId)   // security: only own workspace
    .select("id, display_name, email, avatar_url, figma_handle, slack_handle, slack_user_id, figma_user_id, created_at")
    .single();

  if (error) {
    console.error("[profiles] PATCH failed:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ profile });
}
