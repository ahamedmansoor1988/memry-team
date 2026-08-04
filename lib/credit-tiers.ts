export interface CreditTier {
  credits: number;
  priceUsd: string; // PayPal wants a fixed 2-decimal string, not a float
}

// Volume-discounted: the per-credit rate drops as the pack grows, from
// $0.036/credit on the smallest to $0.0198/credit on the largest.
export const CREDIT_TIERS: CreditTier[] = [
  { credits: 250, priceUsd: "9.00" },
  { credits: 750, priceUsd: "24.00" },
  { credits: 2000, priceUsd: "49.00" },
  { credits: 5000, priceUsd: "99.00" },
];

export function findCreditTier(credits: number): CreditTier | undefined {
  return CREDIT_TIERS.find(t => t.credits === credits);
}
