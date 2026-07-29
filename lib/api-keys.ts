import { randomBytes, createHash } from "crypto";
import { createClient } from "@supabase/supabase-js";
import { checkLifetimeLimit } from "@/lib/rate-limit";

const KEY_PREFIX = "loupe_sk_";
const PURCHASE_CREDIT_EXPIRY_MONTHS = 3;
const TRIAL_CREDIT_EXPIRY_DAYS = 14;
export const FREE_TRIAL_CREDITS = 100;

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

function creditExpiryDate(source: "purchase" | "trial" | "admin_grant"): string {
  const d = new Date();
  if (source === "trial") {
    d.setDate(d.getDate() + TRIAL_CREDIT_EXPIRY_DAYS);
  } else {
    d.setMonth(d.getMonth() + PURCHASE_CREDIT_EXPIRY_MONTHS);
  }
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
 * Grants a batch of credits — purchased/admin-granted credits expire 3
 * months out, trial credits expire in 14 days — independent of any other
 * batch on the same key. credits_remaining/credits_granted on api_keys are
 * updated too, but only as a rough display cache — they don't know about
 * expiry, so use availableCredits() for anything that needs to be accurate.
 */
export async function grantCredits(apiKeyId: string, credits: number, source: "purchase" | "trial" | "admin_grant" = "purchase") {
  const db = admin();
  const { error: batchError } = await db.from("credit_batches").insert({
    api_key_id: apiKeyId,
    credits,
    source,
    expires_at: creditExpiryDate(source),
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

export interface CreditStatus {
  credits: number;
  /** Earliest expires_at among batches with remaining credits — null if no active batches. */
  nextExpiryAt: string | null;
  /** True if every remaining batch is trial-sourced (used to label the balance "free trial"). */
  isTrialOnly: boolean;
}

/** Balance plus the soonest expiry, for displaying trial/purchase status in the UI. */
export async function creditStatus(apiKeyId: string): Promise<CreditStatus> {
  const { data, error } = await admin()
    .from("credit_batches")
    .select("credits, credits_used, source, expires_at")
    .eq("api_key_id", apiKeyId)
    .gt("expires_at", new Date().toISOString())
    .order("expires_at", { ascending: true });
  if (error) throw new Error(error.message);

  const active = (data ?? []).filter(b => b.credits_used < b.credits);
  const credits = active.reduce((sum, b) => sum + (b.credits - b.credits_used), 0);
  const nextExpiryAt = active[0]?.expires_at ?? null;
  const isTrialOnly = active.length > 0 && active.every(b => b.source === "trial");

  return { credits, nextExpiryAt, isTrialOnly };
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

/** Finds the user's oldest non-revoked key, or mints one — the implicit "wallet" behind interactive web-app scans. */
export async function getOrCreatePrimaryKey(userId: string): Promise<string> {
  const db = admin();
  const { data: existing } = await db
    .from("api_keys")
    .select("id")
    .eq("user_id", userId)
    .is("revoked_at", null)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (existing) return existing.id;

  const minted = await mintApiKey(userId, "Web app usage");
  return minted.id;
}

/** Grants the one-time 100-credit free trial, but only if this key has never received any batch before. */
// Google sign-up itself is free and unlimited, so without this an abuser can
// keep making new accounts from the same network to keep re-minting 100 free
// scans (each a real Playwright page load we pay to run). Capping trial
// grants per IP (not per account) is what actually bounds that cost — a
// per-account check alone does nothing since accounts are the free resource.
const MAX_TRIALS_PER_IP = 3;

export async function ensureFreeTrialGranted(apiKeyId: string, ip?: string) {
  const db = admin();
  const { count } = await db
    .from("credit_batches")
    .select("id", { count: "exact", head: true })
    .eq("api_key_id", apiKeyId);

  if (count) return;

  if (ip && ip !== "unknown") {
    const { allowed } = await checkLifetimeLimit(ip, "trial-grant", MAX_TRIALS_PER_IP);
    if (!allowed) return; // silently withhold the trial — scan will fail with insufficient_credits
  }

  await grantCredits(apiKeyId, FREE_TRIAL_CREDITS, "trial");
}

/** Consumes 1 credit for an already-authenticated web-app request (no raw API key involved). */
export async function consumeCreditForKey(apiKeyId: string, scanType: string): Promise<ConsumeResult> {
  const { data, error } = await admin()
    .rpc("consume_api_credit_by_id", { p_api_key_id: apiKeyId, p_scan_type: scanType })
    .single();

  if (error || !data) return { ok: false, reason: "invalid_key" };
  const row = data as { ok: boolean; credits_remaining: number; reason: string | null };

  if (!row.ok) return { ok: false, reason: (row.reason as ConsumeResult extends { ok: false } ? ConsumeResult["reason"] : never) ?? "invalid_key" };
  return { ok: true, userId: apiKeyId, creditsRemaining: row.credits_remaining };
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
