// Pure normalization functions — no I/O, no side effects.
// Converts raw Figma node JSON into QA-relevant typed rows.
// Vectors, animations, interactions, and prototype data are intentionally excluded.

export interface NormalizedTextNode {
  node_id:        string;
  node_name:      string;
  content:        string;
  font_family:    string;
  font_size:      number;
  font_weight:    number;
  font_style:     string;
  letter_spacing: number;
  line_height_px: number;
  text_align:     string;
  fill_color:     string;
  style_id:       string | null;
  fill_style_id:  string | null;
  bounds:         { x: number; y: number; width: number; height: number } | null;
}

export interface NormalizedColorNode {
  node_id:          string;
  node_name:        string;
  node_type:        string;
  fill_color_hex:   string | null;
  fill_opacity:     number | null;
  stroke_color_hex: string | null;
  stroke_width:     number | null;
  border_radius:    number | null;
  shadow:           string | null;
  bounds:           { x: number; y: number; width: number; height: number } | null;
}

export interface NormalizedSnapshot {
  frame_name:      string;
  frame_bounds:    { x: number; y: number; width: number; height: number } | null;
  text_nodes:      NormalizedTextNode[];
  color_nodes:     NormalizedColorNode[];
  raw_node_count:  number;
  visibility_stats: FigmaVisibilityStats;
}

export interface FigmaVisibilityStats {
  textNodesTotal: number;
  skippedHiddenInherited: number;
  skippedHiddenSelf: number;
  skippedZeroSize: number;
  skippedTransparent: number;
  skippedByName: number;
  skippedComponentDef: number;
  skippedVariant: number;
  skippedAriaHidden: number;
  skippedSrOnly: number;
  diffCandidates: number;
  skippedClipped: number;
  skippedMasked: number;
}

export interface FigmaVisibilityOptions {
  skipNamePrefixes?: string[];
  skipAncestorNames?: string[];
}

function rgbToHex(r: number, g: number, b: number): string {
  const h = (v: number) => Math.round(v * 255).toString(16).padStart(2, "0").toUpperCase();
  return `#${h(r)}${h(g)}${h(b)}`;
}

// Leaf node types that never have children — skip traversal into them.
const LEAF_TYPES = new Set(["VECTOR", "BOOLEAN_OPERATION", "STAR", "POLYGON", "LINE"]);

export const FIGMA_VISIBILITY_SNAPSHOT_CUTOFF = "2026-06-30T14:56:51Z";

const DEFAULT_SKIP_NAME_PREFIXES = ["_", "//"];
const DEFAULT_SKIP_ANCESTOR_NAMES = ["annotations", "annotation", "notes", "note", "scratch", "guide", "guides", "old", "wip", "draft", "backup", "hidden"];

function parseCsv(value: string | undefined, fallback: string[]): string[] {
  const parsed = value?.split(",").map(s => s.trim()).filter(Boolean) ?? [];
  return parsed.length > 0 ? parsed : fallback;
}

export function getFigmaVisibilityOptions(options: FigmaVisibilityOptions = {}): Required<FigmaVisibilityOptions> {
  return {
    skipNamePrefixes: options.skipNamePrefixes?.length
      ? options.skipNamePrefixes
      : parseCsv(process.env.FIGMA_SKIP_NAME_PREFIXES, DEFAULT_SKIP_NAME_PREFIXES),
    skipAncestorNames: options.skipAncestorNames?.length
      ? options.skipAncestorNames.map(s => s.toLowerCase())
      : parseCsv(process.env.FIGMA_SKIP_ANCESTOR_NAMES, DEFAULT_SKIP_ANCESTOR_NAMES).map(s => s.toLowerCase()),
  };
}

function emptyStats(): FigmaVisibilityStats {
  return {
    textNodesTotal: 0,
    skippedHiddenInherited: 0,
    skippedHiddenSelf: 0,
    skippedZeroSize: 0,
    skippedTransparent: 0,
    skippedByName: 0,
    skippedComponentDef: 0,
    skippedVariant: 0,
    skippedAriaHidden: 0,
    skippedSrOnly: 0,
    diffCandidates: 0,
    skippedClipped: 0,
    skippedMasked: 0,
  };
}

