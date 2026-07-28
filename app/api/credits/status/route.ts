import { NextResponse } from "next/server";
import { createClient as createAuthClient } from "@/lib/supabase/server";
import { getOrCreatePrimaryKey, ensureFreeTrialGranted, creditStatus } from "@/lib/api-keys";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  const apiKeyId = await getOrCreatePrimaryKey(user.id);
  await ensureFreeTrialGranted(apiKeyId);
  const status = await creditStatus(apiKeyId);

  return NextResponse.json(status);
}
