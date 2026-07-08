import type { NormalizedSnapshot } from "@/lib/figma-normalize";
import type { BrandGuide } from "@/lib/brand-guide";

export interface BrandFinding {
  id: string;
  kind: "color" | "font";
  severity: "high" | "medium" | "low";
  value: string;
  nearestMatch: string | null;
  distance: number | null;
  count: number;
  examples: string[];
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

// Euclidean RGB distance, 0 (identical) to ~441 (black vs white).
function colorDistance(a: string, b: string): number {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  return Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2);
}

function nearest(hex: string, palette: string[]): { match: string; distance: number } | null {
  if (palette.length === 0) return null;
  let best = palette[0];
  let bestDist = colorDistance(hex, palette[0]);
  for (const c of palette.slice(1)) {
    const d = colorDistance(hex, c);
    if (d < bestDist) { bestDist = d; best = c; }
  }
  return { match: best, distance: Math.round(bestDist) };
}

export function checkBrandConsistency(snapshot: NormalizedSnapshot, brand: BrandGuide): BrandFinding[] {
  const findings: BrandFinding[] = [];

  if (brand.colors.length > 0) {
    const colorUsage = new Map<string, { count: number; examples: string[] }>();
    const record = (hex: string | null | undefined, name: string) => {
      if (!hex || !/^#[0-9A-F]{6}$/i.test(hex)) return;
      const key = hex.toUpperCase();
      const entry = colorUsage.get(key) ?? { count: 0, examples: [] };
      entry.count++;
      if (entry.examples.length < 4 && !entry.examples.includes(name)) entry.examples.push(name);
      colorUsage.set(key, entry);
    };
    for (const t of snapshot.text_nodes) record(t.fill_color, t.node_name || "text");
    for (const c of snapshot.color_nodes) {
      record(c.fill_color_hex, c.node_name || c.node_type);
      record(c.stroke_color_hex, c.node_name || c.node_type);
    }

    const approved = new Set(brand.colors.map(c => c.toUpperCase()));
    for (const [hex, usage] of colorUsage) {
      if (approved.has(hex)) continue;
      const near = nearest(hex, brand.colors);
      findings.push({
        id: `color-${hex}`,
        kind: "color",
        severity: near && near.distance <= 20 ? "low" : near && near.distance <= 60 ? "medium" : "high",
        value: hex,
        nearestMatch: near?.match ?? null,
        distance: near?.distance ?? null,
        count: usage.count,
        examples: usage.examples,
      });
    }
  }

  if (brand.fonts.length > 0) {
    const fontUsage = new Map<string, { count: number; examples: string[] }>();
    for (const t of snapshot.text_nodes) {
      if (!t.font_family) continue;
      const entry = fontUsage.get(t.font_family) ?? { count: 0, examples: [] };
      entry.count++;
      const name = t.node_name || t.content.slice(0, 30) || "text";
      if (entry.examples.length < 4 && !entry.examples.includes(name)) entry.examples.push(name);
      fontUsage.set(t.font_family, entry);
    }

    const approved = new Set(brand.fonts.map(f => f.toLowerCase()));
    for (const [font, usage] of fontUsage) {
      if (approved.has(font.toLowerCase())) continue;
      findings.push({
        id: `font-${font}`,
        kind: "font",
        severity: "high",
        value: font,
        nearestMatch: brand.fonts[0] ?? null,
        distance: null,
        count: usage.count,
        examples: usage.examples,
      });
    }
  }

  return findings.sort((a, b) => b.count - a.count);
}
