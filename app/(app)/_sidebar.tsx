"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Plug, BrainCircuit, FolderKanban, Settings, LogOut } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/integrations", label: "Integrations", icon: Plug },
  { href: "/decisions",    label: "Decisions",    icon: BrainCircuit },
  { href: "/projects",     label: "Projects",     icon: FolderKanban },
  { href: "/settings",     label: "Settings",     icon: Settings },
];

interface Props {
  workspaceName: string;
  userEmail: string;
}

export function Sidebar({ workspaceName, userEmail }: Props) {
  const pathname = usePathname();
  const router = useRouter();

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
  }

  return (
    <aside className="w-[220px] shrink-0 flex flex-col h-full border-r border-border bg-sidebar-bg">
      {/* Logo */}
      <div className="px-4 py-5 border-b border-border">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-accent flex items-center justify-center shrink-0">
            <span className="text-accent-ink font-bold text-sm">m</span>
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-text leading-tight truncate">memry</p>
            <p className="text-xs text-text-3 truncate">{workspaceName}</p>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-2 py-3 space-y-0.5">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(href + "/");
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-2.5 px-2.5 py-2 rounded-md text-sm transition-colors",
                active
                  ? "bg-accent-soft text-accent-text font-medium"
                  : "text-text-2 hover:text-text hover:bg-border-2"
              )}
            >
              <Icon size={15} className="shrink-0" />
              {label}
            </Link>
          );
        })}
      </nav>

      {/* User */}
      <div className="px-3 py-3 border-t border-border">
        <div className="flex items-center gap-2 mb-2 px-1.5">
          <div className="w-5 h-5 rounded-full bg-accent-soft shrink-0 flex items-center justify-center">
            <span className="text-2xs text-accent-text font-semibold">
              {userEmail[0]?.toUpperCase()}
            </span>
          </div>
          <p className="text-xs text-text-3 truncate flex-1">{userEmail}</p>
        </div>
        <button
          onClick={signOut}
          className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-xs text-text-3 hover:text-text hover:bg-border-2 transition-colors"
        >
          <LogOut size={13} />
          Sign out
        </button>
      </div>
    </aside>
  );
}
