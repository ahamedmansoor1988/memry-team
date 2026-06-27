"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ScanSearch, LogOut, History } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

const AGENTS = [
  { id: "figma-compare", label: "Figma vs Live", icon: ScanSearch },
  { id: "history",       label: "History",        icon: History    },
];

interface Props { userEmail: string; }

export function Sidebar({ userEmail }: Props) {
  const pathname = usePathname();
  const router   = useRouter();

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
  }

  return (
    <aside className="flex h-screen w-[220px] shrink-0 flex-col bg-white border-r border-black/[0.06] text-[#0f0f0f]">
      {/* Logo */}
      <div className="flex h-[45px] items-center gap-2.5 px-4 border-b border-black/[0.06] shrink-0">
        <div className="flex h-6 w-6 items-center justify-center rounded-md bg-[#0f0f0f]">
          <span className="text-[11px] font-bold text-white tracking-tight">L</span>
        </div>
        <span className="text-[14px] font-semibold tracking-tight text-[#0f0f0f]">Loupe</span>
      </div>

      {/* Agents */}
      <div className="px-3 pt-4">
        <p className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-widest text-[#9ca3af]">Agents</p>
        <nav className="space-y-0.5">
          {AGENTS.map((agent) => {
            const Icon   = agent.icon;
            const active = pathname.startsWith(`/agents/${agent.id}`);
            return (
              <Link
                key={agent.id}
                href={`/agents/${agent.id}`}
                className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 transition-colors ${
                  active
                    ? "bg-black/[0.06] text-[#0f0f0f]"
                    : "text-[#6b7280] hover:bg-black/[0.03] hover:text-[#0f0f0f]"
                }`}
              >
                <Icon size={14} strokeWidth={1.75} />
                <span className="text-[13px] font-medium">{agent.label}</span>
              </Link>
            );
          })}
        </nav>
      </div>

      {/* Footer */}
      <div className="mt-auto border-t border-black/[0.06] px-3 py-3">
        <div className="flex items-center gap-2.5 rounded-lg px-2 py-1.5">
          <div className="h-6 w-6 shrink-0 rounded-full bg-black/[0.07] flex items-center justify-center">
            <span className="text-[10px] font-semibold text-[#6b7280]">{userEmail[0]?.toUpperCase()}</span>
          </div>
          <span className="flex-1 truncate text-[11px] text-[#9ca3af]">{userEmail}</span>
          <button onClick={signOut} title="Sign out" className="text-[#9ca3af] hover:text-[#6b7280] transition-colors">
            <LogOut size={13} />
          </button>
        </div>
      </div>
    </aside>
  );
}
