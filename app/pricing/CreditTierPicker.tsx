"use client";

import { useState } from "react";
import { StartProButton } from "./StartProButton";
import { CREDIT_TIERS } from "@/lib/credit-tiers";

export function CreditTierPicker() {
  const [selected, setSelected] = useState(CREDIT_TIERS[CREDIT_TIERS.length - 1]); // default to the biggest pack

  return (
    <>
      <div className="flex items-baseline gap-1 mb-2">
        <span className="text-[38px] font-semibold tracking-tight text-white">${selected.priceUsd.replace(".00", "")}</span>
        <span className="text-[13px] text-white/50">one-time</span>
      </div>
      <p className="mb-4 text-[13px] leading-relaxed text-white/60">
        {selected.credits.toLocaleString()} scan credits, valid for 3 months. No subscription — buy another pack anytime.
      </p>

      <div className="mb-5 grid grid-cols-4 gap-1.5">
        {CREDIT_TIERS.map(tier => {
          const active = tier.credits === selected.credits;
          return (
            <button
              key={tier.credits}
              onClick={() => setSelected(tier)}
              className={`rounded-lg border px-1 py-2 text-center transition-colors ${
                active
                  ? "border-white bg-white text-[#0f0f0f]"
                  : "border-white/15 bg-white/[0.04] text-white/60 hover:border-white/30 hover:text-white"
              }`}
            >
              <span className="block text-[12px] font-semibold leading-tight">{tier.credits.toLocaleString()}</span>
              <span className={`mt-0.5 block text-[10px] ${active ? "text-[#71717a]" : "text-white/35"}`}>${tier.priceUsd.replace(".00", "")}</span>
            </button>
          );
        })}
      </div>

      <StartProButton credits={selected.credits} />
    </>
  );
}
