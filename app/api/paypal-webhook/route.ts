import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyWebhookSignature } from "@/lib/paypal";

export const dynamic = "force-dynamic";

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

const STATUS_BY_EVENT: Record<string, string> = {
  "BILLING.SUBSCRIPTION.ACTIVATED": "active",
  "BILLING.SUBSCRIPTION.CANCELLED": "cancelled",
  "BILLING.SUBSCRIPTION.SUSPENDED": "suspended",
  "BILLING.SUBSCRIPTION.EXPIRED": "expired",
};

export async function POST(req: NextRequest) {
  const body = await req.json();

  const verified = await verifyWebhookSignature({
    headers: {
      transmissionId: req.headers.get("paypal-transmission-id") ?? "",
      timestamp: req.headers.get("paypal-transmission-time") ?? "",
      signature: req.headers.get("paypal-transmission-sig") ?? "",
      certUrl: req.headers.get("paypal-cert-url") ?? "",
      authAlgo: req.headers.get("paypal-auth-algo") ?? "",
    },
    body,
  });

  if (!verified) {
    console.error("[paypal-webhook] signature verification failed");
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  const eventType = body.event_type as string;
  const status = STATUS_BY_EVENT[eventType];
  if (!status) return NextResponse.json({ ok: true, ignored: eventType });

  const subscriptionId = body.resource?.id as string | undefined;
  if (!subscriptionId) return NextResponse.json({ ok: true, ignored: "no subscription id" });

  const { error } = await admin()
    .from("subscriptions")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("paypal_subscription_id", subscriptionId);

  if (error) {
    console.error("[paypal-webhook] update error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
