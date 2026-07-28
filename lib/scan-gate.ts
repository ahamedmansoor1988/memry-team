import { getOrCreatePrimaryKey, ensureFreeTrialGranted, consumeCreditForKey } from "@/lib/api-keys";

export type ScanGateResult =
  | { allowed: true; creditsRemaining: number }
  | { allowed: false; error: string };

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
    const error = result.reason === "insufficient_credits"
      ? "You're out of credits. Buy a credit pack on the pricing page to keep scanning."
      : "This account can't run scans right now.";
    return { allowed: false, error };
  }

  return { allowed: true, creditsRemaining: result.creditsRemaining };
}
