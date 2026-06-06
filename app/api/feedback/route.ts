import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("projectId");

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

  if (!membership) return NextResponse.json({ items: [] });

  // ── Core query: only columns guaranteed to exist ──────────────────────────
  // NOTE: do NOT reference design_references or new figma_comments columns
  // (page_name, frame_name) here — those require migrations to be run first.
  // They are fetched optionally below.
  let query = admin
    .from("feedback_items")
    .select(`
      id, status, priority, ai_summary, ai_classification,
      ai_key_question, ai_tags, ai_risk_flag, ai_vague_flag,
      ai_vague_reason, ai_confidence, ai_suggested_action,
      figma_node_id, figma_preview_url, created_at, updated_at,
      slack_message_ts, slack_channel_id,
      figma_comment:figma_comments(
        id, author_name, author_avatar, raw_content,
        figma_created_at, parent_figma_comment_id,
        figma_comment_id, figma_order_id,
        figma_file:figma_files(id, name, figma_file_key)
      ),
      project:projects(id, name)
    `)
    .eq("workspace_id", membership.workspace_id)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  if (projectId) {
    query = query.eq("project_id", projectId);
  }

  const { data: items, error: itemsError } = await query;

  if (itemsError) {
    console.error("[feedback] core query failed:", itemsError.message);
    return NextResponse.json({ error: itemsError.message }, { status: 500 });
  }

  if (!items?.length) return NextResponse.json({ items: [] });

  // ── Normalize figma_comment (Supabase returns FK joins as array or object) ─
  const normalized = items.map(item => {
    const fc = Array.isArray(item.figma_comment) ? item.figma_comment[0] : item.figma_comment;
    return { ...item, figma_comment: fc ?? null };
  });

  // ── Batch-fetch replies ───────────────────────────────────────────────────
  const parentIds = normalized
    .map(i => (i.figma_comment as { id?: string } | null)?.id)
    .filter((id): id is string => !!id);

  const { data: replies, error: repliesError } = parentIds.length > 0
    ? await admin
        .from("figma_comments")
        .select("id, author_name, raw_content, figma_created_at, parent_figma_comment_id")
        .in("parent_figma_comment_id", parentIds)
        .is("deleted_at", null)
        .order("figma_created_at", { ascending: true })
    : { data: [], error: null };

  if (repliesError) {
    console.error("[feedback] replies query failed:", repliesError.message);
  }

  // ── Optionally enrich with page_name + frame_name (post-migration columns) ─
  // If columns don't exist yet, just skip gracefully — won't break replies.
  const extraMap = new Map<string, { page_name: string | null; frame_name: string | null }>();
  if (parentIds.length > 0) {
    try {
      const { data: extras } = await admin
        .from("figma_comments")
        .select("id, page_name, frame_name")
        .in("id", parentIds);
      for (const row of extras ?? []) {
        const r = row as { id: string; page_name?: string | null; frame_name?: string | null };
        extraMap.set(r.id, { page_name: r.page_name ?? null, frame_name: r.frame_name ?? null });
      }
    } catch {
      // columns don't exist yet — silently skip
    }
  }

  // ── Optionally enrich with design_references (post-migration table) ───────
  type DesignRefRow = {
    id: string; file_key: string; node_id: string;
    frame_name: string | null; page_name: string | null;
    thumbnail_url: string | null; preview_status: string;
    preview_error_reason: string | null;
  };
  const itemIds = normalized.map(i => i.id);
  const drMap = new Map<string, DesignRefRow>();

  if (itemIds.length > 0) {
    try {
      const { data: drRows } = await admin
        .from("feedback_items")
        .select("id, design_reference:design_references(id, file_key, node_id, frame_name, page_name, thumbnail_url, preview_status, preview_error_reason)")
        .in("id", itemIds);
      for (const row of drRows ?? []) {
        const dr = Array.isArray(row.design_reference) ? row.design_reference[0] : row.design_reference;
        if (dr) drMap.set(row.id, dr as DesignRefRow);
      }
    } catch {
      // design_references table doesn't exist yet — silently skip
    }
  }

  // ── Optionally enrich with author_profile (post-migration column) ────────
  type AuthorProfileRow = {
    id: string; display_name: string; email: string | null;
    avatar_url: string | null; figma_handle: string | null; slack_handle: string | null;
  };
  const profileMap = new Map<string, AuthorProfileRow>();
  if (itemIds.length > 0) {
    try {
      const { data: profRows } = await admin
        .from("feedback_items")
        .select("id, author_profile:profiles!author_profile_id(id, display_name, email, avatar_url, figma_handle, slack_handle)")
        .in("id", itemIds);
      for (const row of profRows ?? []) {
        const prof = Array.isArray(row.author_profile) ? row.author_profile[0] : row.author_profile;
        if (prof) profileMap.set(row.id, prof as AuthorProfileRow);
      }
    } catch {
      // profiles table or author_profile_id column doesn't exist yet — silently skip
    }
  }

  // ── Optionally enrich with owner fields (post-migration columns) ─────────
  type OwnerProfileRow = { display_name: string; slack_handle: string | null };
  type OwnerRow = {
    owner_name: string | null;
    owner_profile_id: string | null;
    waiting_since: string | null;
    ownership_source: string | null;
    owner_profile: OwnerProfileRow | null;
  };
  const ownerMap = new Map<string, OwnerRow>();
  if (itemIds.length > 0) {
    try {
      const { data: ownerRows } = await admin
        .from("feedback_items")
        .select("id, owner_name, owner_profile_id, waiting_since, ownership_source, owner_profile:profiles!owner_profile_id(display_name, slack_handle)")
        .in("id", itemIds);
      for (const row of ownerRows ?? []) {
        const r = row as {
          id: string;
          owner_name?: string | null;
          owner_profile_id?: string | null;
          waiting_since?: string | null;
          ownership_source?: string | null;
          owner_profile?: OwnerProfileRow | OwnerProfileRow[] | null;
        };
        const op = Array.isArray(r.owner_profile) ? (r.owner_profile[0] ?? null) : (r.owner_profile ?? null);
        ownerMap.set(row.id, {
          owner_name:       r.owner_name       ?? null,
          owner_profile_id: r.owner_profile_id ?? null,
          waiting_since:    r.waiting_since     ?? null,
          ownership_source: r.ownership_source  ?? null,
          owner_profile:    op,
        });
      }
    } catch {
      // owner columns don't exist yet — silently skip
    }
  }

  // ── Assemble final items ──────────────────────────────────────────────────
  const itemsWithReplies = normalized.map(item => {
    const fc = item.figma_comment as Record<string, unknown> | null;
    const fcId = fc?.id as string | null;
    const extra = fcId ? extraMap.get(fcId) : null;
    const dr = drMap.get(item.id) ?? null;
    const authorProfile = profileMap.get(item.id) ?? null;
    const ownerData = ownerMap.get(item.id) ?? null;

    // Merge page_name + frame_name into figma_comment
    const enrichedFc = fc ? {
      ...fc,
      page_name: extra?.page_name ?? null,
      frame_name: extra?.frame_name ?? null,
    } : null;

    // Best preview URL: design_reference (ready) > figma_preview_url
    const resolvedPreviewUrl =
      (dr?.preview_status === "ready" && dr?.thumbnail_url)
        ? dr.thumbnail_url
        : (item.figma_preview_url ?? null);

    const itemReplies = (replies ?? []).filter(r => r.parent_figma_comment_id === fcId);

    return {
      ...item,
      figma_comment: enrichedFc,
      design_reference: dr,
      figma_preview_url: resolvedPreviewUrl,
      replies: itemReplies,
      author_profile: authorProfile,
      owner_name:       ownerData?.owner_name       ?? null,
      owner_profile_id: ownerData?.owner_profile_id ?? null,
      waiting_since:    ownerData?.waiting_since     ?? null,
      ownership_source: ownerData?.ownership_source  ?? null,
      owner_profile:    ownerData?.owner_profile     ?? null,
    };
  });

  return NextResponse.json({ items: itemsWithReplies });
}
