"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Inbox, GitPullRequestDraft, AlertTriangle, Activity, Settings, LogOut,
         ArrowRightLeft, Plug, LayoutDashboard, Archive, Users, BookOpen, Search, Video } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { useAmbientSync } from "@/lib/hooks/useAmbientSync";

interface Props {
  workspaceName?: string;
  userName?: string;
  userAvatar?: string | null;
  openCount?: number;
  projects?: { id: string; name: string }[];
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

  const mainNav = [
    { href: "/inbox",        label: "Inbox",        icon: Inbox,               badge: openCount > 0 ? openCount : null },
    { href: "/search",       label: "Search",       icon: Search,              badge: null },
    { href: "/team",         label: "Team",         icon: Users,               badge: null },
    { href: "/decisions",    label: "Decisions",    icon: GitPullRequestDraft, badge: null },
    { href: "/meetings",     label: "Meetings",     icon: Video,               badge: null },
    { href: "/memory",       label: "Memory",       icon: BookOpen,            badge: null },
    { href: "/risks",        label: "Risks",        icon: AlertTriangle,       badge: null },
    { href: "/activity",     label: "Activity",     icon: Activity,            badge: null },
    { href: "/dashboard",    label: "Dashboard",    icon: LayoutDashboard,     badge: null },
    { href: "/handoffs",     label: "Handoffs",     icon: ArrowRightLeft,      badge: null },
    { href: "/integrations", label: "Integrations", icon: Plug,                badge: null },
    { href: "/archive",      label: "Archive",      icon: Archive,             badge: null },
  ];

  return (
    <aside className="w-52 min-w-52 h-screen bg-white border-r border-zinc-200 flex flex-col sticky top-0">

      {/* ── Logo ── */}
      <div className="px-4 pt-5 pb-4 border-b border-zinc-100">
        <div className="flex items-center">
          <div className="w-7 h-7 rounded-md bg-indigo-600 flex items-center justify-center flex-shrink-0">
            <span className="text-white font-bold text-xs">M</span>
          </div>
          <span className="text-zinc-900 font-semibold text-sm ml-2 tracking-tight">memry</span>
        </div>
        {workspaceName && (
          <p className="text-zinc-400 text-[11px] mt-1.5 pl-[36px] truncate">{workspaceName}</p>
        )}
      </div>

      {/* ── Main nav ── */}
      <nav className="px-2 pt-3 flex-1 overflow-y-auto">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-400 px-3 mb-1">
          Workspace
        </p>
        {mainNav.map(item => {
          const active = pathname === item.href || pathname.startsWith(item.href + "/");
          const Icon   = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center justify-between gap-2 px-3 py-1.5 rounded-md mb-0.5 text-sm transition-colors",
                active
                  ? "bg-indigo-50 text-indigo-600 font-medium"
                  : "text-zinc-500 hover:bg-zinc-50 hover:text-zinc-900"
              )}
            >
              <span className="flex items-center gap-2.5">
                <Icon className="w-4 h-4 flex-shrink-0" />
                {item.label}
              </span>
              {item.badge !== null && item.badge !== undefined && (
                <span className="ml-auto text-xs bg-zinc-100 text-zinc-500 px-1.5 py-0.5 rounded-full min-w-[20px] text-center">
                  {(item.badge as number) > 99 ? "99+" : item.badge}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* ── Bottom ── */}
      <div className="px-2 py-3 border-t border-zinc-100">
        <Link
          href="/settings"
          className={cn(
            "flex items-center gap-2.5 px-3 py-1.5 rounded-md text-sm mb-1 transition-colors",
            pathname.startsWith("/settings")
              ? "bg-indigo-50 text-indigo-600 font-medium"
              : "text-zinc-500 hover:bg-zinc-50 hover:text-zinc-900"
          )}
        >
          <Settings className="w-4 h-4" />
          Settings
        </Link>

        <div className="flex items-center gap-2.5 px-3 py-2 mt-1">
          {userAvatar ? (
            <img src={userAvatar} alt="" className="w-6 h-6 rounded-full flex-shrink-0 object-cover" />
          ) : (
            <div className="w-6 h-6 rounded-full bg-indigo-600 flex items-center justify-center flex-shrink-0">
              <span className="text-white text-[10px] font-bold">
                {(userName ?? "?")[0]?.toUpperCase()}
              </span>
            </div>
          )}
          <span className="text-zinc-500 text-xs truncate flex-1">{userName}</span>
          <button onClick={logout} className="text-zinc-300 hover:text-zinc-600 transition-colors">
            <LogOut className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </aside>
  );
}
