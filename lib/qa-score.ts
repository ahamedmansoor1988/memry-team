export interface ScoredIssue {
  severity: "high" | "medium" | "low";
  type: string;
}

const WEIGHTS = { high: 12, medium: 6, low: 2 };

// Informational types cost less — they should nudge the score, not tank it.
const SOFT_TYPES = new Set(["small_tap_target", "long_unbroken_text"]);

export function qaScore(issues: ScoredIssue[]): number {
  let penalty = 0;
  for (const issue of issues) {
    penalty += SOFT_TYPES.has(issue.type) ? 1 : WEIGHTS[issue.severity];
  }
  return Math.max(4, 100 - penalty);
}

export function scoreTone(score: number): { label: string; color: string; bg: string } {
  if (score >= 90) return { label: "Excellent", color: "#059669", bg: "#ecfdf5" };
  if (score >= 75) return { label: "Good", color: "#0d9488", bg: "#f0fdfa" };
  if (score >= 55) return { label: "Needs work", color: "#d97706", bg: "#fffbeb" };
  return { label: "Failing", color: "#dc2626", bg: "#fef2f2" };
}
