import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { extractFileKey, getFigmaFileName } from "@/lib/figma/api";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: projectId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { url } = await req.json() as { url: string };
  if (!url?.trim()) return NextResponse.json({ error: "URL required" }, { status: 400 });

  const fileKey = extractFileKey(url.trim());
  if (!fileKey) return NextResponse.json({ error: "Invalid Figma URL" }, { status: 400 });

  const admin = createAdminClient();

  // Get workspace + PAT
  const { data: membership } = await admin
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", user.id)
    .limit(1)
    .single();

  if (!membership) return NextResponse.json({ error: "No workspace" }, { status: 400 });

  const { data: userRow } = await admin
    .from("users")
    .select("figma_pat")
    .eq("id", user.id)
    .single();

  const pat = (userRow as Record<string, string | null> | null)?.figma_pat ?? null;

  // Fetch file name from Figma
  let fileName: string | null = null;
  if (pat) {
    fileName = await getFigmaFileName(fileKey, pat);
  }

  // Check duplicate
  const { data: existing } = await admin
    .from("figma_files")
    .select("id")
    .eq("figma_file_key", fileKey)
    .eq("workspace_id", membership.workspace_id)
    .single();

  if (existing) return NextResponse.json({ error: "File already added" }, { status: 400 });

  const { data: file, error } = await admin
    .from("figma_files")
    .insert({
      project_id: projectId,
      workspace_id: membership.workspace_id,
      figma_file_key: fileKey,
      figma_pat: pat,
      name: fileName ?? `Figma file (${fileKey.slice(0, 8)})`,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: "Failed to add file" }, { status: 500 });

  return NextResponse.json({ file });
}
