const ENV = process.env.PAYPAL_ENV === "live" ? "live" : "sandbox";
const BASE = ENV === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";

function credentials() {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const secret = process.env.PAYPAL_CLIENT_SECRET;
  if (!clientId || !secret) throw new Error("PayPal is not configured (missing PAYPAL_CLIENT_ID/SECRET).");
  return { clientId, secret };
}

async function getAccessToken(): Promise<string> {
  const { clientId, secret } = credentials();
  const res = await fetch(`${BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(`${clientId}:${secret}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`PayPal OAuth failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.access_token as string;
}

/**
 * Creates a one-time PayPal order (not a recurring subscription — PayPal's
 * Subscriptions/auto-billing product has known restrictions for India-based
 * merchant accounts under RBI recurring-payment rules, which is what broke
 * the original subscription flow. A one-time order sidesteps that entirely:
 * the user re-purchases a credit pack whenever they run low.
 */
export async function createOrder(params: { amount: string; currency: string; userId: string; returnUrl: string; cancelUrl: string }) {
  const token = await getAccessToken();
  const res = await fetch(`${BASE}/v2/checkout/orders`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      intent: "CAPTURE",
      purchase_units: [
        {
          custom_id: params.userId, // read back on capture so we know who to credit
          description: "Loupe Pro — 1,000 scan credits",
          amount: { currency_code: params.currency, value: params.amount },
        },
      ],
      application_context: {
        brand_name: "Loupe",
        return_url: params.returnUrl,
        cancel_url: params.cancelUrl,
        user_action: "PAY_NOW",
        shipping_preference: "NO_SHIPPING",
      },
    }),
  });
  if (!res.ok) throw new Error(`Create order failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  const approveLink = (data.links as Array<{ rel: string; href: string }>).find(l => l.rel === "approve")?.href;
  if (!approveLink) throw new Error("PayPal did not return an approval link.");
  return { orderId: data.id as string, approveUrl: approveLink };
}

/** Captures payment on an approved order. Call this when PayPal redirects back with ?token=<orderId>. */
export async function captureOrder(orderId: string) {
  const token = await getAccessToken();
  const res = await fetch(`${BASE}/v2/checkout/orders/${orderId}/capture`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Capture failed: ${res.status} ${JSON.stringify(data)}`);
  return data as {
    id: string;
    status: string;
    purchase_units: Array<{ custom_id?: string; payments?: { captures?: Array<{ status: string }> } }>;
  };
}
