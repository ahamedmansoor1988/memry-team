"use client";

import { useState } from "react";
import { ChevronDown, HelpCircle } from "lucide-react";

export function ScanHelpToggle({ label = "How this works", children }: { label?: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-5">
      <button
        onClick={() => setOpen(o => !o)}
        className="inline-flex items-center gap-1.5 text-[12px] font-medium text-[#71717a] transition-colors hover:text-[#0f0f0f]"
      >
        <HelpCircle size={13} />
        {label}
        <ChevronDown size={13} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && <div className="mt-3">{children}</div>}
    </div>
  );
}
