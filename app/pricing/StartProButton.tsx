"use client";

import { useState } from "react";
import { ArrowRight, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export function StartProButton({ credits }: { credits: number }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function startCheckout() {
    setLoading(true);
    setError(null);
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        window.location.href = "/login?redirect=/pricing";
        return;
      }

      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credits }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Checkout failed.");
      window.location.href = data.approveUrl;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setLoading(false);
    }
  }

  return (
    <div className="mb-6">
      <button
        onClick={startCheckout}
        disabled={loading}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-white px-4 py-2.5 text-[13px] font-medium text-[#0f0f0f] transition-colors hover:bg-[#f5f5f5] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {loading ? <Loader2 size={13} className="animate-spin" /> : <ArrowRight size={13} />}
        {loading ? "Redirecting to PayPal…" : `Buy ${credits.toLocaleString()} credits`}
      </button>
      {error && <p className="mt-2 text-[11px] text-red-300">{error}</p>}
    </div>
  );
}
