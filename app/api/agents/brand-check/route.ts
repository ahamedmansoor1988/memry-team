import { NextRequest, NextResponse } from "next/server";
import { normalizeNodes } from "@/lib/figma-normalize";
import { parseBrandGuide } from "@/lib/brand-guide";
import { checkBrandConsistency } from "@/lib/brand-check";
import { checkDailyLimit, clientIp } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const FREE_CHECKS_PER_DAY = 10;

async function figmaFetch(pat: string, path: string): Promise<Response> {
  return fetch(`https://api.figma.com/v1${path}`, { headers: { "X-Figma-Token": pat } });
}

export async function POST(req: NextRequest) {
  const limit = await checkDailyLimit(`ip:${clientIp(req)}`, "brand-check", FREE_CHECKS_PER_DAY);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: `Daily free check limit reached (${FREE_CHECKS_PER_DAY}/day). Come back tomorrow.` },
      { status: 429 }
    );
  }

  let body: { fileKey?: string; nodeId?: string; pat?: string; brandGuide?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { fileKey, nodeId, pat, brandGuide } = body;
  if (!fileKey || !pat) return NextResponse.json({ error: "A Figma file URL and personal access token are required." }, { status: 400 });
  if (!brandGuide?.trim()) return NextResponse.json({ error: "Upload a brand guide (.md) file." }, { status: 400 });

  const brand = parseBrandGuide(brandGuide);
  if (brand.colors.length === 0 && brand.fonts.length === 0 && brand.spacing.length === 0 && !brand.logo) {
    return NextResponse.json({
      error: "Could not find any checkable rules in that brand guide. Wrap approved hex colors and font names in backticks, e.g. `#3366CC` or `Inter` — or add a Spacing/Logo section.",
    }, { status: 422 });
  }

  let rootDoc: unknown;
  let frameName = "Whole file";
  try {
    if (nodeId) {
      const res = await figmaFetch(pat, `/files/${fileKey}/nodes?ids=${encodeURIComponent(nodeId)}&depth=15`);
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        return NextResponse.json({ error: `Figma API error ${res.status}: ${txt.slice(0, 200)}` }, { status: res.status >= 500 ? 502 : 422 });
      }
      const data = await res.json();
      rootDoc = data?.nodes?.[nodeId]?.document;
      frameName = (rootDoc as { name?: string })?.name ?? frameName;
      if (!rootDoc) return NextResponse.json({ error: "That frame was not found in the Figma file." }, { status: 404 });
    } else {
      const res = await figmaFetch(pat, `/files/${fileKey}?depth=15`);
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        return NextResponse.json({ error: `Figma API error ${res.status}: ${txt.slice(0, 200)}` }, { status: res.status >= 500 ? 502 : 422 });
      }
      const data = await res.json();
      rootDoc = data?.document;
      frameName = data?.name ?? frameName;
      if (!rootDoc) return NextResponse.json({ error: "Could not read that Figma file." }, { status: 404 });
    }
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not reach Figma." }, { status: 503 });
  }

  const snapshot = normalizeNodes(rootDoc);
  const findings = checkBrandConsistency(snapshot, brand);

  return NextResponse.json({
    frameName,
    checkedAt: new Date().toISOString(),
    brandColors: brand.colors,
    brandFonts: brand.fonts,
    brandSpacing: brand.spacing,
    brandLogo: brand.logo,
    colorsChecked: snapshot.color_nodes.length + snapshot.text_nodes.length,
    textNodesChecked: snapshot.text_nodes.length,
    spacingNodesChecked: snapshot.spacing_nodes.length,
    logoNodesFound: snapshot.logo_nodes.length,
    findings,
  });
}
