"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { ScanSearch, LogOut, History, Settings, MonitorCheck, Accessibility, GitCompareArrows, AlertTriangle } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { storedPatExpiryStatus, type PatExpiryStatus } from "@/lib/pat-expiry";

const NAV = [
  { id: "figma-compare", label: "Figma vs Live", icon: ScanSearch, beta: false },
  { id: "history",       label: "History",        icon: History, beta: false },
  { id: "responsive",    label: "Layout QA",    icon: MonitorCheck, beta: true },
  { id: "accessibility", label: "Accessibility", icon: Accessibility, beta: true },
  { id: "screenshot-diff", label: "Screenshot Diff", icon: GitCompareArrows, beta: true },
];

export function BetaTag({ className = "" }: { className?: string }) {
  return (
    <span className={`rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-amber-700 ${className}`}>
      Beta
    </span>
  );
}

interface Props { userEmail: string; }

export function Sidebar({ userEmail }: Props) {
  const pathname = usePathname();
  const [patWarning, setPatWarning] = useState<PatExpiryStatus | null>(null);

  useEffect(() => {
    const status = storedPatExpiryStatus();
    if (status.state === "expiring" || status.state === "expired") setPatWarning(status);
  }, [pathname]);

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
          {NAV.map((item, index) => {
            const Icon   = item.icon;
            const active = pathname.startsWith(`/agents/${item.id}`);
            const startsBeta = item.beta && !NAV[index - 1]?.beta;
            return (
              <div key={item.id}>
                {startsBeta && <div className="my-2 border-t border-black/[0.06]" />}
                <Link
                  href={`/agents/${item.id}`}
                  className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 transition-colors ${
                    active ? "bg-black/[0.06] text-[#0f0f0f]" : "text-[#4b5563] hover:bg-black/[0.03] hover:text-[#0f0f0f]"
                  }`}
                >
                  <Icon size={14} strokeWidth={1.75} />
                  <span className="flex-1 text-[13px] font-medium">{item.label}</span>
                  {item.beta && <BetaTag />}
                </Link>
              </div>
            );
          })}
        </nav>
      </div>

      {/* Footer */}
      <div className="border-t border-black/[0.06] px-3 py-3 space-y-0.5">
        {patWarning && (
          <Link
            href="/agents/settings"
            className={`mb-2 flex items-start gap-2 rounded-lg border px-2.5 py-2 transition-colors ${
              patWarning.state === "expired"
                ? "border-red-200 bg-red-50 hover:bg-red-100"
                : "border-amber-200 bg-amber-50 hover:bg-amber-100"
            }`}
          >
            <AlertTriangle size={12} className={`mt-0.5 shrink-0 ${patWarning.state === "expired" ? "text-red-600" : "text-amber-600"}`} />
            <span className={`text-[11px] leading-snug ${patWarning.state === "expired" ? "text-red-700" : "text-amber-700"}`}>
              {patWarning.message} Update it in Settings.
            </span>
          </Link>
        )}
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
