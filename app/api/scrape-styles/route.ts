import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 30;

interface ExtractedStyles {
  fonts: string[];
  sizes: string[];
  weights: string[];
  colors: string[];
  googleFonts: string[];
  samples: Array<{ selector: string; fontFamily: string; fontSize: string; fontWeight: string; color: string }>;
}

function parseCssRules(css: string): ExtractedStyles["samples"] {
  const samples: ExtractedStyles["samples"] = [];
  // Match CSS rules: selector { ... }
  const ruleRegex = /([^{}]+)\{([^{}]+)\}/g;
  let match;
  while ((match = ruleRegex.exec(css)) !== null) {
    const selector = match[1].trim();
    const body     = match[2];
    // Only care about typography-related selectors
    if (!/^(body|html|h[1-6]|p|a|span|div|header|nav|footer|button|li|ul|label|input|\.[\w-]+)/.test(selector)) continue;

    const get = (prop: string) => {
      const m = new RegExp(`${prop}\\s*:\\s*([^;]+)`).exec(body);
      return m ? m[1].trim() : "";
    };

    const fontFamily = get("font-family");
    const fontSize   = get("font-size");
    const fontWeight = get("font-weight");
    const color      = get("color");

    if (fontFamily || fontSize || color) {
      samples.push({ selector, fontFamily, fontSize, fontWeight, color });
    }
  }
  return samples;
}

function resolveFont(f: string): string {
  const ALIASES: Record<string, string> = {
    "-apple-system":      "SF Pro (Apple System Font)",
    "BlinkMacSystemFont": "SF Pro (Apple System Font)",
    "system-ui":          "System UI Font",
    "ui-sans-serif":      "System Sans-Serif",
    "ui-serif":           "System Serif",
    "ui-monospace":       "System Monospace",
  };
  const first = f.split(",")[0].trim().replace(/['"]/g, "");
  return ALIASES[first] ?? first;
}

export async function POST(req: NextRequest) {
  const { url } = await req.json() as { url: string };

  let html = "";
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; Loupe/1.0; +https://loupe.design)" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return NextResponse.json({ error: `HTTP ${res.status}` }, { status: 400 });
    html = await res.text();
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 });
  }

  // Extract Google Fonts to identify intended fonts
  const googleFonts: string[] = [];
  const gfRegex = /fonts\.googleapis\.com\/css[^"'\s]*family=([^"'&\s]+)/g;
  let gfMatch;
  while ((gfMatch = gfRegex.exec(html)) !== null) {
    const families = decodeURIComponent(gfMatch[1]).split("|").map(f => f.split(":")[0].replace(/\+/g, " "));
    googleFonts.push(...families);
  }

  // Extract @import font URLs
  const importRegex = /@import url\(['"]?(https:\/\/fonts\.googleapis[^'")\s]+)/g;
  let impMatch;
  while ((impMatch = importRegex.exec(html)) !== null) {
    const families = decodeURIComponent(impMatch[1]).split("family=")[1]?.split("&")[0]?.split("|") ?? [];
    googleFonts.push(...families.map(f => f.split(":")[0].replace(/\+/g, " ")));
  }

  // Extract all <style> blocks
  const styleBlocks: string[] = [];
  const styleRegex = /<style[^>]*>([\s\S]*?)<\/style>/gi;
  let styleMatch;
  while ((styleMatch = styleRegex.exec(html)) !== null) {
    styleBlocks.push(styleMatch[1]);
  }
  const allCss = styleBlocks.join("\n");

  // Parse CSS rules
  const samples = parseCssRules(allCss);

  // Collect unique values
  const fonts   = Array.from(new Set([
    ...googleFonts,
    ...samples.map(s => resolveFont(s.fontFamily)).filter(Boolean),
  ])).filter(Boolean);

  const sizes   = Array.from(new Set(
    samples.map(s => s.fontSize).filter(s => s && /\d/.test(s))
  )).sort((a, b) => parseFloat(b) - parseFloat(a));

  const weights = Array.from(new Set(
    samples.map(s => s.fontWeight).filter(Boolean)
  ));

  // Extract colors from CSS (hex, rgb, hsl)
  const colorMatches = allCss.match(/#[0-9a-fA-F]{3,6}|rgb\([^)]+\)|hsl\([^)]+\)/g) ?? [];
  const colors = Array.from(new Set(colorMatches)).slice(0, 25);

  return NextResponse.json({ fonts, sizes, weights, colors, googleFonts, samples: samples.slice(0, 30) });
}
