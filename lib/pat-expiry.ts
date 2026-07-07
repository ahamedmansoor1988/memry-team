/**
 * Figma's API never reveals when a PAT expires, so Loupe tracks the expiry
 * date the user copies from Figma at creation time (stored in localStorage
 * alongside the token). This turns "the compare suddenly stopped working"
 * into a warning the user sees days in advance.
 */

export const PAT_EXPIRY_WARN_DAYS = 14;

export interface PatExpiryStatus {
  state: "none" | "ok" | "expiring" | "expired";
  daysLeft: number | null;
  message: string;
}

export function patExpiryStatus(expiryDate: string | null): PatExpiryStatus {
  if (!expiryDate) return { state: "none", daysLeft: null, message: "" };
  const expiry = new Date(`${expiryDate}T23:59:59`);
  if (isNaN(expiry.getTime())) return { state: "none", daysLeft: null, message: "" };

  const daysLeft = Math.ceil((expiry.getTime() - Date.now()) / 86_400_000);
  if (daysLeft < 0) {
    return { state: "expired", daysLeft, message: "Your Figma token has expired — Figma vs Live scans will fail until you replace it." };
  }
  if (daysLeft <= PAT_EXPIRY_WARN_DAYS) {
    return {
      state: "expiring",
      daysLeft,
      message: daysLeft === 0
        ? "Your Figma token expires today — replace it to keep Figma vs Live working."
        : `Your Figma token expires in ${daysLeft} day${daysLeft === 1 ? "" : "s"}.`,
    };
  }
  return { state: "ok", daysLeft, message: `Token valid for ${daysLeft} more days.` };
}

export function storedPatExpiryStatus(): PatExpiryStatus {
  try {
    return patExpiryStatus(localStorage.getItem("loupe_pat_expiry"));
  } catch {
    return { state: "none", daysLeft: null, message: "" };
  }
}
