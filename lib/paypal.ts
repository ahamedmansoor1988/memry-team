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

/** Creates a PayPal subscription for the configured Pro plan and returns the approval link the user must open. */
export async function createSubscription(params: { returnUrl: string; cancelUrl: string; userId: string }) {
  const planId = process.env.PAYPAL_PLAN_ID;
  if (!planId) throw new Error("PAYPAL_PLAN_ID is not set.");

  const token = await getAccessToken();
  const res = await fetch(`${BASE}/v1/billing/subscriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      plan_id: planId,
      custom_id: params.userId, // carried through to webhook events so we know which user upgraded
      application_context: {
        brand_name: "Loupe",
        return_url: params.returnUrl,
        cancel_url: params.cancelUrl,
        user_action: "SUBSCRIBE_NOW",
      },
    }),
  });
  if (!res.ok) throw new Error(`Create subscription failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  const approveLink = (data.links as Array<{ rel: string; href: string }>).find(l => l.rel === "approve")?.href;
  if (!approveLink) throw new Error("PayPal did not return an approval link.");
  return { subscriptionId: data.id as string, approveUrl: approveLink };
}

export async function getSubscription(subscriptionId: string) {
  const token = await getAccessToken();
  const res = await fetch(`${BASE}/v1/billing/subscriptions/${subscriptionId}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Get subscription failed: ${res.status} ${await res.text()}`);
  return res.json();
}

/**
 * Verifies a webhook actually came from PayPal (not spoofed) using their
 * signature-verification API — never trust webhook bodies without this.
 */
export async function verifyWebhookSignature(params: {
  headers: { transmissionId: string; timestamp: string; signature: string; certUrl: string; authAlgo: string };
  body: unknown;
}): Promise<boolean> {
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;
  if (!webhookId) return false;

  const token = await getAccessToken();
  const res = await fetch(`${BASE}/v1/notifications/verify-webhook-signature`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      transmission_id: params.headers.transmissionId,
      transmission_time: params.headers.timestamp,
      cert_url: params.headers.certUrl,
      auth_algo: params.headers.authAlgo,
      transmission_sig: params.headers.signature,
      webhook_id: webhookId,
      webhook_event: params.body,
    }),
    cache: "no-store",
  });
  if (!res.ok) return false;
  const data = await res.json();
  return data.verification_status === "SUCCESS";
}
