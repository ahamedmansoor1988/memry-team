"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ScanSearch, LogOut } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

const AGENTS = [
  {
    id: "figma-compare",
    label: "Figma vs Live",
    icon: ScanSearch,
    description: "Compare Figma frames against live websites and annotate discrepancies.",
  },
];

interface Props {
  userEmail: string;
}

export function Sidebar({ userEmail }: Props) {
  const pathname = usePathname();
  const router   = useRouter();

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
  }

  return (
    <aside className="flex h-screen border-r border-[#e8e8ec] bg-white">
      {/* Icon rail */}
      <div className="flex w-14 flex-col items-center gap-1 border-r border-[#e8e8ec] py-4">
        {/* Logo mark */}
        <Link href="/agents" className="mb-4 flex h-8 w-8 items-center justify-center rounded-lg bg-[#18181b]">
          <span className="text-[13px] font-bold text-white tracking-tight">L</span>
        </Link>

        {AGENTS.map((agent) => {
          const Icon   = agent.icon;
          const active = pathname.startsWith(`/agents/${agent.id}`);
          return (
            <Link
              key={agent.id}
              href={`/agents/${agent.id}`}
              title={agent.label}
              className={`flex h-9 w-9 items-center justify-center rounded-lg transition-colors ${
                active
                  ? "bg-[#18181b] text-white"
                  : "text-[#9a9aa5] hover:bg-[#f1f1f4] hover:text-[#17171c]"
              }`}
            >
              <Icon size={16} strokeWidth={1.75} />
            </Link>
          );
        })}

        {/* Sign out at bottom */}
        <div className="mt-auto">
          <button
            onClick={signOut}
            title="Sign out"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-[#9a9aa5] transition-colors hover:bg-[#f1f1f4] hover:text-[#17171c]"
          >
            <LogOut size={14} />
          </button>
        </div>
      </div>

      {/* Agent list panel */}
      <div className="flex w-52 flex-col">
        <div className="border-b border-[#e8e8ec] px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-[#9a9aa5]">Agents</p>
        </div>
        <nav className="flex-1 overflow-y-auto p-2">
          {AGENTS.map((agent) => {
            const active = pathname.startsWith(`/agents/${agent.id}`);
            return (
              <Link
                key={agent.id}
                href={`/agents/${agent.id}`}
                className={`flex flex-col gap-0.5 rounded-lg px-3 py-2.5 transition-colors ${
                  active ? "bg-[#f1f1f4]" : "hover:bg-[#f7f7f8]"
                }`}
              >
                <span className={`text-[13px] font-medium ${active ? "text-[#17171c]" : "text-[#5b5b66]"}`}>
                  {agent.label}
                </span>
                <span className="text-[11px] leading-[15px] text-[#9a9aa5]">{agent.description}</span>
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-[#e8e8ec] px-4 py-3">
          <p className="text-[11px] text-[#9a9aa5] truncate">{userEmail}</p>
        </div>
      </div>
    </aside>
  );
}
