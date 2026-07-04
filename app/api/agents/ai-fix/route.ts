import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { createClient } from "@supabase/supabase-js";
import { createClient as createAuthClient } from "@/lib/supabase/server";
import { checkDailyLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const CACHE_BUCKET = "ai-cache";
const USER_AI_PER_DAY = 10;
// Global kill switch — the Groq bill can never exceed this many calls/day.
const GLOBAL_AI_PER_DAY = 300;

interface FindingInput {
  type: string;
  viewport?: string;
  element?: string;
  selector?: string;
  section?: string;
  domPath?: string[];
  css?: Record<string, string>;
  metrics?: Record<string, number | string | boolean | null>;
  details?: string;
}

interface AiAnalysis {
  rootCause: string;
  fix: string;
  cssSnippet: string;
  confidence: number;
}

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

async function readCache(key: string): Promise<AiAnalysis | null> {
  try {
    const { data } = await admin().storage.from(CACHE_BUCKET).download(`${key}.json`);
    if (!data) return null;
    return JSON.parse(await data.text()) as AiAnalysis;
  } catch {
    return null;
  }
}

async function writeCache(key: string, analysis: AiAnalysis) {
  try {
    const client = admin();
    const upload = () => client.storage.from(CACHE_BUCKET).upload(
      `${key}.json`, JSON.stringify(analysis), { contentType: "application/json", upsert: true }
    );
    const { error } = await upload();
    if (error && /bucket not found/i.test(error.message)) {
      await client.storage.createBucket(CACHE_BUCKET, { public: false }).catch(() => {});
      await upload();
    }
  } catch {}
}

async function callGroq(finding: FindingInput, url: string): Promise<AiAnalysis> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("AI is not configured.");
  const model = process.env.LOUPE_AI_MODEL?.trim() || "llama-3.3-70b-versatile";

  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(25_000),
    body: JSON.stringify({
      model,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: [
            "You are a senior frontend engineer reviewing a layout QA finding from an automated browser scan.",
            "Explain the root cause precisely and give a practical CSS fix a developer can paste.",
            "Ground every claim in the provided measurements and computed CSS — do not invent selectors or properties that are not present.",
            "Respond with strict JSON: {\"rootCause\": string (2-3 sentences, plain engineer language), \"fix\": string (1-2 sentences describing the change), \"cssSnippet\": string (the CSS to apply, using the real selector), \"confidence\": number (0-100, how certain the diagnosis is given the evidence)}",
          ].join("\n"),
        },
        {
          role: "user",
          content: JSON.stringify({ pageUrl: url, finding }, null, 2),
        },
      ],
    }),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`AI provider error ${res.status}: ${txt.slice(0, 120)}`);
  }
  const data = await res.json();
  const parsed = JSON.parse(data.choices?.[0]?.message?.content ?? "{}");
  if (!parsed.rootCause || !parsed.fix) throw new Error("AI returned an unusable answer.");
  return {
    rootCause: String(parsed.rootCause).slice(0, 800),
    fix: String(parsed.fix).slice(0, 500),
    cssSnippet: String(parsed.cssSnippet ?? "").slice(0, 600),
    confidence: Math.max(0, Math.min(100, Number(parsed.confidence) || 70)),
  };
}

export async function POST(req: NextRequest) {
  const supabase = await createAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in to use AI analysis.", requiresAuth: true }, { status: 401 });
  }

  const body = await req.json().catch(() => null) as { url?: string; finding?: FindingInput } | null;
  if (!body?.finding?.type || !body.url) {
    return NextResponse.json({ error: "url and finding are required." }, { status: 400 });
  }

  // Identical findings (same page, element, CSS) hit the cache — repeat scans
  // of the same site cost zero tokens.
  const cacheKey = createHash("sha256")
    .update(JSON.stringify({
      u: body.url,
      t: body.finding.type,
      s: body.finding.selector,
      c: body.finding.css,
      m: body.finding.metrics,
    }))
    .digest("hex")
    .slice(0, 32);

  const cached = await readCache(cacheKey);
  if (cached) return NextResponse.json({ ...cached, cached: true });

  const userLimit = await checkDailyLimit(`user:${user.id}`, "ai", USER_AI_PER_DAY);
  if (!userLimit.allowed) {
    return NextResponse.json(
      { error: `Daily AI analysis limit reached (${USER_AI_PER_DAY}/day). Come back tomorrow.` },
      { status: 429 }
    );
  }
  const globalLimit = await checkDailyLimit("all", "ai-global", GLOBAL_AI_PER_DAY);
  if (!globalLimit.allowed) {
    return NextResponse.json(
      { error: "AI analysis is in high demand today — try again tomorrow. Rule-based analysis still works." },
      { status: 429 }
    );
  }

  try {
    const analysis = await callGroq(body.finding, body.url);
    await writeCache(cacheKey, analysis);
    return NextResponse.json({ ...analysis, cached: false });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "AI analysis failed." }, { status: 502 });
  }
}
