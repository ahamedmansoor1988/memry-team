// One-time setup script: creates the "Loupe Pro" product + $20/month plan
// in PayPal (sandbox or live, per PAYPAL_ENV) and prints the Plan ID to add
// to .env.local as PAYPAL_PLAN_ID. Safe to re-run — it always creates a new
// product/plan rather than mutating one, so old subscriptions on a prior
// plan id are unaffected.
import { readFileSync } from "fs";

function loadEnvLocal() {
  try {
    const text = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
    for (const line of text.split("\n")) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  } catch {}
}
loadEnvLocal();

const ENV = process.env.PAYPAL_ENV === "live" ? "live" : "sandbox";
const BASE = ENV === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
const CLIENT_ID = process.env.PAYPAL_CLIENT_ID;
const CLIENT_SECRET = process.env.PAYPAL_CLIENT_SECRET;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("Missing PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET in .env.local");
  process.exit(1);
}

async function getAccessToken() {
  const res = await fetch(`${BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) throw new Error(`OAuth failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.access_token;
}

async function createProduct(token) {
  const res = await fetch(`${BASE}/v1/catalogs/products`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Loupe Pro",
      description: "Unlimited design QA scans — Figma vs Live, Brand Check, Accessibility, Responsive Check.",
      type: "SERVICE",
      category: "SOFTWARE",
    }),
  });
  if (!res.ok) throw new Error(`Create product failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function createPlan(token, productId) {
  const res = await fetch(`${BASE}/v1/billing/plans`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      product_id: productId,
      name: "Loupe Pro Monthly",
      description: "$20/month — unlimited scans across all 4 Loupe tools.",
      billing_cycles: [
        {
          frequency: { interval_unit: "MONTH", interval_count: 1 },
          tenure_type: "REGULAR",
          sequence: 1,
          total_cycles: 0, // 0 = infinite, cancel anytime
          pricing_scheme: {
            fixed_price: { value: "20.00", currency_code: "USD" },
          },
        },
      ],
      payment_preferences: {
        auto_bill_outstanding: true,
        payment_failure_threshold: 2,
      },
    }),
  });
  if (!res.ok) throw new Error(`Create plan failed: ${res.status} ${await res.text()}`);
  return res.json();
}

const token = await getAccessToken();
console.log(`[${ENV}] Got access token.`);
const product = await createProduct(token);
console.log(`Created product: ${product.id}`);
const plan = await createPlan(token, product.id);
console.log(`Created plan: ${plan.id}`);
console.log("\nAdd this to .env.local:");
console.log(`PAYPAL_PLAN_ID=${plan.id}`);
