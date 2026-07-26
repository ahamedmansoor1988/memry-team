import { NextResponse } from "next/server";
import { createClient as createAuthClient } from "@/lib/supabase/server";
import { createOrder } from "@/lib/paypal";

export const dynamic = "force-dynamic";

const CREDIT_PACK_PRICE_USD = "20.00";

export async function POST(req: Request) {
  const supabase = await createAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? new URL(req.url).origin;

  try {
    const { approveUrl } = await createOrder({
      userId: user.id,
      amountUsd: CREDIT_PACK_PRICE_USD,
      returnUrl: `${appUrl}/api/paypal-capture`,
      cancelUrl: `${appUrl}/pricing?checkout=cancelled`,
    });

    return NextResponse.json({ approveUrl });
  } catch (err) {
    console.error("[checkout] error:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Checkout failed." }, { status: 500 });
  }
}
