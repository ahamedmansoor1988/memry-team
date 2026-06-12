"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Home, Inbox, FolderKanban, ListChecks, ShieldAlert, Sparkles, Users, Plug,
  Settings, LogOut,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useAmbientSync } from "@/lib/hooks/useAmbientSync";

interface Props {
  workspaceName?: string;
  userName?: string;
  userAvatar?: string | null;
  openCount?: number;
}

export default function Sidebar({ workspaceName, userName, userAvatar, openCount = 0 }: Props) {
  const pathname = usePathname();
  const router   = useRouter();

  useAmbientSync();

  async function logout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
  }

  const nav = [
    { href: "/home",         label: "Home",         icon: Home,         badge: null },
    { href: "/inbox",        label: "Inbox",        icon: Inbox,        badge: openCount > 0 ? openCount : null },
    { href: "/projects",     label: "Projects",     icon: FolderKanban, badge: null },
    { href: "/decisions",    label: "Decisions",    icon: ListChecks,   badge: null },
    { href: "/risks",        label: "Risks",        icon: ShieldAlert,  badge: null },
    { href: "/search",       label: "Ask Memry",    icon: Sparkles,     badge: null },
    { href: "/people",       label: "People",       icon: Users,        badge: null },
    { href: "/integrations", label: "Integrations", icon: Plug,         badge: null },
  ];

  function isActive(href: string) {
    if (href === "/inbox") return pathname === "/inbox" || pathname.startsWith("/inbox/");
    return pathname === href || pathname.startsWith(href + "/");
  }

  const initials = (userName ?? "?")[0]?.toUpperCase();

  return (
    <aside style={{ width: 248, minWidth: 248, background: "var(--sidebar-bg)", borderRight: "1px solid var(--border)" }} className="h-screen flex flex-col sticky top-0">

      {/* Logo + workspace */}
      <div className="px-4 pt-4 pb-3" style={{ borderBottom: "1px solid var(--border-2)" }}>
        <div className="flex items-center gap-2.5">
          <div style={{ width: 30, height: 30, background: "var(--accent)", borderRadius: 9 }} className="flex items-center justify-center shrink-0">
            <span style={{ color: "var(--accent-ink)", fontWeight: 700, fontSize: 13 }}>M</span>
          </div>
          <div className="min-w-0">
            <div style={{ fontWeight: 600, fontSize: 13, color: "var(--text)", letterSpacing: "-0.01em" }}>memry</div>
            {workspaceName && (
              <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 1 }} className="truncate">{workspaceName}</div>
            )}
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-2 pt-3">
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 600, letterSpacing: "0.08em", color: "var(--text-3)", textTransform: "uppercase", padding: "0 10px", marginBottom: 4 }}>
          Workspace
        </div>
        {nav.map(item => {
          const active = isActive(item.href);
          const Icon   = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "6px 10px",
                borderRadius: 7,
                marginBottom: 1,
                fontSize: 13,
                fontWeight: active ? 500 : 400,
                color: active ? "var(--accent-text)" : "var(--text-2)",
                background: active ? "var(--accent-soft)" : "transparent",
                textDecoration: "none",
                position: "relative",
                transition: "background 0.1s, color 0.1s",
              }}
              className="group"
            >
              {active && (
                <span style={{ position: "absolute", left: 0, top: "50%", transform: "translateY(-50%)", width: 3, height: 16, background: "var(--accent)", borderRadius: "0 2px 2px 0" }} />
              )}
              <span className="flex items-center gap-2.5">
                <Icon style={{ width: 15, height: 15, flexShrink: 0, opacity: active ? 1 : 0.7 }} />
                {item.label}
              </span>
              {item.badge !== null && item.badge !== undefined && (
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 500, background: active ? "var(--accent-border)" : "var(--border)", color: active ? "var(--accent-text)" : "var(--text-2)", borderRadius: 99, padding: "1px 6px", minWidth: 18, textAlign: "center" }}>
                  {(item.badge as number) > 99 ? "99+" : item.badge}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="px-2 pb-3 pt-2" style={{ borderTop: "1px solid var(--border-2)" }}>
        <Link
          href="/settings"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "6px 10px",
            borderRadius: 7,
            fontSize: 13,
            fontWeight: pathname.startsWith("/settings") ? 500 : 400,
            color: pathname.startsWith("/settings") ? "var(--accent-text)" : "var(--text-2)",
            background: pathname.startsWith("/settings") ? "var(--accent-soft)" : "transparent",
            textDecoration: "none",
            marginBottom: 4,
          }}
        >
          <Settings style={{ width: 15, height: 15, opacity: 0.7 }} />
          Settings
        </Link>

        <div className="flex items-center gap-2.5 px-2.5 py-1.5">
          {userAvatar ? (
            <img src={userAvatar} alt="" style={{ width: 24, height: 24, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />
          ) : (
            <div style={{ width: 24, height: 24, borderRadius: "50%", background: "var(--accent)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <span style={{ color: "var(--accent-ink)", fontSize: 10, fontWeight: 700 }}>{initials}</span>
            </div>
          )}
          <span style={{ fontSize: 12, color: "var(--text-2)" }} className="truncate flex-1">{userName}</span>
          <button onClick={logout} title="Sign out" style={{ color: "var(--text-3)", cursor: "pointer", background: "none", border: "none", padding: 2 }} className="hover:opacity-70 transition-opacity">
            <LogOut style={{ width: 13, height: 13 }} />
          </button>
        </div>
      </div>
    </aside>
  );
}
