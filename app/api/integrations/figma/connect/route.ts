import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getWorkspace } from "@/lib/workspace";

export async function POST(req: NextRequest) {
  const ctx = await getWorkspace();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { pat, team_id } = await req.json() as { pat?: string; team_id?: string };
  if (!pat?.trim() || !team_id?.trim()) {
    return NextResponse.json({ error: "PAT and Team ID are required" }, { status: 400 });
  }

  // Verify PAT against Figma API
  const meRes = await fetch("https://api.figma.com/v1/me", {
    headers: { "X-Figma-Token": pat.trim() },
  });
  if (!meRes.ok) {
    return NextResponse.json({ error: "Invalid Figma PAT — please check and try again" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { error } = await admin.from("workspaces").update({
    figma_pat:          pat.trim(),
    figma_team_id:      team_id.trim(),
    figma_connected_at: new Date().toISOString(),
  }).eq("id", ctx.workspace.id);

  if (error) {
    return NextResponse.json({ error: "Failed to save Figma credentials" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE() {
  const ctx = await getWorkspace();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  await admin.from("workspaces").update({
    figma_pat:          null,
    figma_team_id:      null,
    figma_connected_at: null,
  }).eq("id", ctx.workspace.id);

  return NextResponse.json({ ok: true });
}
