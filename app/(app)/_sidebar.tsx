"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { ScanSearch, LogOut, History, Settings, MonitorCheck, Accessibility, GitCompareArrows } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

const NAV = [
  { id: "figma-compare", label: "Figma vs Live", icon: ScanSearch },
  { id: "responsive",    label: "Layout QA",    icon: MonitorCheck },
  { id: "accessibility", label: "Accessibility", icon: Accessibility },
  { id: "screenshot-diff", label: "Screenshot Diff", icon: GitCompareArrows },
  { id: "history",       label: "History",        icon: History    },
];

interface Props { userEmail: string; }

export function Sidebar({ userEmail }: Props) {
  const pathname = usePathname();

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    window.location.href = "/login";
  }

  return (
    <aside className="flex h-screen w-[220px] shrink-0 flex-col bg-white border-r border-black/[0.06] text-[#0f0f0f]">
      {/* Logo */}
      <div className="flex h-[45px] items-center gap-2.5 px-4 border-b border-black/[0.06] shrink-0">
        <Image src="/loupe.svg" alt="Loupe" width={482} height={207} className="h-7 w-auto" />
        
      </div>

      {/* Nav */}
      <div className="px-3 pt-4 flex-1">
        <p className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-widest text-[#71717a]">Agents</p>
        <nav className="space-y-0.5">
          {NAV.map((item) => {
            const Icon   = item.icon;
            const active = pathname.startsWith(`/agents/${item.id}`);
            return (
              <Link
                key={item.id}
                href={`/agents/${item.id}`}
                className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 transition-colors ${
                  active ? "bg-black/[0.06] text-[#0f0f0f]" : "text-[#4b5563] hover:bg-black/[0.03] hover:text-[#0f0f0f]"
                }`}
              >
                <Icon size={14} strokeWidth={1.75} />
                <span className="text-[13px] font-medium">{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </div>

      {/* Footer */}
      <div className="border-t border-black/[0.06] px-3 py-3 space-y-0.5">
        <Link
          href="/agents/settings"
          className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 transition-colors ${
            pathname.startsWith("/agents/settings") ? "bg-black/[0.06] text-[#0f0f0f]" : "text-[#4b5563] hover:bg-black/[0.03] hover:text-[#0f0f0f]"
          }`}
        >
          <Settings size={14} strokeWidth={1.75} />
          <span className="text-[13px] font-medium">Settings</span>
        </Link>
        <div className="flex items-center gap-2.5 rounded-lg px-2 py-1.5">
          <div className="h-6 w-6 shrink-0 rounded-full bg-black/[0.07] flex items-center justify-center">
            <span className="text-[10px] font-semibold text-[#4b5563]">{userEmail[0]?.toUpperCase()}</span>
          </div>
          <span className="flex-1 truncate text-[11px] text-[#71717a]">{userEmail}</span>
          <button onClick={signOut} title="Sign out" className="text-[#71717a] hover:text-[#4b5563] transition-colors">
            <LogOut size={13} />
          </button>
        </div>
      </div>
    </aside>
  );
}
