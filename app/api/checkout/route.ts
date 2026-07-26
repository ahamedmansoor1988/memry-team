import { NextResponse } from "next/server";
import { createClient as createAuthClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { createSubscription } from "@/lib/paypal";

export const dynamic = "force-dynamic";

function admin() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

export async function POST(req: Request) {
  const supabase = await createAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? new URL(req.url).origin;

  try {
    const { subscriptionId, approveUrl } = await createSubscription({
      userId: user.id,
      returnUrl: `${appUrl}/agents/settings?checkout=success`,
      cancelUrl: `${appUrl}/pricing?checkout=cancelled`,
    });

    await admin().from("subscriptions").insert({
      user_id: user.id,
      paypal_subscription_id: subscriptionId,
      status: "pending",
      plan_id: process.env.PAYPAL_PLAN_ID!,
    });

    return NextResponse.json({ approveUrl });
  } catch (err) {
    console.error("[checkout] error:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Checkout failed." }, { status: 500 });
  }
}
