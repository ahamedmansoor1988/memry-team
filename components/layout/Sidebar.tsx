"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Inbox, GitPullRequestDraft, AlertTriangle, Activity, Settings, LogOut, FolderOpen, ArrowRightLeft, Plug, LayoutDashboard, Archive, Radio, Users } from "lucide-react";
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

export default function Sidebar({ workspaceName, userName, userAvatar, openCount = 0, projects = [] }: Props) {
  const pathname = usePathname();
  const router = useRouter();

  // Ambient sync — fires on all pages so new comments appear without manual sync
  useAmbientSync();

  async function logout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
  }

  const mainNav = [
    { href: "/inbox",     label: "Inbox",     icon: Inbox,                  badge: openCount > 0 ? openCount : null },
    { href: "/pulse",     label: "Pulse",     icon: Radio,                  badge: null },
    { href: "/team",      label: "Team",      icon: Users,                  badge: null },
    { href: "/decisions", label: "Decisions", icon: GitPullRequestDraft,    badge: null },
    { href: "/risks",     label: "Risks",     icon: AlertTriangle,          badge: null },
    { href: "/activity",  label: "Activity",  icon: Activity,               badge: null },
    { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard,        badge: null },
    { href: "/handoffs",      label: "Handoffs",     icon: ArrowRightLeft, badge: null },
    { href: "/integrations",  label: "Integrations", icon: Plug,           badge: null },
    { href: "/archive",       label: "Archive",      icon: Archive,        badge: null },
  ];

  return (
    <aside className="w-52 min-w-52 h-screen bg-[#111116] border-r border-white/[0.05] flex flex-col sticky top-0">
      {/* Logo */}
      <div className="px-4 pt-5 pb-4">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-white/10 flex items-center justify-center flex-shrink-0">
            <span className="text-white font-bold text-sm">m</span>
          </div>
          <span className="text-white font-semibold text-sm tracking-tight">memry</span>
        </div>
        {workspaceName && (
          <p className="text-white/25 text-[11px] mt-1 pl-[38px] truncate">{workspaceName}</p>
        )}
      </div>

      {/* Main nav */}
      <nav className="px-2 mb-4">
        {mainNav.map(item => {
          const active = pathname === item.href || pathname.startsWith(item.href + "/");
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center justify-between gap-2 px-3 py-2 rounded-lg mb-0.5 text-[13px] transition-colors",
                active
                  ? "bg-white/8 text-white font-medium"
                  : "text-white/40 hover:text-white/70 hover:bg-white/[0.04]"
              )}
            >
              <span className="flex items-center gap-2.5">
                <Icon size={15} />
                {item.label}
              </span>
              {item.badge !== null && item.badge !== undefined && (
                <span className={cn(
                  "text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center",
                  active ? "bg-white/20 text-white" : "bg-white/10 text-white/50"
                )}>
                  {(item.badge as number) > 99 ? "99+" : item.badge}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* Projects */}
      {projects.length > 0 && (
        <div className="px-4 mb-3">
          <p className="text-white/20 text-[10px] font-semibold uppercase tracking-widest mb-2">Projects</p>
          {projects.map(project => {
            const active = pathname.includes(project.id);
            return (
              <Link
                key={project.id}
                href={`/projects`}
                className={cn(
                  "flex items-center gap-2 px-1 py-1.5 rounded-lg text-[13px] transition-colors mb-0.5",
                  active ? "text-white/80" : "text-white/35 hover:text-white/60"
                )}
              >
                <FolderOpen size={13} className="flex-shrink-0" />
                <span className="truncate">{project.name}</span>
              </Link>
            );
          })}
        </div>
      )}

      <div className="flex-1" />

      {/* Bottom */}
      <div className="px-2 py-3 border-t border-white/[0.05]">
        <Link
          href="/settings"
          className={cn(
            "flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] mb-0.5 transition-colors",
            pathname.startsWith("/settings")
              ? "bg-white/8 text-white font-medium"
              : "text-white/40 hover:text-white/70 hover:bg-white/[0.04]"
          )}
        >
          <Settings size={15} />
          Settings
        </Link>

        <div className="flex items-center gap-2.5 px-3 py-2 mt-1">
          {userAvatar ? (
            <img src={userAvatar} alt="" className="w-6 h-6 rounded-full flex-shrink-0 object-cover" />
          ) : (
            <div className="w-6 h-6 rounded-full bg-white/10 flex items-center justify-center flex-shrink-0">
              <span className="text-white/60 text-[10px] font-bold">
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
