"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Bell, AlertCircle, Clock, TrendingUp, FileText, Archive } from "lucide-react";

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

const TYPE_ICON: Record<string, { bg: string; icon: React.ReactNode }> = {
  new_blocker:        { bg: "bg-red-50",   icon: <AlertCircle className="w-4 h-4 text-red-500" /> },
  decision_overdue:   { bg: "bg-zinc-100", icon: <Clock className="w-4 h-4 text-zinc-500" /> },
  escalated:          { bg: "bg-zinc-900", icon: <TrendingUp className="w-4 h-4 text-white" /> },
  weekly_brief_ready: { bg: "bg-zinc-100", icon: <FileText className="w-4 h-4 text-zinc-500" /> },
  auto_archived:      { bg: "bg-zinc-100", icon: <Archive className="w-4 h-4 text-zinc-400" /> },
};

const DEFAULT_ICON = { bg: "bg-zinc-100", icon: <Bell className="w-4 h-4 text-zinc-400" /> };

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
    } catch {
      // silently fail
    }
  }, []);

  useEffect(() => {
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 60_000);
    return () => clearInterval(interval);
  }, [fetchNotifications]);

  // Close on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
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
    if (n.feedback_item_id) {
      // Navigate to inbox item — we don't know projectId here, use activity as fallback
      router.push(`/activity`);
    } else {
      router.push("/activity");
    }
    await fetchNotifications();
  }

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Bell button */}
      <button
        onClick={() => setOpen(o => !o)}
        className="relative inline-flex items-center justify-center w-8 h-8 rounded-md hover:bg-zinc-100 transition-colors"
        aria-label="Notifications"
      >
        <Bell className="w-4 h-4 text-zinc-500" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-zinc-900 text-white text-[9px] font-bold flex items-center justify-center leading-none">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute right-0 top-10 w-80 z-50 bg-white border border-zinc-200 rounded-xl shadow-lg overflow-hidden">
          {/* Header */}
          <div className="px-4 py-3 border-b border-zinc-100 flex justify-between items-center">
            <span className="text-sm font-semibold text-zinc-900">Notifications</span>
            {notifications.length > 0 && (
              <button
                onClick={markAllRead}
                className="text-xs text-zinc-400 hover:text-zinc-600 cursor-pointer transition-colors"
              >
                Mark all read
              </button>
            )}
          </div>

          {/* List */}
          {notifications.length === 0 ? (
            <div className="py-12 text-center">
              <Bell className="w-8 h-8 text-zinc-300 mx-auto mb-2" />
              <p className="text-sm text-zinc-400">You&apos;re all caught up</p>
            </div>
          ) : (
            <div className="max-h-96 overflow-y-auto">
              {notifications.map(n => {
                const { bg, icon } = TYPE_ICON[n.type] ?? DEFAULT_ICON;
                return (
                  <div
                    key={n.id}
                    onClick={() => handleNotificationClick(n)}
                    className={`px-4 py-3 flex gap-3 cursor-pointer hover:bg-zinc-50 transition-colors border-b border-zinc-100 last:border-0 ${n.read_at ? "bg-white" : "bg-zinc-50"}`}
                  >
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${bg}`}>
                      {icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-zinc-900 truncate">{n.title}</p>
                      {n.body && (
                        <p className="text-xs text-zinc-500 mt-0.5 line-clamp-2">{n.body}</p>
                      )}
                      <p className="text-[10px] text-zinc-400 mt-1">{timeAgo(n.created_at)}</p>
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
