import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 30;

interface AccessibilityIssue {
  id: string;
  type: string;
  severity: "high" | "medium" | "low";
  element: string;
  selector?: string;
  details: string;
  metrics?: Record<string, number | string | boolean | null>;
}

type ScannerStatus = "ready" | "not_configured" | "missing_endpoint" | "unreachable";

function normalizeUrl(raw: string): string | null {
  try {
    const url = new URL(raw.trim());
    if (!["http:", "https:"].includes(url.protocol)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

async function callScraperService(url: string) {
  const base = process.env.SCRAPER_SERVICE_URL;
  if (!base) return null;

  const res = await fetch(`${base}/accessibility`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
    signal: AbortSignal.timeout(28_000),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    if (res.status === 404 && txt.includes("Cannot POST /accessibility")) return null;
    throw new Error(`Accessibility scraper ${res.status}: ${txt.slice(0, 200)}`);
  }

  return res.json() as Promise<{
    url: string;
    checkedAt: string;
    mode: "browser";
    issues: AccessibilityIssue[];
  }>;
}

async function staticFallback(url: string, scannerStatus: ScannerStatus = "not_configured") {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; LoupeA11y/1.0)" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const html = await res.text();
  const issues: AccessibilityIssue[] = [];

  const imgsWithoutAlt = (html.match(/<img(?![^>]*\balt=)[^>]*>/gi) ?? []).length;
  if (imgsWithoutAlt > 0) {
    issues.push({
      id: "static-missing-alt",
      type: "missing_alt",
      severity: "medium",
      element: "img",
      details: `${imgsWithoutAlt} image tag(s) in the HTML have no alt attribute.`,
      metrics: { count: imgsWithoutAlt },
    });
  }

  const h1Count = (html.match(/<h1[\s>]/gi) ?? []).length;
  if (h1Count === 0) {
    issues.push({
      id: "static-missing-h1",
      type: "missing_h1",
      severity: "medium",
      element: "document",
      details: "No H1 tag found in the HTML.",
    });
  } else if (h1Count > 1) {
    issues.push({
      id: "static-multiple-h1",
      type: "multiple_h1",
      severity: "low",
      element: "document",
      details: `${h1Count} H1 tags found in the HTML.`,
      metrics: { count: h1Count },
    });
  }

  return {
    url,
    checkedAt: new Date().toISOString(),
    mode: "static_fallback" as const,
    scannerStatus,
    issues,
  };
}

async function getScannerStatus(): Promise<ScannerStatus> {
  const base = process.env.SCRAPER_SERVICE_URL;
  if (!base) return "not_configured";

  try {
    const res = await fetch(`${base}/accessibility`, {
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
  const body = await req.json().catch(() => null) as { url?: string } | null;
  const url = body?.url ? normalizeUrl(body.url) : null;
  if (!url) return NextResponse.json({ error: "A valid http(s) URL is required." }, { status: 400 });

  try {
    const browserResult = await callScraperService(url);
    if (browserResult) return NextResponse.json(browserResult);
    const scannerStatus = process.env.SCRAPER_SERVICE_URL ? "missing_endpoint" : "not_configured";
    return NextResponse.json(await staticFallback(url, scannerStatus));
  } catch {
    return NextResponse.json(await staticFallback(url, "unreachable"));
  }
}

export async function GET() {
  const scannerStatus = await getScannerStatus();
  return NextResponse.json({
    browserScannerConnected: scannerStatus === "ready",
    scannerStatus,
  });
}
