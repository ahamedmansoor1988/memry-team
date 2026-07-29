import { NextResponse } from "next/server";
import { createClient as createAuthClient } from "@/lib/supabase/server";
import { getFigmaConnectionStatus, disconnectFigma } from "@/lib/figma-oauth";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  const status = await getFigmaConnectionStatus(user.id);
  return NextResponse.json(status);
}

export async function DELETE() {
  const supabase = await createAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  await disconnectFigma(user.id);
  return NextResponse.json({ ok: true });
}