function hasUsableBounds(node: any, stats?: FigmaVisibilityStats): boolean {
  const box = node.absoluteBoundingBox;
  if (!box) {
    stats && stats.skippedZeroSize++;
    return false;
  }
  const ok = (box.width ?? 0) > 0 && (box.height ?? 0) > 0;
  if (!ok) stats && stats.skippedZeroSize++;
  return ok;
}

export function isEffectivelyVisible(node: any, parentVisible = true, stats?: FigmaVisibilityStats): boolean {
  if (!node) return false;
  if (!parentVisible) {
    stats && stats.skippedHiddenInherited++;
    return false;
  }
  if (node.visible === false) {
    stats && stats.skippedHiddenSelf++;
    return false;
  }
  if ((node.opacity ?? 1) === 0) {
    stats && stats.skippedTransparent++;
    return false;
  }
  if (!hasUsableBounds(node, stats)) return false;

  // Figma may still include hidden/clipped layers in node JSON. When this
  // property is present and null, the node has no rendered pixels.
  if ("absoluteRenderBounds" in node && node.absoluteRenderBounds === null) {
    stats && stats.skippedZeroSize++;
    return false;
  }

  return true;
}

export function isRenderableFigmaNode(node: any): boolean {
  return isEffectivelyVisible(node, true);
}

function isHiddenTextNode(node: any, stats: FigmaVisibilityStats): boolean {
  if (node.type !== "TEXT") return false;
  if (!node.characters?.trim()) return true;
  const fills = node.fills ?? [];
  if (fills.length > 0 && fills.every((f: any) => f.visible === false)) {
    stats.skippedTransparent++;
    return true;
  }
  return false;
}

function isOutside(inner: any, outer: any): boolean {
  if (!inner || !outer) return false;
  const innerRight = inner.x + inner.width;
  const innerBottom = inner.y + inner.height;
  const outerRight = outer.x + outer.width;
  const outerBottom = outer.y + outer.height;
  return innerRight <= outer.x || inner.x >= outerRight || innerBottom <= outer.y || inner.y >= outerBottom;
}

function shouldSkipByName(node: any, ancestorNames: string[], options: Required<FigmaVisibilityOptions>): boolean {
  const name = String(node.name ?? "").trim();
  if (name && options.skipNamePrefixes.some(prefix => name.toLowerCase().startsWith(prefix.toLowerCase()))) return true;
  return ancestorNames.some(n => options.skipAncestorNames.includes(n.trim().toLowerCase()));
}

