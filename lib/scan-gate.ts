import { getOrCreatePrimaryKey, ensureFreeTrialGranted, consumeCreditForKey } from "@/lib/api-keys";

export type ScanGateResult =
  | { allowed: true; creditsRemaining: number }
  | { allowed: false; error: string; code: "insufficient_credits" | "blocked" };

/**
 * Gates a scan behind the user's credit balance — first-ever use grants the
 * 100-credit free trial automatically, then every scan (across all 4 tools)
 * consumes 1 credit. Requires a logged-in user; there is no anonymous path.
 */
export async function gateScanByCredits(userId: string, scanType: string): Promise<ScanGateResult> {
  const apiKeyId = await getOrCreatePrimaryKey(userId);
  await ensureFreeTrialGranted(apiKeyId);

  const result = await consumeCreditForKey(apiKeyId, scanType);
  if (!result.ok) {
    if (result.reason === "insufficient_credits") {
      return { allowed: false, code: "insufficient_credits", error: "You're out of credits." };
    }
    return { allowed: false, code: "blocked", error: "This account can't run scans right now." };
  }

  return { allowed: true, creditsRemaining: result.creditsRemaining };
}
