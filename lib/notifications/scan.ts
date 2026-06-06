/**
 * Core workspace scan logic — shared between the cron scan route and the
 * authenticated test route so both surfaces run identical checks.
 *
 * Two passes:
 *   1. Stale items  — open/needs_decision, not updated in ≥48 h
 *   2. Blocked items — ai_classification = 'Blocked', not yet resolved
 *
 * For each item with a linked profile that has a slack_handle, a DM is sent.
 * Items already notified in pass 1 are skipped in pass 2.
 */

import { createAdminClient } from "@/lib/supabase/server";
import { sendSlackDM } from "@/lib/slack/notify";

export interface ScanResult {
  notified: number;
  skipped: number;
}

interface ProfileJoin {
  id: string;
  display_name: string;
  slack_handle: string | null;
}

interface FeedbackRow {
  id: string;
  project_id: string | null;
  ai_key_question: string | null;
  ai_classification: string | null;
  author_profile: ProfileJoin | ProfileJoin[] | null;
}

function resolveProfile(raw: ProfileJoin | ProfileJoin[] | null): ProfileJoin | null {
  if (!raw) return null;
  return Array.isArray(raw) ? (raw[0] ?? null) : raw;
}

export async function runWorkspaceScan(
  workspaceId: string,
  slackToken: string,
  appUrl: string,
): Promise<ScanResult> {
  const admin = createAdminClient();
  let notified = 0;
  let skipped = 0;
  const notifiedItemIds = new Set<string>();

  // ── Pass 1: stale open / needs_decision items (no update in 48 h) ──────────

  const cutoff48h = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

  const { data: staleRows } = await admin
    .from("feedback_items")
    .select(`
      id, project_id, ai_key_question, ai_classification,
      author_profile:profiles!author_profile_id(id, display_name, slack_handle)
    `)
    .in("status", ["open", "needs_decision"])
    .lt("updated_at", cutoff48h)
    .eq("workspace_id", workspaceId);

  for (const raw of staleRows ?? []) {
    const item    = raw as FeedbackRow;
    const profile = resolveProfile(item.author_profile);

    if (!profile?.slack_handle || !slackToken) {
      skipped++;
      continue;
    }

    const itemUrl  = `${appUrl}/inbox/${item.project_id ?? ""}/${item.id}`;
    const question = item.ai_key_question ?? "a Figma comment";
    const text     = `👋 Hey ${profile.display_name}, a Figma comment needs your attention: "${question}" — ${itemUrl}`;

    try {
      await sendSlackDM(profile.slack_handle, text, slackToken);
      notifiedItemIds.add(item.id);
      notified++;
    } catch (e) {
      console.warn(`[notify/scan] stale DM failed (${profile.slack_handle}):`, e);
      skipped++;
    }
  }

  // ── Pass 2: active blockers ────────────────────────────────────────────────

  const { data: blockedRows } = await admin
    .from("feedback_items")
    .select(`
      id, project_id, ai_key_question,
      author_profile:profiles!author_profile_id(id, display_name, slack_handle)
    `)
    .eq("ai_classification", "Blocked")
    .neq("status", "resolved")
    .eq("workspace_id", workspaceId);

  for (const raw of blockedRows ?? []) {
    const item = raw as FeedbackRow;

    // Skip if already DM'd in pass 1
    if (notifiedItemIds.has(item.id)) continue;

    const profile = resolveProfile(item.author_profile);

    if (!profile?.slack_handle || !slackToken) {
      skipped++;
      continue;
    }

    const itemUrl  = `${appUrl}/inbox/${item.project_id ?? ""}/${item.id}`;
    const question = item.ai_key_question ?? "a Figma comment";
    const text     = `🚨 There's a blocker that needs resolution: "${question}" — ${itemUrl}`;

    try {
      await sendSlackDM(profile.slack_handle, text, slackToken);
      notified++;
    } catch (e) {
      console.warn(`[notify/scan] blocker DM failed (${profile.slack_handle}):`, e);
      skipped++;
    }
  }

  return { notified, skipped };
}
