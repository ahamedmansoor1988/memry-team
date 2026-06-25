"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ScanSearch, LogOut, Plus, MessageSquare } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

const AGENTS = [
  {
    id: "figma-compare",
    label: "Figma vs Live",
    icon: ScanSearch,
    description: "Compare Figma frames against live websites",
  },
  {
    id: "comment-watcher",
    label: "Comment Clarity",
    icon: MessageSquare,
    description: "Detect vague Figma comments and ask for clarification",
  },
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
    <aside className="flex h-screen w-[220px] shrink-0 flex-col bg-[#0f0f0f] text-white">
      {/* Logo */}
      <div className="flex items-center gap-2.5 px-4 py-4 border-b border-white/[0.06]">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-white">
          <span className="text-[12px] font-bold text-[#0f0f0f] tracking-tight">L</span>
        </div>
        <span className="text-[14px] font-semibold tracking-tight text-white">Loupe</span>
      </div>

      {/* New agent button */}
      <div className="px-3 pt-3">
        <button className="flex w-full items-center gap-2 rounded-lg border border-white/[0.08] px-3 py-2 text-[12px] text-white/50 hover:bg-white/[0.04] hover:text-white/80 transition-colors">
          <Plus size={13} />
          New agent
        </button>
      </div>

      {/* Agents */}
      <div className="px-3 pt-4">
        <p className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-widest text-white/25">Agents</p>
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
                    ? "bg-white/[0.08] text-white"
                    : "text-white/50 hover:bg-white/[0.04] hover:text-white/80"
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
      <div className="mt-auto border-t border-white/[0.06] px-3 py-3">
        <div className="flex items-center gap-2.5 rounded-lg px-2 py-1.5">
          <div className="h-6 w-6 shrink-0 rounded-full bg-white/10 flex items-center justify-center">
            <span className="text-[10px] font-semibold text-white/60">{userEmail[0]?.toUpperCase()}</span>
          </div>
          <span className="flex-1 truncate text-[11px] text-white/40">{userEmail}</span>
          <button onClick={signOut} title="Sign out" className="text-white/25 hover:text-white/60 transition-colors">
            <LogOut size={13} />
          </button>
        </div>
      </div>
    </aside>
  );
}
