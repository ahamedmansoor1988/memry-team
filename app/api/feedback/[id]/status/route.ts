/**
 * PATCH /api/feedback/:id/status
 *
 * Validates status transitions, applies the update, and records history.
 * Application-layer enforcement — no DB CHECK constraint for beta.
 *
 * Valid transitions:
 *   open           → needs_decision | resolved | archived
 *   needs_decision → resolved | open | archived
 *   resolved       → archived | open  (open = manual reopen)
 *   archived       → open            (unarchive)
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { extractDecision } from "@/lib/ai/extract-decision";

const VALID_TRANSITIONS: Record<string, string[]> = {
  open:           ["needs_decision", "resolved", "archived"],
  needs_decision: ["resolved", "open", "archived"],
  resolved:       ["archived", "open"],
  archived:       ["open"],
};

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json() as { status?: string; reason?: string };
  const { status: toStatus, reason } = body;
  if (!toStatus) return NextResponse.json({ error: "status required" }, { status: 400 });

  const admin = createAdminClient();

  // Resolve workspace
  const { data: membership } = await admin
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", user.id)
    .limit(1)
    .single();

  if (!membership) return NextResponse.json({ error: "No workspace" }, { status: 400 });

  // Load current item
  const { data: item } = await admin
    .from("feedback_items")
    .select("id, status, blocked_since")
    .eq("id", id)
    .eq("workspace_id", membership.workspace_id)
    .single();

  if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const fromStatus = item.status as string;
  const existingBlockedSince = (item as { blocked_since?: string | null }).blocked_since ?? null;

  // Guard: no-op if already in target state
  if (fromStatus === toStatus) {
    return NextResponse.json({ ok: true, status: toStatus, skipped: true });
  }

  // Validate transition
  const allowed = VALID_TRANSITIONS[fromStatus] ?? [];
  if (!allowed.includes(toStatus)) {
    return NextResponse.json(
      { error: `Invalid transition: ${fromStatus} → ${toStatus}` },
      { status: 422 }
    );
  }

  const now = new Date().toISOString();

  // Build update payload — manage timestamp columns
  const updates: Record<string, string | null | number> = {
    status: toStatus,
    updated_at: now,
  };
  if (toStatus === "resolved") {
    updates.resolved_at = now;
  }
  if (toStatus === "archived") {
    updates.archived_at = now;
  }
  // Clear archived_at when unarchiving
  if (fromStatus === "archived" && toStatus === "open") {
    updates.archived_at = null;
  }

  // ── blocked_since management ──────────────────────────────────────────────
  // Set when first entering needs_decision (if not already set).
  if (toStatus === "needs_decision" && !existingBlockedSince) {
    updates.blocked_since = now;
  }
  // Clear when leaving an active blocked state.
  if (
    (toStatus === "resolved" || toStatus === "archived") ||
    (fromStatus === "needs_decision" && toStatus === "open")
  ) {
    updates.blocked_since = null;
  }

  const { error: updateError } = await admin
    .from("feedback_items")
    .update(updates)
    .eq("id", id)
    .eq("workspace_id", membership.workspace_id);

  if (updateError) {
    console.error("[status] update failed:", updateError);
    return NextResponse.json({ error: "Update failed" }, { status: 500 });
  }

  // Record history (best-effort — table exists after status_system migration)
  try {
    await admin
      .from("feedback_item_status_history")
      .insert({
        item_id: id,
        workspace_id: membership.workspace_id,
        from_status: fromStatus,
        to_status: toStatus,
        changed_by: user.id,
        reason: reason ?? null,
        created_at: now,
      });
  } catch (e) {
    console.warn("[status] history insert failed:", e);
  }

  // Auto-extract and persist a structured decision when manually resolved
  if (toStatus === "resolved") {
    try {
      const { data: fbItem } = await admin
        .from("feedback_items")
        .select("figma_comment:figma_comments(id, raw_content)")
        .eq("id", id)
        .single();

      const fc = Array.isArray(fbItem?.figma_comment)
        ? fbItem.figma_comment[0]
        : fbItem?.figma_comment;
      const commentText = (fc as { raw_content?: string } | null)?.raw_content ?? "";
      const commentDbId = (fc as { id?: string } | null)?.id;

      let replyTexts: string[] = [];
      if (commentDbId) {
        const { data: repliesData } = await admin
          .from("figma_comments")
          .select("raw_content")
          .eq("parent_figma_comment_id", commentDbId);
        replyTexts = (repliesData ?? []).map(r => (r as { raw_content: string }).raw_content);
      }

      const result = await extractDecision(commentText, replyTexts, user.email ?? undefined);
      if (result) {
        await admin.from("decisions").insert({
          workspace_id:     membership.workspace_id as string,
          feedback_item_id: id,
          decision_text:    result.decision_text,
          reason:           result.reason,
          owner_name:       result.owner_name ?? user.email ?? null,
          source:           "manual",
          decided_at:       now,
        });
      }
    } catch (e) {
      console.warn("[status] decision extraction failed (non-fatal):", e);
    }
  }

  return NextResponse.json({ ok: true, status: toStatus });
}
