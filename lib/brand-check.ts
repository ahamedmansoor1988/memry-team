import type { NormalizedSnapshot } from "@/lib/figma-normalize";
import type { BrandGuide } from "@/lib/brand-guide";

export interface BrandFinding {
  id: string;
  kind: "color" | "font" | "spacing" | "logo";
  severity: "high" | "medium" | "low";
  value: string;
  nearestMatch: string | null;
  distance: number | null;
  count: number;
  examples: string[];
  // First-occurrence location — only populated for live-URL scans (Figma
  // findings have no rendered screenshot to place a marker on).
  section?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

interface Location { section?: string; x?: number; y?: number; width?: number; height?: number; }
function locationOf(bounds: { x: number; y: number; width: number; height: number } | null | undefined, section: string | undefined): Location {
  if (!bounds) return { section };
  return { section, x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function colorTraits(hex: string) {
  const [r, g, b] = hexToRgb(hex).map(v => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;
  const saturation = max === min ? 0 : (max - min) / (1 - Math.abs(2 * lightness - 1));
  return { lightness, saturation };
}

function colorSeverity(hex: string, distance: number | null, maxArea: number): BrandFinding["severity"] {
  if (distance === null) return "high";
  const { lightness, saturation } = colorTraits(hex);
  const isNeutral = saturation < 0.08;
  const isNearWhite = isNeutral && lightness > 0.9;
  const isSmallRegion = maxArea > 0 && maxArea < 2500;

  if (distance <= 16 || (isNearWhite && distance <= 32) || (isNeutral && distance <= 24) || isSmallRegion) return "low";
  if (distance <= 70 || (isNeutral && distance <= 90)) return "medium";
  return "high";
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
    const colorUsage = new Map<string, { count: number; examples: string[]; loc: Location; maxArea: number }>();
    const record = (hex: string | null | undefined, name: string, bounds: { x: number; y: number; width: number; height: number } | null | undefined, section: string | undefined) => {
      if (!hex || !/^#[0-9A-F]{6}$/i.test(hex)) return;
      const key = hex.toUpperCase();
      const area = bounds ? Math.max(0, bounds.width * bounds.height) : 0;
      const entry = colorUsage.get(key) ?? { count: 0, examples: [], loc: locationOf(bounds, section), maxArea: area };
      entry.count++;
      if (area > entry.maxArea) {
        entry.maxArea = area;
        entry.loc = locationOf(bounds, section);
      }
      if (entry.examples.length < 4 && !entry.examples.includes(name)) entry.examples.push(name);
      colorUsage.set(key, entry);
    };
    for (const t of snapshot.text_nodes) record(t.fill_color, t.node_name || "text", t.bounds, t.section);
    for (const c of snapshot.color_nodes) {
      record(c.fill_color_hex, c.node_name || c.node_type, c.bounds, c.section);
      record(c.stroke_color_hex, c.node_name || c.node_type, c.bounds, c.section);
    }

    const approved = new Set(brand.colors.map(c => c.toUpperCase()));
    for (const [hex, usage] of colorUsage) {
      if (approved.has(hex)) continue;
      const near = nearest(hex, brand.colors);
      findings.push({
        id: `color-${hex}`,
        kind: "color",
        severity: colorSeverity(hex, near?.distance ?? null, usage.maxArea),
        value: hex,
        nearestMatch: near?.match ?? null,
        distance: near?.distance ?? null,
        count: usage.count,
        examples: usage.examples,
        ...usage.loc,
      });
    }
  }

  if (brand.fonts.length > 0) {
    const fontUsage = new Map<string, { count: number; examples: string[]; loc: Location }>();
    for (const t of snapshot.text_nodes) {
      if (!t.font_family) continue;
      const entry = fontUsage.get(t.font_family) ?? { count: 0, examples: [], loc: locationOf(t.bounds, t.section) };
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
        ...usage.loc,
      });
    }
  }

  if (brand.spacing.length > 0) {
    const spacingUsage = new Map<number, { count: number; examples: string[] }>();
    for (const s of snapshot.spacing_nodes) {
      const values = [s.padding_left, s.padding_right, s.padding_top, s.padding_bottom, s.item_spacing];
      for (const v of values) {
        if (!v || v <= 0) continue; // 0 always means "no gap requested" — never a violation
        const rounded = Math.round(v);
        const entry = spacingUsage.get(rounded) ?? { count: 0, examples: [] };
        entry.count++;
        if (entry.examples.length < 4 && !entry.examples.includes(s.node_name)) entry.examples.push(s.node_name || s.layout_mode);
        spacingUsage.set(rounded, entry);
      }
    }

    const approved = new Set(brand.spacing);
    for (const [px, usage] of spacingUsage) {
      if (approved.has(px)) continue;
      let nearestPx = brand.spacing[0];
      let bestDist = Math.abs(px - nearestPx);
      for (const a of brand.spacing.slice(1)) {
        const d = Math.abs(px - a);
        if (d < bestDist) { bestDist = d; nearestPx = a; }
      }
      findings.push({
        id: `spacing-${px}`,
        kind: "spacing",
        severity: bestDist <= 2 ? "low" : bestDist <= 8 ? "medium" : "high",
        value: `${px}px`,
        nearestMatch: `${nearestPx}px`,
        distance: bestDist,
        count: usage.count,
        examples: usage.examples,
      });
    }
  }

  if (brand.logo) {
    const rules = brand.logo;
    for (const logo of snapshot.logo_nodes) {
      const label = logo.node_name || "Logo";
      const loc = locationOf(logo.bounds, "Logo");

      if (rules.minSizePx !== null && logo.bounds) {
        const smallestSide = Math.min(logo.bounds.width, logo.bounds.height);
        if (smallestSide < rules.minSizePx) {
          findings.push({
            id: `logo-size-${logo.node_id}`,
            kind: "logo",
            severity: smallestSide < rules.minSizePx * 0.5 ? "high" : "medium",
            value: `${Math.round(smallestSide)}px`,
            nearestMatch: `${rules.minSizePx}px minimum`,
            distance: Math.round(rules.minSizePx - smallestSide),
            count: 1,
            examples: [label],
            ...loc,
          });
        }
      }

      if (rules.minClearSpacePx !== null && logo.min_sibling_gap_px !== null && logo.min_sibling_gap_px < rules.minClearSpacePx) {
        findings.push({
          id: `logo-clearspace-${logo.node_id}`,
          kind: "logo",
          severity: logo.min_sibling_gap_px <= 0 ? "high" : "medium",
          value: `${logo.min_sibling_gap_px}px clear space`,
          nearestMatch: `${rules.minClearSpacePx}px minimum`,
          distance: Math.round(rules.minClearSpacePx - logo.min_sibling_gap_px),
          count: 1,
          examples: [label],
          ...loc,
        });
      }

      if (rules.approvedColors.length > 0 && logo.fill_color_hex) {
        const approved = new Set(rules.approvedColors.map(c => c.toUpperCase()));
        if (!approved.has(logo.fill_color_hex.toUpperCase())) {
          const near = nearest(logo.fill_color_hex, rules.approvedColors);
          findings.push({
            id: `logo-color-${logo.node_id}`,
            kind: "logo",
            severity: "high",
            value: logo.fill_color_hex,
            nearestMatch: near?.match ?? null,
            distance: near?.distance ?? null,
            count: 1,
            examples: [label],
            ...loc,
          });
        }
      }
    }
  }

  return findings.sort((a, b) => b.count - a.count);
}
