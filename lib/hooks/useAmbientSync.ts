/**
 * Ambient sync hook — automatically syncs Figma comments:
 *   • On first page load (force if never synced before)
 *   • When the browser tab regains focus (always forced — bypasses cooldown)
 *   • Every 55 seconds via setInterval
 *
 * After a successful pull, waits POST_SYNC_DELAY ms for fire-and-forget
 * per-file syncs to land, then calls onSyncComplete so the caller can
 * re-fetch data from the DB.
 *
 * Stores last sync time in localStorage so it's shared across tabs.
 */
import { useEffect, useRef } from "react";

const COOLDOWN_MS     = 50_000;  // 50s between background auto-syncs
const INTERVAL_MS     = 55_000;  // recurring poll every 55s
const POST_SYNC_DELAY = 8_000;   // wait 8s for file syncs to land
const LS_KEY = "memry_last_sync";

export function useAmbientSync(onSyncComplete?: () => void) {
  const syncing = useRef(false);

  async function maybeSyncNow(force = false) {
    if (syncing.current) return;

    const last = parseInt(localStorage.getItem(LS_KEY) ?? "0", 10);
    if (!force && Date.now() - last < COOLDOWN_MS) return;

    syncing.current = true;
    // Write timestamp optimistically BEFORE the fetch so other tabs/instances
    // that read localStorage within the same tick see the cooldown and skip.
    localStorage.setItem(LS_KEY, Date.now().toString());
    try {
      const res = await fetch("/api/figma/pull", { method: "POST" });
      if (res.ok) {
        // Wait for fire-and-forget per-file syncs to land, then refresh
        setTimeout(() => { onSyncComplete?.(); }, POST_SYNC_DELAY);
      }
    } catch {
      // Silent fail — ambient, not blocking
    } finally {
      syncing.current = false;
    }
  }

  useEffect(() => {
    // Force sync on first ever load (no localStorage record)
    const hasEverSynced = !!localStorage.getItem(LS_KEY);
    void maybeSyncNow(!hasEverSynced);

    // Force sync when the tab regains focus — bypass cooldown so returning
    // to the tab always fetches the latest comments immediately.
    const onFocus = () => void maybeSyncNow(true);
    const onVisible = () => {
      if (document.visibilityState === "visible") void maybeSyncNow(true);
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);

    // Recurring poll every 55 seconds
    const interval = setInterval(() => void maybeSyncNow(), INTERVAL_MS);

    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(interval);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { triggerSync: () => void maybeSyncNow(true) };
}
