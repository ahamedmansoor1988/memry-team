/** Prepends https:// to a bare domain (e.g. "apple.com") so users don't have to type the protocol. */
export function normalizeUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "";
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

/** True once the (normalized) input looks like a usable http(s) URL with a real host. */
export function isUsableUrl(input: string): boolean {
  const normalized = normalizeUrl(input);
  if (!normalized.startsWith("http")) return false;
  return normalized.includes(".");
}
