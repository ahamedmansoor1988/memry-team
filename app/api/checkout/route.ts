import { NextResponse } from "next/server";
import { createClient as createAuthClient } from "@/lib/supabase/server";
import { createOrder } from "@/lib/paypal";

export const dynamic = "force-dynamic";

// USD — INR is rejected outright by PayPal's Orders API (CURRENCY_NOT_SUPPORTED),
// so it was never a viable option. The earlier "seller doesn't accept payments
// in your currency" error happens at payment capture, not order creation —
// it means the India-based business account needs multi-currency receiving
// enabled (Account Settings > Money), not a different currency code here.
const CREDIT_PACK_PRICE_USD = "20.00";

export async function POST(req: Request) {
  const supabase = await createAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? new URL(req.url).origin;

  try {
    const { approveUrl } = await createOrder({
      userId: user.id,
      amount: CREDIT_PACK_PRICE_USD,
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
