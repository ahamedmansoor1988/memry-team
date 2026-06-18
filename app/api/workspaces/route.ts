import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { name } = await req.json() as { name?: string };
  if (!name?.trim()) return NextResponse.json({ error: "Name required" }, { status: 400 });

  const admin = createAdminClient();

  const { data: existing } = await admin
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();

  if (existing) return NextResponse.json({ error: "Already in a workspace" }, { status: 400 });

  const slug =
    name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") +
    "-" + Math.random().toString(36).slice(2, 6);

  const { data: workspace, error } = await admin
    .from("workspaces")
    .insert({ name: name.trim(), slug })
    .select()
    .single();

  if (error || !workspace) {
    return NextResponse.json({ error: "Failed to create workspace" }, { status: 500 });
  }

  await admin.from("workspace_members").insert({
    workspace_id: workspace.id,
    user_id: user.id,
    role: "admin",
  });

  return NextResponse.json({ workspace });
}
