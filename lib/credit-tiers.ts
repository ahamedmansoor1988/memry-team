export interface CreditTier {
  credits: number;
  priceUsd: string; // PayPal wants a fixed 2-decimal string, not a float
}

// $0.02/credit flat across every tier.
export const CREDIT_TIERS: CreditTier[] = [
  { credits: 100, priceUsd: "2.00" },
  { credits: 250, priceUsd: "5.00" },
  { credits: 500, priceUsd: "10.00" },
  { credits: 1000, priceUsd: "20.00" },
];

export function findCreditTier(credits: number): CreditTier | undefined {
  return CREDIT_TIERS.find(t => t.credits === credits);
}
