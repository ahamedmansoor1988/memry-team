import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { mintApiKey, grantCredits, revokeApiKey } from "@/lib/api-keys";

export const dynamic = "force-dynamic";

// Manual, admin-only key minting — gated by a bearer secret only you hold
// (ADMIN_API_SECRET), not a customer-facing self-serve flow. Mint a key by
// email + credit amount; the plaintext key is returned once in the response
// and never stored or shown again.
function isAuthorized(req: NextRequest) {
  const auth = req.headers.get("authorization");
  const secret = process.env.ADMIN_API_SECRET;
  return Boolean(secret) && auth === `Bearer ${secret}`;
}

async function findUserByEmail(email: string) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
  // Supabase admin API paginates; fine for a low-volume manual tool.
  const { data, error } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw new Error(error.message);
  return data.users.find(u => u.email?.toLowerCase() === email.toLowerCase()) ?? null;
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { email?: string; credits?: number; label?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { email, credits, label } = body;
  if (!email || typeof credits !== "number" || credits <= 0) {
    return NextResponse.json({ error: "email and a positive credits number are required" }, { status: 400 });
  }

  const user = await findUserByEmail(email);
  if (!user) return NextResponse.json({ error: `No account found for ${email}` }, { status: 404 });

  const key = await mintApiKey(user.id, label);
  await grantCredits(key.id, credits, "admin_grant");
  return NextResponse.json({
    apiKey: key.rawKey,
    keyPrefix: key.key_prefix,
    creditsGranted: credits,
    note: "Save this key now — it will not be shown again. Credits expire 3 months from today.",
  });
}

export async function DELETE(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { keyId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.keyId) return NextResponse.json({ error: "keyId is required" }, { status: 400 });
  await revokeApiKey(body.keyId);
  return NextResponse.json({ ok: true });
}
