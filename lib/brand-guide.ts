/**
 * Parses a freeform brand-guide markdown file into a checkable spec.
 * Convention: wrap approved hex colors and font names in backticks
 * anywhere in the doc, e.g. `#3366CC` or `Inter`. Colors and fonts are
 * picked up document-wide regardless of section, so a simple guide with
 * no headings at all still works.
 *
 * Spacing and logo rules are opt-in and section-scoped: put them under a
 * heading containing "spacing"/"grid" or "logo" so they don't get
 * confused with unrelated backtick tokens elsewhere in the doc.
 */

export interface LogoRules {
  minSizePx: number | null;
  minClearSpacePx: number | null;
  approvedColors: string[]; // falls back to the global palette if unset
}

export interface BrandGuide {
  colors: string[]; // uppercase 6-digit hex, e.g. "#3366CC"
  fonts: string[];  // original casing, deduped case-insensitively
  spacing: number[]; // allowed px values, e.g. [8, 16, 24, 32]
  logo: LogoRules | null;
}

const HEX_RE = /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/;
const PX_RE = /^(\d+(?:\.\d+)?)\s*px$/i;

function normalizeHex(hex: string): string {
  const h = hex.slice(1);
  const full = h.length === 3 ? h.split("").map(c => c + c).join("") : h;
  return `#${full.toUpperCase()}`;
}

function splitSections(markdown: string): Array<{ heading: string; body: string }> {
  const lines = markdown.split("\n");
  const sections: Array<{ heading: string; body: string }> = [];
  let current = { heading: "", body: "" };
  for (const line of lines) {
    const headingMatch = line.match(/^#{2,6}\s+(.*)$/);
    if (headingMatch) {
      if (current.body.trim()) sections.push(current);
      current = { heading: headingMatch[1].trim(), body: "" };
    } else {
      current.body += line + "\n";
    }
  }
  if (current.body.trim()) sections.push(current);
  return sections;
}

function backtickTokens(text: string): string[] {
  return Array.from(text.matchAll(/`([^`\n]+)`/g)).map(m => m[1].trim());
}

export function parseBrandGuide(markdown: string): BrandGuide {
  const colors = new Set<string>();
  const fonts: string[] = [];
  const seenFonts = new Set<string>();

  for (const token of backtickTokens(markdown)) {
    if (HEX_RE.test(token)) {
      colors.add(normalizeHex(token));
    } else if (token.length > 0 && token.length < 60 && !PX_RE.test(token)) {
      const key = token.toLowerCase();
      if (!seenFonts.has(key)) {
        seenFonts.add(key);
        fonts.push(token);
      }
    }
  }

  // Fallback: also catch bare hex codes outside backticks, since users will
  // forget the convention — better to over-collect colors than under-collect.
  for (const m of markdown.matchAll(/#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g)) {
    colors.add(normalizeHex(m[0]));
  }

  const spacing = new Set<number>();
  let logo: LogoRules | null = null;

  for (const section of splitSections(markdown)) {
    if (/spacing|grid/i.test(section.heading)) {
      for (const token of backtickTokens(section.body)) {
        const px = token.match(PX_RE);
        if (px) spacing.add(parseFloat(px[1]));
      }
    }
    if (/logo/i.test(section.heading)) {
      const lines = section.body.split("\n");
      let minSizePx: number | null = null;
      let minClearSpacePx: number | null = null;
      const approvedColors = new Set<string>();
      for (const line of lines) {
        const tokens = backtickTokens(line);
        if (/min(?:imum)?\s*(?:size|width|height)/i.test(line)) {
          const px = tokens.map(t => t.match(PX_RE)).find(Boolean);
          if (px) minSizePx = parseFloat(px[1]);
        } else if (/clear\s*-?\s*space/i.test(line)) {
          const px = tokens.map(t => t.match(PX_RE)).find(Boolean);
          if (px) minClearSpacePx = parseFloat(px[1]);
        }
        for (const t of tokens) if (HEX_RE.test(t)) approvedColors.add(normalizeHex(t));
      }
      if (minSizePx !== null || minClearSpacePx !== null || approvedColors.size > 0) {
        logo = {
          minSizePx,
          minClearSpacePx,
          approvedColors: approvedColors.size > 0 ? [...approvedColors] : [...colors],
        };
      }
    }
  }

  return { colors: [...colors], fonts, spacing: [...spacing].sort((a, b) => a - b), logo };
}
