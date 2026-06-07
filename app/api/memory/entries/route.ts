/**
 * GET  /api/memory/entries — list all memory entries for the workspace
 * POST /api/memory/entries — create a new memory entry
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";

// ─── GET ──────────────────────────────────────────────────────────────────────

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

  const workspaceId = (membership as { workspace_id: string } | null)?.workspace_id;
  if (!workspaceId) return NextResponse.json({ error: "No workspace" }, { status: 400 });

  const { data: entries, error } = await admin
    .from("memory_entries")
    .select("id, type, title, content, source_ids, tags, created_at, updated_at")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false });

  if (error) {
    // Table may not exist if migration hasn't run yet — return empty gracefully
    console.warn("[memory/entries] fetch error:", error.message);
    return NextResponse.json({ entries: [] });
  }

  return NextResponse.json({ entries: entries ?? [] });
}

// ─── POST ─────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json() as {
    type?:       string;
    title?:      string;
    content?:    string;
    tags?:       string[];
    source_ids?: string[];
  };

  const { type, title, content, tags = [], source_ids = [] } = body;
  if (!type || !title || !content) {
    return NextResponse.json({ error: "type, title, and content are required" }, { status: 400 });
  }
  if (!["decision", "pattern", "context"].includes(type)) {
    return NextResponse.json({ error: "type must be decision | pattern | context" }, { status: 400 });
  }

  const admin = createAdminClient();

  const { data: membership } = await admin
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", user.id)
    .limit(1)
    .single();

  const workspaceId = (membership as { workspace_id: string } | null)?.workspace_id;
  if (!workspaceId) return NextResponse.json({ error: "No workspace" }, { status: 400 });

  const { data: entry, error } = await admin
    .from("memory_entries")
    .insert({
      workspace_id: workspaceId,
      type,
      title,
      content,
      tags,
      source_ids,
    })
    .select("id, type, title, content, source_ids, tags, created_at, updated_at")
    .single();

  if (error) {
    console.error("[memory/entries] insert error:", error.message);
    return NextResponse.json({ error: "Insert failed" }, { status: 500 });
  }

  return NextResponse.json({ entry }, { status: 201 });
}
