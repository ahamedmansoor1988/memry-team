/**
 * GET /api/profiles/backfill
 * Reads all existing figma_comments and upserts a profile for each unique author.
 * Uses author_name (figma handle) as the conflict key.
 * Safe to run multiple times — fully idempotent.
 */
import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();

  const { data: membership } = await admin
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", user.id)
    .limit(1)
    .single();

  if (!membership) return NextResponse.json({ error: "No workspace" }, { status: 400 });

  const wsId = membership.workspace_id as string;

  // Fetch all unique authors from figma_comments
  const { data: comments, error } = await admin
    .from("figma_comments")
    .select("author_name, author_avatar, author_email")
    .eq("workspace_id", wsId)
    .is("deleted_at", null)
    .not("author_name", "is", null);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Deduplicate by author_name
  const seen = new Set<string>();
  const authors = (comments ?? []).filter(c => {
    if (!c.author_name || seen.has(c.author_name)) return false;
    seen.add(c.author_name);
    return true;
  });

  let upserted = 0;
  for (const author of authors) {
    const payload: Record<string, unknown> = {
      workspace_id: wsId,
      display_name: author.author_name,
      figma_handle: author.author_name,
      avatar_url: author.author_avatar ?? null,
      updated_at: new Date().toISOString(),
    };
    if (author.author_email) payload.email = author.author_email;

    const { error: upsertErr } = await admin
      .from("profiles")
      .upsert(payload, { onConflict: "workspace_id,figma_handle" });

    if (upsertErr) {
      console.error("[profiles/backfill] upsert failed for", author.author_name, upsertErr.message);
    } else {
      upserted++;
    }
  }

  return NextResponse.json({ upserted, total: authors.length });
}
