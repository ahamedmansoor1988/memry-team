import { createClient } from "@supabase/supabase-js";
import { createHash } from "crypto";

const BUCKET = "usage";

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

async function ensureBucket(client: ReturnType<typeof admin>) {
  const { error } = await client.storage.createBucket(BUCKET, { public: false });
  if (error && !/already exists/i.test(error.message)) throw error;
}

/**
 * Storage-backed daily counter. Increments and reports whether the caller is
 * within `limit` for today. Fails open: a limiter outage must never take the
 * product down with it.
 */
export async function checkDailyLimit(key: string, kind: string, limit: number): Promise<{ allowed: boolean; remaining: number }> {
  try {
    const client = admin();
    const day = new Date().toISOString().slice(0, 10);
    const hashed = createHash("sha256").update(key).digest("hex").slice(0, 20);
    const path = `${kind}/${day}/${hashed}.json`;

    let count = 0;
    const { data } = await client.storage.from(BUCKET).download(path);
    if (data) {
      try { count = Number(JSON.parse(await data.text()).count) || 0; } catch {}
    }
    if (count >= limit) return { allowed: false, remaining: 0 };

    const { error } = await client.storage.from(BUCKET).upload(
      path,
      JSON.stringify({ count: count + 1 }),
      { contentType: "application/json", upsert: true }
    );
    if (error && /bucket not found/i.test(error.message)) {
      await ensureBucket(client);
      await client.storage.from(BUCKET).upload(path, JSON.stringify({ count: count + 1 }), { contentType: "application/json", upsert: true });
    }
    return { allowed: true, remaining: limit - count - 1 };
  } catch {
    return { allowed: true, remaining: limit };
  }
}

export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  return fwd?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
}
