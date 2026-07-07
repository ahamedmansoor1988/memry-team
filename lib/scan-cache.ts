/**
 * Keeps the last scan result alive across in-app navigation (sessionStorage:
 * survives route changes and reloads, cleared when the tab closes). Results
 * include base64 screenshots, so every write is quota-guarded — worst case
 * the cache silently does nothing and the page behaves like before.
 */

export function loadCachedScan<T>(key: string): { url: string; result: T } | null {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.url || !parsed?.result) return null;
    return parsed as { url: string; result: T };
  } catch {
    return null;
  }
}

export function saveCachedScan(key: string, url: string, result: unknown) {
  try {
    sessionStorage.setItem(key, JSON.stringify({ url, result }));
  } catch {
    try { sessionStorage.removeItem(key); } catch {}
  }
}
