import { NextRequest, NextResponse } from "next/server";
import { checkDailyLimit, clientIp } from "@/lib/rate-limit";

export const maxDuration = 30;

const FREE_SCANS_PER_DAY = 10;

type ViewportName = "mobile" | "tablet" | "desktop";

interface ViewportConfig {
  name: ViewportName;
  width: number;
  height: number;
}

interface ResponsiveIssue {
  id: string;
  viewport: ViewportName | "static";
  type: string;
  severity: "high" | "medium" | "low";
  element: string;
  selector?: string;
  details: string;
  metrics?: Record<string, number | string | boolean | null>;
}

type ScannerStatus = "ready" | "not_configured" | "missing_endpoint" | "unreachable";

const DEFAULT_VIEWPORTS: ViewportConfig[] = [
  { name: "mobile", width: 390, height: 844 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1440, height: 900 },
];

function normalizeUrl(raw: string): string | null {
  try {
    const url = new URL(raw.trim());
    if (!["http:", "https:"].includes(url.protocol)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function extractReadableText(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ");
}

function isProbablyVisibleLongText(token: string) {
  if (token.length < 48) return false;
  if (token.startsWith("--")) return false;
  if (token.includes("/") || token.includes("\\")) return false;
  if (token.includes("_") || token.includes("=")) return false;
  if (/^(wp|css|js|http|https|data|base64|class|style|nonce|ver)-/i.test(token)) return false;
  if (/^[a-f0-9-]{32,}$/i.test(token)) return false;
  if (/^[A-Z0-9_-]+$/i.test(token) && /\d/.test(token)) return false;
  return /[a-zA-Z]/.test(token);
}

async function callScraperService(url: string, viewports: ViewportConfig[]) {
  const base = process.env.SCRAPER_SERVICE_URL;
  if (!base) return null;

  const res = await fetch(`${base}/responsive`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, viewports }),
    signal: AbortSignal.timeout(28_000),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    if (res.status === 404 && txt.includes("Cannot POST /responsive")) return null;
    throw new Error(`Responsive scraper ${res.status}: ${txt.slice(0, 200)}`);
  }

  return res.json() as Promise<{
    url: string;
    checkedAt: string;
    mode: "browser";
    viewports: ViewportConfig[];
    issues: ResponsiveIssue[];
  }>;
}

async function staticFallback(url: string, viewports: ViewportConfig[], scannerStatus: ScannerStatus = "not_configured") {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; LoupeResponsive/1.0)" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const html = await res.text();
  const issues: ResponsiveIssue[] = [];
  const hasViewportMeta = /<meta[^>]+name=["']viewport["']/i.test(html);
  const readableText = extractReadableText(html);
  const longTokens = Array.from(readableText.matchAll(/[A-Za-z0-9-]{48,}/g))
    .map(m => m[0])
    .filter(isProbablyVisibleLongText)
    .slice(0, 5);

  if (!hasViewportMeta) {
    issues.push({
      id: "static-viewport-meta",
      viewport: "static",
      type: "viewport_meta",
      severity: "high",
      element: "document head",
      details: "Missing viewport meta tag. Mobile browsers may render the page at desktop width.",
    });
  }

  for (let index = 0; index < longTokens.length; index++) {
    const token = longTokens[index];
    issues.push({
      id: `static-long-token-${index}`,
      viewport: "static",
      type: "long_unbroken_text",
      severity: "medium",
      element: token.slice(0, 64),
      details: "Long unbroken text can force horizontal scrolling on narrow screens.",
      metrics: { length: token.length },
    });
  }

  return {
    url,
    checkedAt: new Date().toISOString(),
    mode: "static_fallback" as const,
    scannerStatus,
    viewports,
    issues,
  };
}

async function getScannerStatus(): Promise<ScannerStatus> {
  const base = process.env.SCRAPER_SERVICE_URL;
  if (!base) return "not_configured";

  try {
    const res = await fetch(`${base}/responsive`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(8_000),
    });

    if (res.status === 400) return "ready";
    if (res.status === 404) return "missing_endpoint";
    return res.ok ? "ready" : "unreachable";
  } catch {
    return "unreachable";
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null) as { url?: string; viewports?: ViewportName[] } | null;
  const url = body?.url ? normalizeUrl(body.url) : null;
  if (!url) return NextResponse.json({ error: "A valid http(s) URL is required." }, { status: 400 });

  const limit = await checkDailyLimit(`ip:${clientIp(req)}`, "scan", FREE_SCANS_PER_DAY);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: `Daily free scan limit reached (${FREE_SCANS_PER_DAY}/day). Come back tomorrow.` },
      { status: 429 }
    );
  }

  const requested = new Set(body?.viewports ?? DEFAULT_VIEWPORTS.map(v => v.name));
  const viewports = DEFAULT_VIEWPORTS.filter(v => requested.has(v.name));
  if (viewports.length === 0) {
    return NextResponse.json({ error: "Select at least one viewport." }, { status: 400 });
  }

  try {
    const browserResult = await callScraperService(url, viewports);
    if (browserResult) return NextResponse.json(browserResult);
    const scannerStatus = process.env.SCRAPER_SERVICE_URL ? "missing_endpoint" : "not_configured";
    return NextResponse.json(await staticFallback(url, viewports, scannerStatus));
  } catch {
    return NextResponse.json(await staticFallback(url, viewports, "unreachable"));
  }
}

export async function GET() {
  const scannerStatus = await getScannerStatus();
  return NextResponse.json({
    browserScannerConnected: scannerStatus === "ready",
    scannerStatus,
  });
}
