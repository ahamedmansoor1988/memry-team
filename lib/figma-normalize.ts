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
}

function rgbToHex(r: number, g: number, b: number): string {
  const h = (v: number) => Math.round(v * 255).toString(16).padStart(2, "0").toUpperCase();
  return `#${h(r)}${h(g)}${h(b)}`;
}

// Leaf node types that never have children — skip traversal into them.
const LEAF_TYPES = new Set(["VECTOR", "BOOLEAN_OPERATION", "STAR", "POLYGON", "LINE"]);

export function normalizeNodes(rootDoc: any): NormalizedSnapshot {
  const text_nodes:  NormalizedTextNode[]  = [];
  const color_nodes: NormalizedColorNode[] = [];
  let raw_node_count = 0;
  let frame_bounds: NormalizedSnapshot["frame_bounds"] = null;

  function walk(node: any): void {
    if (!node) return;
    if (node.visible === false) return;
    if ((node.opacity ?? 1) === 0) return;
    raw_node_count++;

    if (node.type === "FRAME" && !frame_bounds && node.absoluteBoundingBox) {
      frame_bounds = node.absoluteBoundingBox;
    }

    if (node.type === "TEXT" && typeof node.characters === "string" && node.characters.trim()) {
      const style = node.style ?? {};
      const fill  = node.fills?.[0]?.color;
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
      for (const child of node.children ?? []) walk(child);
    }
  }

  walk(rootDoc);

  return {
    frame_name:     rootDoc?.name ?? "Unknown",
    frame_bounds:   frame_bounds ?? (rootDoc?.absoluteBoundingBox ?? null),
    text_nodes,
    color_nodes,
    raw_node_count,
  };
}
