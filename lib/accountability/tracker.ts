/**
 * Pure, synchronous accountability computation.
 * No side effects — safe to call in any context.
 *
 * Input shape covers only the columns this function needs; callers may pass a
 * broader DB row and TypeScript will allow the extras.
 */

export type AccountabilityUrgency = "critical" | "high" | "medium" | "low" | "none";

export interface AccountabilityInput {
  status:            string;
  ai_classification: string | null;
  waiting_since:     string | null;  // ISO timestamp — owner assigned
  blocked_since:     string | null;  // ISO timestamp — entered needs_decision / Blocked
  escalation_count:  number | null;
  updated_at:        string;
}

export interface AccountabilityState {
  /** Days since the item has been waiting on an owner response (or 0). */
  waiting_days:     number;
  /** Days since the item has been in a blocked/needs-decision state (or 0). */
  blocked_days:     number;
  /** True when blocked_days > 3. */
  is_overdue:       boolean;
  /** Computed urgency tier. */
  urgency:          AccountabilityUrgency;
  /** Human-readable label shown in the UI. */
  label:            string;
  /** True when the item should trigger an escalation notification. */
  should_escalate:  boolean;
}

// ─── Thresholds ───────────────────────────────────────────────────────────────

const CRITICAL_DAYS  = 7;   // blocked ≥ 7 d  → critical
const HIGH_DAYS      = 3;   // blocked ≥ 3 d  → high
const MEDIUM_DAYS    = 1;   // blocked ≥ 1 d  → medium
const ESCALATE_DAYS  = 5;   // blocked ≥ 5 d  → flag should_escalate

// ─── Helpers ──────────────────────────────────────────────────────────────────

function daysSince(iso: string | null): number {
  if (!iso) return 0;
  const ms = Date.now() - new Date(iso).getTime();
  return Math.max(0, ms / (1000 * 60 * 60 * 24));
}

function daysLabel(days: number): string {
  if (days < 1) return "< 1 day";
  const d = Math.floor(days);
  return `${d} day${d !== 1 ? "s" : ""}`;
}

// ─── Main export ──────────────────────────────────────────────────────────────

export function computeAccountability(item: AccountabilityInput): AccountabilityState {
  const isActive = item.status === "open" || item.status === "needs_decision";

  // If the item isn't active there's nothing to track.
  if (!isActive) {
    return {
      waiting_days:    0,
      blocked_days:    0,
      is_overdue:      false,
      urgency:         "none",
      label:           "",
      should_escalate: false,
    };
  }

  const waiting_days = daysSince(item.waiting_since);
  const blocked_days = daysSince(item.blocked_since);
  const is_overdue   = blocked_days > HIGH_DAYS;

  // ── Urgency ──────────────────────────────────────────────────────────────
  let urgency: AccountabilityUrgency = "none";

  if (item.ai_classification === "Blocked") {
    if (blocked_days >= CRITICAL_DAYS) {
      urgency = "critical";
    } else if (blocked_days >= HIGH_DAYS) {
      urgency = "high";
    } else if (blocked_days >= MEDIUM_DAYS) {
      urgency = "medium";
    } else {
      urgency = "low";
    }
  } else if (item.status === "needs_decision") {
    if (blocked_days >= CRITICAL_DAYS) {
      urgency = "critical";
    } else if (blocked_days >= HIGH_DAYS) {
      urgency = "high";
    } else if (blocked_days >= MEDIUM_DAYS) {
      urgency = "medium";
    } else if (blocked_days > 0 || waiting_days > 0) {
      urgency = "low";
    }
  } else if (waiting_days >= HIGH_DAYS) {
    urgency = "medium";
  } else if (waiting_days > 0) {
    urgency = "low";
  }

  // ── Label ────────────────────────────────────────────────────────────────
  let label = "";
  if (urgency === "none") {
    label = "";
  } else if (blocked_days > 0) {
    label = `Blocked ${daysLabel(blocked_days)}`;
  } else if (waiting_days > 0) {
    label = `Waiting ${daysLabel(waiting_days)}`;
  } else {
    label = "Needs attention";
  }

  const should_escalate = blocked_days >= ESCALATE_DAYS;

  return {
    waiting_days,
    blocked_days,
    is_overdue,
    urgency,
    label,
    should_escalate,
  };
}
