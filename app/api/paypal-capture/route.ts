import { NextRequest, NextResponse } from "next/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { createClient as createAuthClient } from "@/lib/supabase/server";
import { captureOrder } from "@/lib/paypal";
import { mintApiKey } from "@/lib/api-keys";

export const dynamic = "force-dynamic";

const CREDITS_PER_PACK = 1000;
const NEW_KEY_COOKIE = "loupe_new_api_key";

function admin() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

export async function GET(req: NextRequest) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? new URL(req.url).origin;
  const orderId = req.nextUrl.searchParams.get("token"); // PayPal names the order id "token" on return

  if (!orderId) {
    return NextResponse.redirect(`${appUrl}/pricing?checkout=error`);
  }

  const supabase = await createAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(`${appUrl}/login?redirect=/pricing`);
  }

  const db = admin();

  // Idempotency: if this order was already captured (e.g. the user refreshed
  // this return URL), don't grant credits a second time.
  const { data: existingPurchase } = await db
    .from("credit_purchases")
    .select("id")
    .eq("paypal_order_id", orderId)
    .maybeSingle();
  if (existingPurchase) {
    return NextResponse.redirect(`${appUrl}/agents/settings?checkout=already-processed`);
  }

  let captured;
  try {
    captured = await captureOrder(orderId);
  } catch (err) {
    console.error("[paypal-capture] capture failed:", err);
    return NextResponse.redirect(`${appUrl}/pricing?checkout=error`);
  }

  const captureStatus = captured.purchase_units?.[0]?.payments?.captures?.[0]?.status;
  if (captured.status !== "COMPLETED" || captureStatus !== "COMPLETED") {
    console.error("[paypal-capture] order not completed:", captured.status, captureStatus);
    return NextResponse.redirect(`${appUrl}/pricing?checkout=error`);
  }

  await db.from("credit_purchases").insert({
    user_id: user.id,
    paypal_order_id: orderId,
    credits: CREDITS_PER_PACK,
    amount_usd: "20.00",
    status: "completed",
  });

  // Top up an existing active key, or mint a new one if the user has none yet.
  const { data: existingKey } = await db
    .from("api_keys")
    .select("id, credits_remaining, credits_granted")
    .eq("user_id", user.id)
    .is("revoked_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const res = NextResponse.redirect(`${appUrl}/agents/settings?checkout=success`);

  if (existingKey) {
    await db
      .from("api_keys")
      .update({
        credits_remaining: existingKey.credits_remaining + CREDITS_PER_PACK,
        credits_granted: existingKey.credits_granted + CREDITS_PER_PACK,
      })
      .eq("id", existingKey.id);
  } else {
    const minted = await mintApiKey(user.id, CREDITS_PER_PACK, "Purchased via PayPal");
    // Shown once: stash the raw key in a short-lived httpOnly cookie so the
    // settings page can reveal it exactly once, then it's gone for good.
    res.cookies.set(NEW_KEY_COOKIE, minted.rawKey, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      maxAge: 120,
      path: "/",
    });
  }

  return res;
}
