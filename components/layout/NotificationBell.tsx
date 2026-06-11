"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Bell, AlertCircle, Clock, TrendingUp, FileText, Archive, CheckCircle2, HelpCircle } from "lucide-react";

interface Notification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  feedback_item_id: string | null;
  created_at: string;
  read_at: string | null;
}

function timeAgo(date: string): string {
  const diff = Date.now() - new Date(date).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return `${Math.floor(d / 30)}mo ago`;
}

interface TypeConfig { bg: string; color: string; icon: React.ReactNode }

const TYPE_CONFIG: Record<string, TypeConfig> = {
  new_blocker:          { bg: "var(--red-soft)",   color: "var(--red)",   icon: <AlertCircle  style={{ width: 14, height: 14 }} /> },
  decision_overdue:     { bg: "var(--amber-soft)",  color: "var(--amber)", icon: <Clock        style={{ width: 14, height: 14 }} /> },
  escalated:            { bg: "var(--accent)",      color: "var(--accent-ink)", icon: <TrendingUp  style={{ width: 14, height: 14 }} /> },
  weekly_brief_ready:   { bg: "var(--blue-soft)",   color: "var(--blue)",  icon: <FileText     style={{ width: 14, height: 14 }} /> },
  auto_archived:        { bg: "var(--border)",      color: "var(--text-3)",icon: <Archive      style={{ width: 14, height: 14 }} /> },
  auto_resolved:        { bg: "var(--green-soft)",  color: "var(--green)", icon: <CheckCircle2 style={{ width: 14, height: 14 }} /> },
  resolution_suggested: { bg: "var(--blue-soft)",   color: "var(--blue)",  icon: <HelpCircle   style={{ width: 14, height: 14 }} /> },
};

const DEFAULT_CONFIG: TypeConfig = { bg: "var(--border-2)", color: "var(--text-3)", icon: <Bell style={{ width: 14, height: 14 }} /> };

export default function NotificationBell() {
  const router = useRouter();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount]     = useState(0);
  const [open, setOpen]                   = useState(false);
  const dropdownRef                       = useRef<HTMLDivElement>(null);

  const fetchNotifications = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications");
      if (!res.ok) return;
      const data = await res.json() as { notifications: Notification[]; unread_count: number };
      setNotifications(data.notifications ?? []);
      setUnreadCount(data.unread_count ?? 0);
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 60_000);
    return () => clearInterval(interval);
  }, [fetchNotifications]);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  async function markAllRead() {
    await fetch("/api/notifications/read-all", { method: "POST" });
    await fetchNotifications();
  }

  async function handleNotificationClick(n: Notification) {
    await fetch(`/api/notifications/${n.id}/read`, { method: "POST" });
    setOpen(false);
    router.push("/activity");
    await fetchNotifications();
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{ width: 30, height: 30, borderRadius: 7, display: "flex", alignItems: "center", justifyContent: "center", position: "relative", background: "transparent", border: "none", cursor: "pointer" }}
        className="hover:bg-[var(--accent-soft)] transition-colors"
        aria-label="Notifications"
      >
        <Bell style={{ width: 15, height: 15, color: "var(--text-2)" }} />
        {unreadCount > 0 && (
          <span style={{ position: "absolute", top: 2, right: 2, width: 14, height: 14, borderRadius: 99, background: "var(--red)", color: "#fff", fontSize: 9, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "var(--font-mono)" }}>
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div style={{ position: "absolute", right: 0, top: 38, width: 320, zIndex: 50, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, boxShadow: "var(--shadow-2)", overflow: "hidden" }}>
          <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--border-2)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>Notifications</span>
            {notifications.length > 0 && (
              <button onClick={markAllRead} style={{ fontSize: 11, color: "var(--text-3)", cursor: "pointer", background: "none", border: "none" }} className="hover:text-[var(--text-2)] transition-colors">
                Mark all read
              </button>
            )}
          </div>

          {notifications.length === 0 ? (
            <div style={{ padding: "40px 0", textAlign: "center" }}>
              <Bell style={{ width: 28, height: 28, color: "var(--border)", margin: "0 auto 8px" }} />
              <p style={{ fontSize: 12, color: "var(--text-3)" }}>You&apos;re all caught up</p>
            </div>
          ) : (
            <div style={{ maxHeight: 380, overflowY: "auto" }}>
              {notifications.map(n => {
                const cfg = TYPE_CONFIG[n.type] ?? DEFAULT_CONFIG;
                return (
                  <div
                    key={n.id}
                    onClick={() => handleNotificationClick(n)}
                    style={{
                      padding: "10px 14px",
                      display: "flex",
                      gap: 10,
                      cursor: "pointer",
                      borderBottom: "1px solid var(--border-2)",
                      background: n.read_at ? "transparent" : "var(--accent-softer)",
                    }}
                    className="hover:bg-[var(--accent-soft)] transition-colors last:border-0"
                  >
                    <div style={{ width: 28, height: 28, borderRadius: 99, background: cfg.bg, color: cfg.color, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      {cfg.icon}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: 12, fontWeight: 500, color: "var(--text)" }} className="truncate">{n.title}</p>
                      {n.body && (
                        <p style={{ fontSize: 11, color: "var(--text-2)", marginTop: 2 }} className="line-clamp-2">{n.body}</p>
                      )}
                      <p style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-3)", marginTop: 3 }}>{timeAgo(n.created_at)}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
