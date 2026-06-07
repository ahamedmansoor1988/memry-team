/**
 * Core monitoring logic — detects issues across a workspace's open feedback
 * without side effects. Called by both the authenticated GET route (UI) and
 * the secret-gated POST route (cron / external trigger).
 *
 * Safe to call at any time: wrapped in try/catch, returns an empty report on
 * any failure so callers never crash.
 */

import { createAdminClient } from "@/lib/supabase/server";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MonitoringIssue {
  type: "stalled" | "blocker" | "risk" | "ownership_gap" | "vague_cluster";
  severity: "high" | "medium" | "low";
  title: string;
  description: string;
  feedback_item_ids: string[];
  owner_name: string | null;
}

export interface MonitoringReport {
  issues: MonitoringIssue[];
  scanned_at: string;
  total_open: number;
  health_score: number;  // 0–100
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SEVERITY_ORDER: Record<MonitoringIssue["severity"], number> = {
  high: 0, medium: 1, low: 2,
};

function emptyReport(): MonitoringReport {
  return { issues: [], scanned_at: new Date().toISOString(), total_open: 0, health_score: 100 };
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function detectIssues(workspaceId: string): Promise<MonitoringReport> {
  try {
    const admin = createAdminClient();
    const now = Date.now();
    const cutoff72h = new Date(now - 72 * 60 * 60 * 1000).toISOString();
    const cutoff24h = new Date(now - 24 * 60 * 60 * 1000).toISOString();

    type ItemRow = {
      id: string;
      status: string;
      ai_classification: string | null;
      ai_risk_flag: boolean | null;
      ai_vague_flag: boolean | null;
      updated_at: string;
      created_at: string;
      owner_name: string | null;
    };

    const { data: rows, error } = await admin
      .from("feedback_items")
      .select("id, status, ai_classification, ai_risk_flag, ai_vague_flag, updated_at, created_at, owner_name")
      .eq("workspace_id", workspaceId)
      .in("status", ["open", "needs_decision"]);

    if (error || !rows) {
      console.warn("[detect-issues] query failed:", error?.message);
      return emptyReport();
    }

    const items = rows as ItemRow[];
    const issues: MonitoringIssue[] = [];

    // ── 1. Stalled items (no activity in 72 h) ────────────────────────────────
    const stalled = items.filter(i => i.updated_at < cutoff72h);
    if (stalled.length > 0) {
      issues.push({
        type: "stalled",
        severity: stalled.length > 5 ? "high" : "medium",
        title: `${stalled.length} stalled item${stalled.length !== 1 ? "s" : ""}`,
        description: `${stalled.length} item${stalled.length !== 1 ? "s have" : " has"} had no activity for over 72 hours`,
        feedback_item_ids: stalled.map(i => i.id),
        owner_name: null,
      });
    }

    // ── 2. Active blockers (one issue per blocker — each is high severity) ────
    const blockers = items.filter(i => i.ai_classification === "Blocked");
    for (const blocker of blockers) {
      issues.push({
        type: "blocker",
        severity: "high",
        title: "Active blocker",
        description: "This item is classified as Blocked and needs immediate resolution",
        feedback_item_ids: [blocker.id],
        owner_name: blocker.owner_name,
      });
    }

    // ── 3. Risk flags ─────────────────────────────────────────────────────────
    const risks = items.filter(i => i.ai_risk_flag === true);
    if (risks.length > 0) {
      issues.push({
        type: "risk",
        severity: "medium",
        title: `${risks.length} risk flag${risks.length !== 1 ? "s" : ""}`,
        description: `${risks.length} item${risks.length !== 1 ? "s are" : " is"} flagged as a potential risk`,
        feedback_item_ids: risks.map(i => i.id),
        owner_name: null,
      });
    }

    // ── 4. Ownership gap (no owner, older than 24 h) ──────────────────────────
    const ownershipGap = items.filter(i => !i.owner_name && i.created_at < cutoff24h);
    if (ownershipGap.length > 0) {
      issues.push({
        type: "ownership_gap",
        severity: "low",
        title: `${ownershipGap.length} unowned item${ownershipGap.length !== 1 ? "s" : ""}`,
        description: `${ownershipGap.length} item${ownershipGap.length !== 1 ? "s have" : " has"} no assigned owner for over 24 hours`,
        feedback_item_ids: ownershipGap.map(i => i.id),
        owner_name: null,
      });
    }

    // ── 5. Vague cluster (> 3 vague open items) ───────────────────────────────
    const vagueItems = items.filter(i => i.ai_vague_flag === true && i.status === "open");
    if (vagueItems.length > 3) {
      issues.push({
        type: "vague_cluster",
        severity: "low",
        title: `${vagueItems.length} vague comments`,
        description: `${vagueItems.length} open comments are flagged as vague — consider requesting clarification`,
        feedback_item_ids: vagueItems.map(i => i.id),
        owner_name: null,
      });
    }

    // ── Health score ──────────────────────────────────────────────────────────
    const healthScore = Math.max(
      0,
      100 - (blockers.length * 15) - (stalled.length * 10) - (risks.length * 5),
    );

    // Sort: high → medium → low
    issues.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);

    return {
      issues,
      scanned_at: new Date().toISOString(),
      total_open: items.length,
      health_score: healthScore,
    };
  } catch (e) {
    console.error("[detect-issues] unexpected error:", e);
    return emptyReport();
  }
}
