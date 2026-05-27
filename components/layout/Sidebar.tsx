"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard, Inbox, Columns2, FolderOpen,
  ArrowRightLeft, Settings, LogOut,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";

const nav = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/inbox",     label: "Inbox",     icon: Inbox,        badge: true },
  { href: "/board",     label: "Board",     icon: Columns2 },
  { href: "/projects",  label: "Projects",  icon: FolderOpen },
  { href: "/handoffs",  label: "Handoffs",  icon: ArrowRightLeft },
];

interface Props {
  workspaceName?: string;
  userName?: string;
  userAvatar?: string | null;
  openCount?: number;
}

export default function Sidebar({ workspaceName, userName, userAvatar, openCount = 0 }: Props) {
  const pathname = usePathname();
  const router = useRouter();

  async function logout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
  }

  return (
    <aside className="w-56 min-w-56 h-screen bg-[#1a1a24] border-r border-white/[0.06] flex flex-col sticky top-0">
      {/* Logo */}
      <div className="px-4 py-5">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-violet-600 flex items-center justify-center flex-shrink-0">
            <span className="text-white font-bold text-sm">m</span>
          </div>
          <span className="text-white font-bold text-base tracking-tight">memry.team</span>
        </div>
        {workspaceName && (
          <p className="text-white/30 text-xs mt-1 pl-[38px] truncate">{workspaceName}</p>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 px-2 overflow-y-auto">
        {nav.map(item => {
          const active = pathname === item.href || pathname.startsWith(item.href + "/");
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center justify-between gap-2 px-3 py-2 rounded-lg mb-0.5 text-sm transition-colors",
                active
                  ? "bg-violet-600/20 text-violet-400 font-medium"
                  : "text-white/40 hover:text-white/70 hover:bg-white/5"
              )}
            >
              <span className="flex items-center gap-2.5">
                <Icon size={16} />
                {item.label}
              </span>
              {item.badge && openCount > 0 && (
                <span className="bg-violet-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center">
                  {openCount > 99 ? "99+" : openCount}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* Bottom */}
      <div className="px-2 py-3 border-t border-white/[0.06]">
        <Link
          href="/settings"
          className={cn(
            "flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm mb-0.5 transition-colors",
            pathname.startsWith("/settings")
              ? "bg-violet-600/20 text-violet-400 font-medium"
              : "text-white/40 hover:text-white/70 hover:bg-white/5"
          )}
        >
          <Settings size={16} />
          Settings
        </Link>

        {/* User */}
        <div className="flex items-center gap-2.5 px-3 py-2 mt-1">
          {userAvatar ? (
            <img src={userAvatar} alt="" className="w-6 h-6 rounded-full flex-shrink-0" />
          ) : (
            <div className="w-6 h-6 rounded-full bg-violet-600/30 flex items-center justify-center flex-shrink-0">
              <span className="text-violet-400 text-[10px] font-bold">
                {(userName ?? "?")[0]?.toUpperCase()}
              </span>
            </div>
          )}
          <span className="text-white/30 text-xs truncate flex-1">{userName}</span>
          <button onClick={logout} className="text-white/20 hover:text-white/50 transition-colors">
            <LogOut size={13} />
          </button>
        </div>
      </div>
    </aside>
  );
}
