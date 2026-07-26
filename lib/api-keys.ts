import { randomBytes, createHash } from "crypto";
import { createClient } from "@supabase/supabase-js";

const KEY_PREFIX = "loupe_sk_";

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

export async function mintApiKey(userId: string, credits: number, label?: string) {
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
      credits_remaining: credits,
      credits_granted: credits,
    })
    .select("id, key_prefix, credits_remaining, created_at")
    .single();

  if (error) throw new Error(error.message);
  return { rawKey, ...data };
}

export type ConsumeResult =
  | { ok: true; userId: string; creditsRemaining: number }
  | { ok: false; reason: "invalid_key" | "revoked" | "insufficient_credits" };

/** Atomically validates the key, decrements one credit, and logs usage. */
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
