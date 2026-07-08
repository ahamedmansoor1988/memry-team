/**
 * Parses a freeform brand-guide markdown file into a checkable palette and
 * font list. Convention: wrap approved hex colors and font names in
 * backticks anywhere in the doc, e.g. `#3366CC` or `Inter`. This keeps the
 * format lenient — no required structure — while still being reliable to
 * parse (backtick spans are unambiguous, unlike guessing from prose).
 */

export interface BrandGuide {
  colors: string[]; // uppercase 6-digit hex, e.g. "#3366CC"
  fonts: string[];  // original casing, deduped case-insensitively
}

const HEX_RE = /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/;

function normalizeHex(hex: string): string {
  const h = hex.slice(1);
  const full = h.length === 3 ? h.split("").map(c => c + c).join("") : h;
  return `#${full.toUpperCase()}`;
}

export function parseBrandGuide(markdown: string): BrandGuide {
  const tokens = Array.from(markdown.matchAll(/`([^`\n]+)`/g)).map(m => m[1].trim());

  const colors = new Set<string>();
  const fonts: string[] = [];
  const seenFonts = new Set<string>();

  for (const token of tokens) {
    if (HEX_RE.test(token)) {
      colors.add(normalizeHex(token));
    } else if (token.length > 0 && token.length < 60 && !token.includes("\n")) {
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

  return { colors: [...colors], fonts };
}
