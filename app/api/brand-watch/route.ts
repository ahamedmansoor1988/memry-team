import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createAuthClient } from "@/lib/supabase/server";
import { getFigmaConnectionStatus } from "@/lib/figma-oauth";

export const dynamic = "force-dynamic";

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

export async function GET() {
  const supabase = await createAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  const { data, error } = await admin()
    .from("brand_watches")
    .select("id, file_key, node_id, label, last_scanned_at, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ watches: data });
}

export async function POST(req: NextRequest) {
  const supabase = await createAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  const { connected } = await getFigmaConnectionStatus(user.id);
  if (!connected) {
    return NextResponse.json({ error: "Connect Figma via OAuth in Settings first — watching needs server-side access to re-check the file on its own.", code: "figma_not_connected" }, { status: 400 });
  }

  const body = await req.json().catch(() => null) as { fileKey?: string; nodeId?: string; label?: string; brandGuideText?: string } | null;
  if (!body?.fileKey || !body.brandGuideText?.trim()) {
    return NextResponse.json({ error: "fileKey and brandGuideText are required." }, { status: 400 });
  }

  const { data, error } = await admin()
    .from("brand_watches")
    .upsert({
      user_id: user.id,
      file_key: body.fileKey,
      node_id: body.nodeId ?? null,
      label: body.label ?? null,
      brand_guide_text: body.brandGuideText,
    }, { onConflict: "user_id,file_key,node_id" })
    .select("id")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, id: data.id });
}

export async function DELETE(req: NextRequest) {
  const supabase = await createAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  const { id } = await req.json().catch(() => ({})) as { id?: string };
  if (!id) return NextResponse.json({ error: "id is required." }, { status: 400 });

  const { error } = await admin().from("brand_watches").delete().eq("id", id).eq("user_id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
