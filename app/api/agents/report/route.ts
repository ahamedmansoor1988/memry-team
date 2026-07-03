import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "crypto";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const BUCKET = "qa-reports";
const MAX_PAYLOAD_BYTES = 12 * 1024 * 1024;

function supabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

async function ensureBucket(admin: ReturnType<typeof supabaseAdmin>) {
  const { error } = await admin.storage.createBucket(BUCKET, { public: false });
  if (error && !/already exists/i.test(error.message)) throw error;
}

export async function POST(req: NextRequest) {
  const body = await req.text();
  if (body.length > MAX_PAYLOAD_BYTES) {
    return NextResponse.json({ error: "Report too large to share." }, { status: 413 });
  }
  let parsed: { kind?: string; report?: unknown };
  try {
    parsed = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }
  if (!parsed.kind || !parsed.report || !["responsive", "accessibility"].includes(parsed.kind)) {
    return NextResponse.json({ error: "kind (responsive|accessibility) and report are required." }, { status: 400 });
  }

  const slug = randomBytes(8).toString("base64url");
  const admin = supabaseAdmin();

  try {
    await ensureBucket(admin);
    const { error } = await admin.storage
      .from(BUCKET)
      .upload(`${slug}.json`, JSON.stringify({
        kind: parsed.kind,
        createdAt: new Date().toISOString(),
        report: parsed.report,
      }), { contentType: "application/json" });
    if (error) throw error;
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Storage error" }, { status: 500 });
  }

  return NextResponse.json({ slug, url: `/report/${slug}` });
}

export async function GET(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get("slug");
  if (!slug || !/^[A-Za-z0-9_-]{6,24}$/.test(slug)) {
    return NextResponse.json({ error: "Invalid slug." }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin().storage.from(BUCKET).download(`${slug}.json`);
  if (error || !data) {
    return NextResponse.json({ error: "Report not found." }, { status: 404 });
  }

  return new NextResponse(await data.text(), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=300",
    },
  });
}
