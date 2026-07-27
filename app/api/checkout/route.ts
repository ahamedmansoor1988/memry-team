import { NextRequest, NextResponse } from "next/server";
import { createClient as createAuthClient } from "@/lib/supabase/server";
import { createOrder } from "@/lib/paypal";
import { findCreditTier } from "@/lib/credit-tiers";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const supabase = await createAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  let body: { credits?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const tier = findCreditTier(body.credits ?? NaN);
  if (!tier) return NextResponse.json({ error: "Invalid credit pack selected." }, { status: 400 });

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? new URL(req.url).origin;

  try {
    const { approveUrl } = await createOrder({
      // custom_id round-trips through PayPal untouched — the buyer can't
      // tamper with it — so it's the source of truth for what to grant on
      // capture, not just who to credit. Both values are server-computed
      // (the tier lookup above), never taken directly from client input.
      customId: `${user.id}|${tier.credits}`,
      amount: tier.priceUsd,
      currency: "USD",
      returnUrl: `${appUrl}/api/paypal-capture`,
      cancelUrl: `${appUrl}/pricing?checkout=cancelled`,
    });

    return NextResponse.json({ approveUrl });
  } catch (err) {
    console.error("[checkout] error:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Checkout failed." }, { status: 500 });
  }
}
