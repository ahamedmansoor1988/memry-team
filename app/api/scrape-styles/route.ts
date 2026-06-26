import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 30;

// ── Fallback only — preferred extraction method is the Loupe Chrome extension ──
// The extension (loupe-extension/) runs in the user's real browser tab and reads
// computed styles directly via TreeWalker — no Playwright needed.
// This route is used when the extension is not installed or unavailable.
//
// ── Playwright scraper service (Render) ───────────────────────────────────────
// Set SCRAPER_SERVICE_URL in Vercel env vars to point at the Render deployment.
// Falls back to the old regex approach when the env var is absent (local dev).

async function callScraperService(url: string) {
  const base = process.env.SCRAPER_SERVICE_URL!;
  const res  = await fetch(`${base}/scrape`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ url }),
    signal:  AbortSignal.timeout(28_000),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Scraper service ${res.status}: ${txt.slice(0, 200)}`);
  }
  return res.json() as Promise<{
    fonts: string[];
    fontSizes: string[];
    fontWeights: string[];
    colors: string[];
    styles: Array<{ text: string; fontFamily: string; fontSize: string; fontWeight: string; color: string | null }>;
  }>;
}

// ── Regex fallback (no real browser — used only when SCRAPER_SERVICE_URL unset) ─
function parseCssRules(css: string) {
  const samples: Array<{ selector: string; fontFamily: string; fontSize: string; fontWeight: string; color: string }> = [];
  const ruleRegex = /([^{}]+)\{([^{}]+)\}/g;
  let match;
  while ((match = ruleRegex.exec(css)) !== null) {
    const selector = match[1].trim();
    const body     = match[2];
    if (!/^(body|html|h[1-6]|p|a|span|div|header|nav|footer|button|li|ul|label|input|\.[\w-]+)/.test(selector)) continue;
    const get = (prop: string) => new RegExp(`${prop}\\s*:\\s*([^;]+)`).exec(body)?.[1]?.trim() ?? "";
    const fontFamily = get("font-family");
    const fontSize   = get("font-size");
    const fontWeight = get("font-weight");
    const color      = get("color");
    if (fontFamily || fontSize || color) samples.push({ selector, fontFamily, fontSize, fontWeight, color });
  }
  return samples;
}

function resolveFont(f: string): string {
  const ALIASES: Record<string, string> = {
    "-apple-system": "SF Pro (Apple System Font)",
    "BlinkMacSystemFont": "SF Pro (Apple System Font)",
    "system-ui": "System UI Font",
  };
  const first = f.split(",")[0].trim().replace(/['"]/g, "");
  return ALIASES[first] ?? first;
}

async function regexFallback(url: string) {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; Loupe/1.0)" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();

  const googleFonts: string[] = [];
  const gfRegex = /fonts\.googleapis\.com\/css[^"'\s]*family=([^"'&\s]+)/g;
  let m;
  while ((m = gfRegex.exec(html)) !== null)
    googleFonts.push(...decodeURIComponent(m[1]).split("|").map(f => f.split(":")[0].replace(/\+/g, " ")));

  const styleBlocks: string[] = [];
  const styleRegex = /<style[^>]*>([\s\S]*?)<\/style>/gi;
  while ((m = styleRegex.exec(html)) !== null) styleBlocks.push(m[1]);
  const allCss  = styleBlocks.join("\n");
  const samples = parseCssRules(allCss);

  return {
    fonts:      Array.from(new Set([...googleFonts, ...samples.map(s => resolveFont(s.fontFamily)).filter(Boolean)])),
    fontSizes:  Array.from(new Set(samples.map(s => s.fontSize).filter(s => /\d/.test(s)))),
    fontWeights: Array.from(new Set(samples.map(s => s.fontWeight).filter(Boolean))),
    colors:     Array.from(new Set(allCss.match(/#[0-9a-fA-F]{3,6}|rgb\([^)]+\)|hsl\([^)]+\)/g) ?? [])).slice(0, 25),
    styles:     samples.slice(0, 30).map(s => ({ text: s.selector, fontFamily: s.fontFamily, fontSize: s.fontSize, fontWeight: s.fontWeight, color: s.color })),
  };
}

// ── Handler ────────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const { url } = await req.json() as { url: string };
  if (!url) return NextResponse.json({ error: "url is required" }, { status: 400 });

  try {
    const result = process.env.SCRAPER_SERVICE_URL
      ? await callScraperService(url)
      : await regexFallback(url);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
