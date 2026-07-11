/**
 * Parses a freeform brand-guide markdown file into a checkable spec.
 * Convention: wrap approved hex colors and font names in backticks, e.g.
 * `#3366CC` or `Inter`. Colors are picked up document-wide. Fonts are only
 * picked up from typography/font-family context so unrelated tokens like
 * shadows, radii, and CSS snippets do not become bogus approved fonts.
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
const TYPOGRAPHY_RE = /font|typeface|typography|text style/i;
const SYSTEM_FONTS = new Set(["system-ui", "-apple-system", "blinkmacsystemfont", "sans-serif", "serif", "monospace", "arial", "helvetica", "times", "times new roman", "roboto"]);

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

function splitFontList(value: string): string[] {
  return value
    .split(",")
    .map(font => font.replace(/^['"]|['"]$/g, "").trim())
    .filter(Boolean);
}

function isLikelyFontName(token: string): boolean {
  if (!token || token.length > 60) return false;
  if (HEX_RE.test(token) || PX_RE.test(token)) return false;
  if (/rgba?\(|hsla?\(|#[0-9a-f]{3,6}\b/i.test(token)) return false;
  if (/[{};]/.test(token)) return false;
  if (/\b\d+(?:px|rem|em|%)\b/i.test(token)) return false;
  if (!/[a-z]/i.test(token)) return false;
  const normalized = token.toLowerCase();
  if (SYSTEM_FONTS.has(normalized)) return false;
  return /^[\w .+'-]+$/.test(token);
}

function addFont(fonts: string[], seenFonts: Set<string>, token: string) {
  for (const rawFont of splitFontList(token)) {
    if (!isLikelyFontName(rawFont)) continue;
    const key = rawFont.toLowerCase();
    if (!seenFonts.has(key)) {
      seenFonts.add(key);
      fonts.push(rawFont);
    }
  }
}

export function parseBrandGuide(markdown: string): BrandGuide {
  const colors = new Set<string>();
  const fonts: string[] = [];
  const seenFonts = new Set<string>();

  for (const token of backtickTokens(markdown)) {
    if (HEX_RE.test(token)) {
      colors.add(normalizeHex(token));
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
    const inTypographySection = TYPOGRAPHY_RE.test(section.heading);
    for (const line of section.body.split("\n")) {
      const isTypographyLine = inTypographySection || TYPOGRAPHY_RE.test(line);
      if (!isTypographyLine) continue;

      for (const token of backtickTokens(line)) {
        if (!HEX_RE.test(token)) addFont(fonts, seenFonts, token);
      }

      for (const match of line.matchAll(/font(?:-family|Family)?\s*:\s*["']([^"']+)["']/gi)) {
        addFont(fonts, seenFonts, match[1]);
      }
    }

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
