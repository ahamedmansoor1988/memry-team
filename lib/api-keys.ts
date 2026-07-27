import { randomBytes, createHash } from "crypto";
import { createClient } from "@supabase/supabase-js";

const KEY_PREFIX = "loupe_sk_";
const CREDIT_EXPIRY_MONTHS = 3;

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

function hashKey(rawKey: string): string {
  return createHash("sha256").update(rawKey).digest("hex");
}

/** Generates a new plaintext key. Shown once at creation — never stored or retrievable again. */
function generateRawKey(): string {
  return KEY_PREFIX + randomBytes(24).toString("hex");
}

function creditExpiryDate(): string {
  const d = new Date();
  d.setMonth(d.getMonth() + CREDIT_EXPIRY_MONTHS);
  return d.toISOString();
}

/** Creates a new API key with no credits — call grantCredits separately to fund it. */
export async function mintApiKey(userId: string, label?: string) {
  const rawKey = generateRawKey();
  const keyHash = hashKey(rawKey);
  const keyPrefix = rawKey.slice(0, KEY_PREFIX.length + 6);

  const { data, error } = await admin()
    .from("api_keys")
    .insert({
      user_id: userId,
      label: label ?? null,
      key_hash: keyHash,
      key_prefix: keyPrefix,
      credits_remaining: 0,
      credits_granted: 0,
    })
    .select("id, key_prefix, created_at")
    .single();

  if (error) throw new Error(error.message);
  return { rawKey, ...data };
}

/**
 * Grants a batch of credits that expires 3 months from now, independent of
 * any other batch on the same key. credits_remaining/credits_granted on
 * api_keys are updated too, but only as a rough display cache — they don't
 * know about expiry, so use availableCredits() for anything that needs to
 * be accurate.
 */
export async function grantCredits(apiKeyId: string, credits: number, source: "purchase" | "trial" | "admin_grant" = "purchase") {
  const db = admin();
  const { error: batchError } = await db.from("credit_batches").insert({
    api_key_id: apiKeyId,
    credits,
    source,
    expires_at: creditExpiryDate(),
  });
  if (batchError) throw new Error(batchError.message);

  const { data: key, error: fetchError } = await db
    .from("api_keys")
    .select("credits_remaining, credits_granted")
    .eq("id", apiKeyId)
    .single();
  if (fetchError) throw new Error(fetchError.message);

  const { error: updateError } = await db
    .from("api_keys")
    .update({
      credits_remaining: key.credits_remaining + credits,
      credits_granted: key.credits_granted + credits,
    })
    .eq("id", apiKeyId);
  if (updateError) throw new Error(updateError.message);
}

/** Expiry-aware balance — sums only non-expired batches, unlike the api_keys.credits_remaining cache. */
export async function availableCredits(apiKeyId: string): Promise<number> {
  const { data, error } = await admin().rpc("available_credits", { p_api_key_id: apiKeyId });
  if (error) throw new Error(error.message);
  return data as number;
}

export type ConsumeResult =
  | { ok: true; userId: string; creditsRemaining: number }
  | { ok: false; reason: "invalid_key" | "revoked" | "insufficient_credits" };

/** Atomically validates the key, decrements one credit (from the soonest-expiring batch), and logs usage. */
export async function consumeApiCredit(rawKey: string, scanType: string): Promise<ConsumeResult> {
  const keyHash = hashKey(rawKey);
  const { data, error } = await admin()
    .rpc("consume_api_credit", { p_key_hash: keyHash, p_scan_type: scanType })
    .single();

  if (error || !data) return { ok: false, reason: "invalid_key" };
  const row = data as { ok: boolean; user_id: string | null; credits_remaining: number; reason: string | null };

  if (!row.ok) return { ok: false, reason: (row.reason as ConsumeResult extends { ok: false } ? ConsumeResult["reason"] : never) ?? "invalid_key" };
  return { ok: true, userId: row.user_id!, creditsRemaining: row.credits_remaining };
}

export async function revokeApiKey(keyId: string) {
  const { error } = await admin().from("api_keys").update({ revoked_at: new Date().toISOString() }).eq("id", keyId);
  if (error) throw new Error(error.message);
}

export async function listApiKeysForUser(userId: string) {
  const { data, error } = await admin()
    .from("api_keys")
    .select("id, label, key_prefix, credits_remaining, credits_granted, created_at, last_used_at, revoked_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data;
}
