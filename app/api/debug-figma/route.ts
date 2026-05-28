import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { figmaHeaders } from "@/lib/figma/api";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();

  // Get first figma file with PAT
  const { data: file } = await admin
    .from("figma_files")
    .select("figma_file_key, figma_pat")
    .not("figma_pat", "is", null)
    .limit(1)
    .single();

  if (!file) return NextResponse.json({ error: "No figma file found" });

  // Fetch raw comments from Figma
  const res = await fetch(`https://api.figma.com/v1/files/${file.figma_file_key}/comments`, {
    headers: figmaHeaders(file.figma_pat),
  });

  const data = await res.json() as { comments?: Record<string, unknown>[] };

  // Return first 3 comments with their raw fields
  const preview = (data.comments ?? []).slice(0, 3).map(c => ({
    id: c.id,
    order_id: c.order_id,
    parent_id: c.parent_id,
    message: (c.message as string)?.slice(0, 60),
  }));

  return NextResponse.json({ status: res.status, comments: preview });
}
