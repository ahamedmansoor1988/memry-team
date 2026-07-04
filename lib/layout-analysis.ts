/**
 * Turns raw scan data (issue type + computed CSS + measurements) into the
 * explanation a senior frontend engineer would write: root cause, suggested
 * fix, and how confident the inference is. Pure functions — shared by the
 * agent page and the public report.
 */

export interface LayoutAnalysis {
  rootCause: string;
  fix: string;
  confidence: number;
  cssHighlights: Record<string, string>;
}

type Css = Record<string, string> | undefined;
type Metrics = Record<string, number | string | boolean | null> | undefined;

function px(value: string | undefined): number | null {
  if (!value) return null;
  const m = value.match(/^(-?[\d.]+)px$/);
  return m ? parseFloat(m[1]) : null;
}

function pick(css: Css, ...props: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of props) if (css?.[p]) out[p] = css[p];
  return out;
}

export function analyzeLayoutIssue(type: string, css: Css, metrics: Metrics): LayoutAnalysis {
  const viewportWidth = typeof metrics?.viewportWidth === "number" ? metrics.viewportWidth : null;
  const width = px(css?.width);
  const minWidth = px(css?.["min-width"]);
  const marginLeft = px(css?.["margin-left"]);
  const marginRight = px(css?.["margin-right"]);
  const transform = css?.transform && css.transform !== "none" ? css.transform : null;
  const position = css?.position;

  // Overflow-family issues — find the property that pushes the element out.
  if (["horizontal_overflow", "element_wider_than_viewport", "element_outside_viewport"].includes(type)) {
    if (width !== null && viewportWidth !== null && width > viewportWidth) {
      return {
        rootCause: `The element has a fixed width of ${Math.round(width)}px, wider than the ${viewportWidth}px viewport. Fixed pixel widths cannot adapt to smaller screens.`,
        fix: `Replace the fixed width with max-width: 100% (or width: 100%), and let content define the size.`,
        confidence: 95,
        cssHighlights: pick(css, "width", "max-width", "overflow-x"),
      };
    }
    if (minWidth !== null && viewportWidth !== null && minWidth > viewportWidth) {
      return {
        rootCause: `min-width: ${Math.round(minWidth)}px forces the element to stay wider than the ${viewportWidth}px viewport.`,
        fix: `Remove the min-width at this breakpoint, or lower it below the smallest supported viewport.`,
        confidence: 95,
        cssHighlights: pick(css, "min-width", "overflow-x"),
      };
    }
    if (transform && /translate|matrix/.test(transform)) {
      return {
        rootCause: `A CSS transform (${transform.length > 60 ? "translate/matrix" : transform}) shifts the element horizontally out of the viewport. Transforms move the box without affecting layout, so nothing stops it at the edge.`,
        fix: `Remove or constrain the horizontal translate at this breakpoint, or clip it with overflow-x: hidden on the containing section.`,
        confidence: 90,
        cssHighlights: pick(css, "transform", "position", "overflow-x"),
      };
    }
    if ((position === "absolute" || position === "fixed") && (css?.left || css?.right)) {
      return {
        rootCause: `position: ${position} takes the element out of normal flow, and its left/right offset places part of it outside the viewport.`,
        fix: `Keep offsets within the viewport (e.g. left: 0 / right: 0 with max-width: 100%), or clip the parent with overflow: hidden.`,
        confidence: 85,
        cssHighlights: pick(css, "position", "left", "right", "overflow-x"),
      };
    }
    if ((marginLeft !== null && marginLeft < 0) || (marginRight !== null && marginRight < 0)) {
      return {
        rootCause: `A negative horizontal margin pulls the element outside its container, extending the scrollable area.`,
        fix: `Remove the negative margin at this breakpoint, or compensate with matching padding on the parent.`,
        confidence: 85,
        cssHighlights: pick(css, "margin-left", "margin-right", "overflow-x"),
      };
    }
    return {
      rootCause: type === "horizontal_overflow"
        ? `A descendant element is wider than the viewport and no ancestor clips it (overflow-x is ${css?.["overflow-x"] ?? "visible"}), so the whole page scrolls sideways.`
        : `The element's rendered box extends past the viewport edge and nothing clips it.`,
      fix: `Constrain the element with max-width: 100%. As a stopgap, overflow-x: hidden on the page container hides the scroll but does not fix the layout.`,
      confidence: 65,
      cssHighlights: pick(css, "width", "position", "transform", "overflow-x"),
    };
  }

  if (type === "clipped_text" || type === "long_unbroken_text") {
    if (css?.["white-space"] === "nowrap") {
      return {
        rootCause: `white-space: nowrap prevents this text from wrapping, so it overflows its container instead.`,
        fix: `Allow wrapping (white-space: normal), or truncate deliberately with text-overflow: ellipsis + overflow: hidden.`,
        confidence: 90,
        cssHighlights: pick(css, "white-space", "overflow-x", "width"),
      };
    }
    if (type === "long_unbroken_text") {
      return {
        rootCause: `A long unbroken string (URL, token, or word) has no break opportunities, so the browser cannot wrap it on narrow screens.`,
        fix: `Add overflow-wrap: break-word (or word-break: break-all for URLs/codes) to the text container.`,
        confidence: 80,
        cssHighlights: pick(css, "white-space", "width"),
      };
    }
    return {
      rootCause: `The container is smaller than its text content and hides the overflow, so the text is cut off at this viewport size.`,
      fix: `Let the container grow (remove fixed height/width), reduce the font size at this breakpoint, or allow the text to wrap.`,
      confidence: 75,
      cssHighlights: pick(css, "width", "white-space", "overflow-x"),
    };
  }

  if (type === "sticky_covering_content") {
    return {
      rootCause: `position: ${position ?? "fixed"} keeps this element pinned while scrolling, and its height takes up a large share of the viewport.`,
      fix: `Reduce the pinned element's height on smaller viewports, or unpin it (position: static) below a breakpoint.`,
      confidence: 85,
      cssHighlights: pick(css, "position", "transform"),
    };
  }

  if (type === "oversized_modal") {
    return {
      rootCause: `The dialog's dimensions exceed the viewport, so parts of it (often the actions) render off-screen.`,
      fix: `Cap the overlay with max-width: 100vw; max-height: 100dvh; overflow: auto so content scrolls inside the dialog.`,
      confidence: 90,
      cssHighlights: pick(css, "width", "position", "transform"),
    };
  }

  if (type === "small_tap_target") {
    return {
      rootCause: `The interactive element's rendered box is below the recommended minimum tap size, usually because padding is missing around a small label or icon.`,
      fix: `Add padding to reach at least 36x36px (padding: 8px 12px on text links; min-width/min-height on icon buttons).`,
      confidence: 80,
      cssHighlights: pick(css, "width", "display"),
    };
  }

  return {
    rootCause: `The element's rendered geometry violates the expected layout constraint at this viewport size.`,
    fix: `Inspect the highlighted element at this breakpoint and constrain its size or position.`,
    confidence: 55,
    cssHighlights: pick(css, "width", "position", "transform", "overflow-x"),
  };
}