export function normalizeNodes(rootDoc: any, options: FigmaVisibilityOptions = {}): NormalizedSnapshot {
  const text_nodes:  NormalizedTextNode[]  = [];
  const color_nodes: NormalizedColorNode[] = [];
  const visibility_stats = emptyStats();
  const visibilityOptions = getFigmaVisibilityOptions(options);
  let raw_node_count = 0;
  let frame_bounds: NormalizedSnapshot["frame_bounds"] = null;

  function walk(
    node: any,
    ctx: { parentVisible: boolean; ancestorNames: string[]; clipBounds: any[]; maskBounds: any | null; insideComponentSet: boolean },
  ): void {
    if (!node) return;
    if (!isEffectivelyVisible(node, ctx.parentVisible, visibility_stats)) return;
    if (node.type === "COMPONENT_SET") {
      visibility_stats.skippedComponentDef++;
      return;
    }
    if (node.type === "COMPONENT") {
      visibility_stats.skippedComponentDef++;
      if (ctx.insideComponentSet) visibility_stats.skippedVariant++;
      return;
    }
    if (shouldSkipByName(node, ctx.ancestorNames, visibilityOptions)) {
      visibility_stats.skippedByName++;
      return;
    }
    if (ctx.clipBounds.some(bounds => isOutside(node.absoluteBoundingBox, bounds))) {
      visibility_stats.skippedClipped++;
      return;
    }
    if (ctx.maskBounds && isOutside(node.absoluteBoundingBox, ctx.maskBounds)) {
      visibility_stats.skippedMasked++;
      return;
    }
    raw_node_count++;

    if (node.type === "FRAME" && !frame_bounds && node.absoluteBoundingBox) {
      frame_bounds = node.absoluteBoundingBox;
    }

    if (node.type === "TEXT" && typeof node.characters === "string" && node.characters.trim()) {
      visibility_stats.textNodesTotal++;
      if (isHiddenTextNode(node, visibility_stats)) return;
      const style = node.style ?? {};
      const fill  = node.fills?.[0]?.color;
      visibility_stats.diffCandidates++;
      text_nodes.push({
        node_id:        node.id        ?? "",
        node_name:      node.name      ?? "",
        content:        node.characters,
        font_family:    style.fontFamily  ?? "",
        font_size:      style.fontSize    ?? 0,
        font_weight:    style.fontWeight  ?? 400,
        font_style:     style.italic ? "italic" : "normal",
        letter_spacing: style.letterSpacing ?? 0,
        line_height_px: style.lineHeightPx  ?? 0,
        text_align:     style.textAlignHorizontal ?? "LEFT",
        fill_color:     fill ? rgbToHex(fill.r, fill.g, fill.b) : "#000000",
        style_id:       node.styles?.text ?? null,
        fill_style_id:  node.styles?.fill ?? null,
        bounds:         node.absoluteBoundingBox ?? null,
      });
    } else if (
      ["RECTANGLE", "ELLIPSE", "FRAME", "COMPONENT", "INSTANCE", "GROUP"].includes(node.type)
    ) {
      const solidFill   = node.fills?.find((f: any) => f.type === "SOLID" && f.visible !== false);
      const solidStroke = node.strokes?.find((s: any) => s.type === "SOLID");
      const dropShadow  = node.effects?.find((e: any) => e.type === "DROP_SHADOW" && e.visible !== false);
      const hasVisual   = solidFill || solidStroke || dropShadow || (node.cornerRadius ?? 0) > 0;

      if (hasVisual) {
        color_nodes.push({
          node_id:          node.id   ?? "",
          node_name:        node.name ?? "",
          node_type:        node.type,
          fill_color_hex:   solidFill?.color
            ? rgbToHex(solidFill.color.r, solidFill.color.g, solidFill.color.b)
            : null,
          fill_opacity:     solidFill?.opacity ?? null,
          stroke_color_hex: solidStroke?.color
            ? rgbToHex(solidStroke.color.r, solidStroke.color.g, solidStroke.color.b)
            : null,
          stroke_width:     node.strokeWeight ?? null,
          border_radius:    node.cornerRadius ?? node.rectangleCornerRadii?.[0] ?? null,
          shadow: dropShadow
            ? `${dropShadow.offset?.x ?? 0}px ${dropShadow.offset?.y ?? 0}px ${dropShadow.radius ?? 0}px rgba(${Math.round((dropShadow.color?.r ?? 0) * 255)},${Math.round((dropShadow.color?.g ?? 0) * 255)},${Math.round((dropShadow.color?.b ?? 0) * 255)},${(dropShadow.color?.a ?? 1).toFixed(2)})`
            : null,
          bounds: node.absoluteBoundingBox ?? null,
        });
      }
    }

    if (!LEAF_TYPES.has(node.type)) {
      const childClipBounds = node.clipsContent === true && node.absoluteBoundingBox
        ? [...ctx.clipBounds, node.absoluteBoundingBox]
        : ctx.clipBounds;
      let siblingMaskBounds: any | null = null;
      for (const child of node.children ?? []) {
        walk(child, {
          parentVisible: true,
          ancestorNames: [...ctx.ancestorNames, node.name ?? ""],
          clipBounds: childClipBounds,
          maskBounds: siblingMaskBounds,
          insideComponentSet: node.type === "COMPONENT_SET",
        });
        if (child?.isMask === true && child.absoluteBoundingBox) siblingMaskBounds = child.absoluteBoundingBox;
      }
    }
  }

  walk(rootDoc, { parentVisible: true, ancestorNames: [], clipBounds: [], maskBounds: null, insideComponentSet: false });

  return {
    frame_name:     rootDoc?.name ?? "Unknown",
    frame_bounds:   frame_bounds ?? (rootDoc?.absoluteBoundingBox ?? null),
    text_nodes,
    color_nodes,
    raw_node_count,
    visibility_stats,
  };
}
