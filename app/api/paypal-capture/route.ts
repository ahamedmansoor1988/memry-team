import { NextRequest, NextResponse } from "next/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { createClient as createAuthClient } from "@/lib/supabase/server";
import { captureOrder } from "@/lib/paypal";
import { mintApiKey } from "@/lib/api-keys";
import { CREDIT_TIERS } from "@/lib/credit-tiers";

export const dynamic = "force-dynamic";

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

  // custom_id is "<userId>|<credits>", set server-side at checkout time and
  // echoed back untouched by PayPal — the buyer never had a way to alter it.
  const customId = captured.purchase_units?.[0]?.custom_id ?? "";
  const [customUserId, creditsStr] = customId.split("|");
  const credits = Number(creditsStr);
  const validTier = CREDIT_TIERS.some(t => t.credits === credits);

  if (customUserId !== user.id || !validTier) {
    console.error("[paypal-capture] custom_id mismatch or invalid tier:", customId, "session user:", user.id);
    return NextResponse.redirect(`${appUrl}/pricing?checkout=error`);
  }

  const tierPrice = CREDIT_TIERS.find(t => t.credits === credits)!.priceUsd;

  await db.from("credit_purchases").insert({
    user_id: user.id,
    paypal_order_id: orderId,
    credits,
    amount_usd: tierPrice,
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
        credits_remaining: existingKey.credits_remaining + credits,
        credits_granted: existingKey.credits_granted + credits,
      })
      .eq("id", existingKey.id);
  } else {
    const minted = await mintApiKey(user.id, credits, "Purchased via PayPal");
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
