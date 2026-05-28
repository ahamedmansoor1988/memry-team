/**
 * Ambient sync hook — automatically syncs Figma comments:
 *   • On first page load (if last sync > 5 min ago)
 *   • When the browser tab regains focus (if last sync > 5 min ago)
 *
 * Stores last sync time in localStorage so it's shared across tabs.
 */
import { useEffect, useRef } from "react";

const SYNC_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes
const LS_KEY = "memry_last_sync";

export function useAmbientSync(onNewItems?: (count: number) => void) {
  const syncing = useRef(false);

  async function maybeSyncNow(force = false) {
    if (syncing.current) return;

    const last = parseInt(localStorage.getItem(LS_KEY) ?? "0", 10);
    if (!force && Date.now() - last < SYNC_COOLDOWN_MS) return;

    syncing.current = true;
    try {
      const res = await fetch("/api/figma/pull", { method: "POST" });
      if (res.ok) {
        const data = await res.json() as { totalAdded?: number };
        localStorage.setItem(LS_KEY, Date.now().toString());
        if (data.totalAdded && data.totalAdded > 0) {
          onNewItems?.(data.totalAdded);
        }
      }
    } catch {
      // Silent fail — ambient, not blocking
    } finally {
      syncing.current = false;
    }
  }

  useEffect(() => {
    // On first ever load (no localStorage record), force sync immediately to populate data
    const hasEverSynced = !!localStorage.getItem(LS_KEY);
    void maybeSyncNow(!hasEverSynced);

    // Sync on tab focus
    const onFocus = () => void maybeSyncNow();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") void maybeSyncNow();
    });

    return () => {
      window.removeEventListener("focus", onFocus);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
