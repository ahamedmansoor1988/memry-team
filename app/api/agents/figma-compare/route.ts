import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const maxDuration = 120;

function supabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

function sse(type: string, payload: object) {
  return `data: ${JSON.stringify({ type, ...payload })}\n\n`;
}

async function figmaFetch(
  pat: string,
  path: string,
  onWait?: (secs: number) => void,
  retries = 4,
): Promise<Response> {
  const delays = [10_000, 20_000, 30_000, 40_000];
  for (let i = 0; i < retries; i++) {
    const res = await fetch(`https://api.figma.com/v1${path}`, {
      headers: { "X-Figma-Token": pat },
    });
    if (res.status !== 429) return res;
    const wait = delays[i] ?? 40_000;
    onWait?.(wait / 1000);
    await new Promise(r => setTimeout(r, wait));
  }
  throw new Error("Figma rate limit persists — please wait 1 minute and try again.");
}

function parseFileKey(url: string): string | null {
  const m = url.match(/figma\.com\/(?:file|design)\/([A-Za-z0-9]+)/);
  return m ? m[1] : null;
}

function extractStyleIdsFromNode(node: any, ids: Set<string> = new Set()): string[] {
  if (!node) return [];
  if (node.styles?.text) ids.add(node.styles.text);
  if (node.styles?.fill) ids.add(node.styles.fill);
  for (const child of node.children ?? []) extractStyleIdsFromNode(child, ids);
  return Array.from(ids);
}

function parseNodeId(url: string): string | null {
  const m = url.match(/node-id=([^&]+)/);
  if (!m) return null;
  return decodeURIComponent(m[1]).replace("-", ":");
}

function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (v: number) => Math.round(v * 255).toString(16).padStart(2, "0").toUpperCase();
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function jiraTextBody(body: unknown): string {
  if (typeof body === "string") return body;
  const b = body as any;
  return b?.content?.map((block: any) =>
    block.content?.map((c: any) => c.text ?? "").join("") ?? ""
  ).join("\n") ?? "";
}

interface TextNode {
  id: string;
  name: string;
  characters: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  lineHeightPx: number;
  color: string; // hex
  absoluteBoundingBox: { x: number; y: number; width: number; height: number };
  styleId?: string;
  fillStyleId?: string;
  characterStyleOverrides?: number[];
  styleOverrideTable?: Record<string, any>;
}

interface FrameInfo {
  id: string;
  absoluteBoundingBox: { x: number; y: number; width: number; height: number };
}

interface VisualNode {
  id: string;
  name: string;
  type: string;
  role: "button" | "nav" | "footer" | "card" | "other";
  backgroundColor: string | null;
  borderRadius: number | null;
  borderColor: string | null;
  borderWidth: number | null;
  shadow: string | null;
  paddingTop: number | null;
  paddingRight: number | null;
  paddingBottom: number | null;
  paddingLeft: number | null;
  width: number;
  height: number;
}

function getNodeVisualProps(node: any) {
  const fill = node.fills?.find((f: any) => f.type === "SOLID" && f.visible !== false);
  const bgColor = fill?.color ? rgbToHex(fill.color.r, fill.color.g, fill.color.b) : null;
  const stroke = node.strokes?.find((s: any) => s.type === "SOLID");
  const borderColor = stroke?.color ? rgbToHex(stroke.color.r, stroke.color.g, stroke.color.b) : null;
  const shadowEffect = node.effects?.find((e: any) => e.type === "DROP_SHADOW" && e.visible !== false);
  const shadow = shadowEffect
    ? `${shadowEffect.offset?.x ?? 0}px ${shadowEffect.offset?.y ?? 0}px ${shadowEffect.radius ?? 0}px rgba(${Math.round((shadowEffect.color?.r ?? 0) * 255)},${Math.round((shadowEffect.color?.g ?? 0) * 255)},${Math.round((shadowEffect.color?.b ?? 0) * 255)},${(shadowEffect.color?.a ?? 1).toFixed(2)})`
    : null;
  const bbox = node.absoluteBoundingBox ?? { x: 0, y: 0, width: 0, height: 0 };
  return { bgColor, borderColor, borderWidth: node.strokeWeight ?? null, shadow, bbox,
    borderRadius: node.cornerRadius ?? node.rectangleCornerRadii?.[0] ?? null,
    paddingTop: node.paddingTop ?? null, paddingRight: node.paddingRight ?? null,
    paddingBottom: node.paddingBottom ?? null, paddingLeft: node.paddingLeft ?? null };
}

function countTextChildren(node: any): number {
  let count = 0;
  for (const child of node.children ?? []) {
    if (child.type === "TEXT") count++;
    else count += countTextChildren(child);
  }
  return count;
}

function extractVisualNodes(rootNode: any, results: VisualNode[], frameBbox: { x: number; y: number; width: number; height: number }) {
  const frameTop    = frameBbox.y;
  const frameBottom = frameBbox.y + frameBbox.height;
  const frameWidth  = frameBbox.width;

  function walk(node: any, depth: number) {
    if (depth > 10) return;
    const isFrame = ["FRAME", "COMPONENT", "INSTANCE", "RECTANGLE", "GROUP"].includes(node.type);

    if (isFrame) {
      const p = getNodeVisualProps(node);
      const { bbox } = p;
      const nodeWidth  = bbox.width  ?? 0;
      const nodeHeight = bbox.height ?? 0;
      const nodeTop    = bbox.y ?? 0;
      const nodeBottom = (bbox.y ?? 0) + nodeHeight;

      // Detect role by position + shape — not by name
      let role: VisualNode["role"] = "other";

      // Nav: spans ≥70% of frame width AND sits in top 15% of frame
      if (nodeWidth >= frameWidth * 0.7 && nodeTop <= frameTop + frameBbox.height * 0.15) {
        role = "nav";
      }
      // Footer: spans ≥70% of frame width AND sits in bottom 20% of frame
      else if (nodeWidth >= frameWidth * 0.7 && nodeBottom >= frameBottom - frameBbox.height * 0.2) {
        role = "footer";
      }
      // Button: small, has fill, has corner radius OR stroke, contains 1 text child
      else if (
        nodeWidth > 40 && nodeWidth < 350 &&
        nodeHeight > 20 && nodeHeight < 80 &&
        (p.bgColor || p.borderColor) &&
        ((p.borderRadius ?? 0) > 0 || p.borderColor) &&
        countTextChildren(node) >= 1
      ) {
        role = "button";
      }

      if (role !== "other" || p.shadow || (p.borderRadius ?? 0) > 0) {
        results.push({
          id: node.id, name: node.name ?? "", type: node.type, role,
          backgroundColor: p.bgColor, borderRadius: p.borderRadius,
          borderColor: p.borderColor, borderWidth: p.borderWidth,
          shadow: p.shadow,
          paddingTop: p.paddingTop, paddingRight: p.paddingRight,
          paddingBottom: p.paddingBottom, paddingLeft: p.paddingLeft,
          width: nodeWidth, height: nodeHeight,
        });
      }
    }

    for (const child of node.children ?? []) walk(child, depth + 1);
  }

  walk(rootNode, 0);
}

function extractTextNodes(node: any, frame: FrameInfo | null, results: TextNode[], frameRef: { frame: FrameInfo | null }) {
  if (node.type === "FRAME" && !frameRef.frame) {
    frameRef.frame = { id: node.id, absoluteBoundingBox: node.absoluteBoundingBox };
  }

  if (node.type === "TEXT" && node.characters?.trim()) {
    const style = node.style ?? {};
    const fill  = node.fills?.[0]?.color;
    const color = fill ? rgbToHex(fill.r, fill.g, fill.b) : "#000000";
    results.push({
      id:                   node.id,
      name:                 node.name,
      characters:           node.characters,
      fontFamily:           style.fontFamily ?? "",
      fontSize:             style.fontSize ?? 0,
      fontWeight:           style.fontWeight ?? 400,
      lineHeightPx:         style.lineHeightPx ?? 0,
      color,
      absoluteBoundingBox:  node.absoluteBoundingBox,
      styleId:              node.styles?.text,
      fillStyleId:          node.styles?.fill,
      characterStyleOverrides: node.characterStyleOverrides,
      styleOverrideTable:   node.styleOverrideTable,
    });
  }

  for (const child of node.children ?? []) {
    extractTextNodes(child, frame, results, frameRef);
  }
}

export async function POST(req: NextRequest) {
  const { figmaNodes: prefetched, styleNameMap: prefetchedStyleMap, fileKey, nodeId, liveUrl, liveStyles, liveData, pat, checks, assignTo, forceRefresh } = await req.json() as {
    figmaNodes: any; styleNameMap: Record<string, string>; fileKey: string; nodeId: string;
    liveUrl: string; liveStyles: any[] | null; liveData?: any | null; pat: string; checks?: string[]; assignTo?: string | null; forceRefresh?: boolean;
  };

  const encoder = new TextEncoder();
  const stream  = new ReadableStream({
    async start(controller) {
      function send(type: string, payload: object) {
        controller.enqueue(encoder.encode(sse(type, payload)));
      }

      try {
        // ── Validate live URL ─────────────────────────────────────────────────
        const blockedDomains = ["chatgpt.com", "youtube.com", "youtu.be", "twitter.com", "x.com", "facebook.com", "instagram.com", "localhost"];
        try {
          const parsedUrl = new URL(liveUrl);
          if (blockedDomains.some(d => parsedUrl.hostname.includes(d))) {
            send("error", { text: `"${parsedUrl.hostname}" doesn't look like a live website to compare against. Please paste the URL of the actual live site (e.g. hiverhq.com/uninstall).` });
            controller.close();
            return;
          }
        } catch {
          send("error", { text: "Invalid live site URL. Please paste a valid URL (e.g. https://hiverhq.com/uninstall)." });
          controller.close();
          return;
        }

        // ── Fetch Figma nodes ─────────────────────────────────────────────────
        let figmaNodes = prefetched;
        let styleNameMap: Record<string, string> = prefetchedStyleMap ?? {};

        {
          const db = supabaseAdmin();

          // ── Load Supabase cache ─────────────────────────────────
          const { data: cached } = await db
            .from("figma_node_cache")
            .select("figma_nodes, style_map, cached_at")
            .eq("file_key", fileKey)
            .eq("node_id", nodeId)
            .maybeSingle();

          if (figmaNodes) {
            send("step", { text: "Using Figma data from local cache." });
          } else if (cached && !forceRefresh) {
            figmaNodes   = cached.figma_nodes;
            styleNameMap = (cached.style_map as Record<string, string>) ?? {};
            send("step", { text: `Using cached Figma data (saved ${new Date(cached.cached_at).toLocaleDateString()}).` });
          } else if (forceRefresh && cached) {
            send("step", { text: "Force refresh — fetching latest nodes from Figma…" });
          }

          if (!figmaNodes) {
            if (!cached) send("step", { text: "Fetching Figma nodes for the first time…" });

            // Single attempt — no retries to avoid long waits
            let figmaRes: Response | null = null;
            try {
              figmaRes = await fetch(
                `https://api.figma.com/v1/files/${fileKey}/nodes?ids=${encodeURIComponent(nodeId)}&depth=10`,
                { headers: { "X-Figma-Token": pat }, signal: AbortSignal.timeout(15_000) }
              );
            } catch {
              // timeout or network error
            }

            if (!figmaRes || figmaRes.status === 429) {
              if (cached) {
                figmaNodes   = cached.figma_nodes;
                styleNameMap = (cached.style_map as Record<string, string>) ?? {};
                send("step", { text: "Figma rate limited — using cached data. Wait 1 minute before Force refresh." });
              } else {
                send("error", { text: "Figma rate limited and no cache available. Wait 1 minute and try again." });
                controller.close();
                return;
              }
            } else if (!figmaRes.ok) {
              const txt = await figmaRes.text().catch(() => "");
              send("error", { text: `Figma API error ${figmaRes.status}: ${txt.slice(0, 200)}` });
              controller.close();
              return;
            } else {
            figmaNodes = await figmaRes.json();

            // Resolve named styles
            const rootDocTmp = figmaNodes?.nodes?.[nodeId]?.document;
            const styleIds = extractStyleIdsFromNode(rootDocTmp);
            if (styleIds.length) {
              const stylesRes = await figmaFetch(pat, `/files/${fileKey}/nodes?ids=${styleIds.map(encodeURIComponent).join(",")}`);
              if (stylesRes.ok) {
                const stylesData = await stylesRes.json() as { nodes: Record<string, { document: any }> };
                for (const [id, node] of Object.entries(stylesData.nodes ?? {})) {
                  if ((node as any)?.document?.name) styleNameMap[id] = (node as any).document.name;
                }
              }
            }

            // Save fresh data to Supabase
            await db.from("figma_node_cache").upsert({
              file_key:    fileKey,
              node_id:     nodeId,
              figma_nodes: figmaNodes,
              style_map:   styleNameMap,
              cached_at:   new Date().toISOString(),
            }, { onConflict: "file_key,node_id" });

            send("cache", { figmaNodes, styleNameMap });
            } // end else (fetch succeeded)
          } // end if (!figmaNodes)
        } // end block

        const rootDoc = (figmaNodes as { nodes: Record<string, { document: any }> }).nodes[nodeId]?.document;

        if (!rootDoc) {
          send("error", { text: "Frame not found — make sure the node-id points to a frame or component." });
          controller.close();
          return;
        }

        const textNodes: TextNode[] = [];
        const visualNodes: VisualNode[] = [];
        const frameRef = { frame: null as FrameInfo | null };
        extractTextNodes(rootDoc, null, textNodes, frameRef);
        // Anchor to root node; fall back to first child frame if bbox missing
        const rootBbox = rootDoc.absoluteBoundingBox ?? frameRef.frame?.absoluteBoundingBox ?? { x: 0, y: 0, width: 100, height: 100 };
        const frame: FrameInfo = { id: rootDoc.id, absoluteBoundingBox: rootBbox };
        extractVisualNodes(rootDoc, visualNodes, rootBbox);

        const frameName = rootDoc.name ?? "Unknown frame";
        send("step", { text: `Found frame: "${frameName}" — ${textNodes.length} text nodes, ${visualNodes.length} visual nodes.` });

        if (textNodes.length === 0) {
          send("error", { text: `No text found in frame "${frameName}". Make sure you right-clicked the correct frame and used "Copy link to selection".` });
          controller.close();
          return;
        }

        // ── Step 4: Build live context ────────────────────────────────────────
        let liveContext = "";

        if (liveData) {
          // New structured format from updated extension
          const d = liveData;
          const lines: string[] = [];

          if (d.nav) {
            lines.push("=== NAVIGATION ===");
            lines.push(`Background: ${d.nav.styles?.backgroundColor ?? "unknown"}`);
            if (d.nav.items?.length) {
              lines.push("Nav items:");
              d.nav.items.slice(0, 10).forEach((item: any) => {
                lines.push(`  "${item.text}" — font: ${item.styles.fontFamily} ${item.styles.fontSize} weight:${item.styles.fontWeight} color:${item.styles.color}`);
              });
            }
          }

          if (d.footer) {
            lines.push("=== FOOTER ===");
            lines.push(`Background: ${d.footer.styles?.backgroundColor ?? "unknown"}, color: ${d.footer.styles?.color ?? "unknown"}`);
            if (d.footer.items?.length) {
              lines.push("Footer items:");
              d.footer.items.slice(0, 10).forEach((item: any) => {
                lines.push(`  "${item.text}" — font: ${item.styles.fontFamily} ${item.styles.fontSize} color:${item.styles.color}`);
              });
            }
          }

          if (d.buttons?.length) {
            lines.push("=== CTA BUTTONS ===");
            d.buttons.forEach((btn: any) => {
              const s = btn.styles;
              lines.push(`  "${btn.text}" — font: ${s.fontFamily} ${s.fontSize} weight:${s.fontWeight} color:${s.color} bg:${s.backgroundColor} radius:${s.borderRadius} shadow:${s.boxShadow ?? "none"} padding:${s.paddingTop} ${s.paddingRight} ${s.paddingBottom} ${s.paddingLeft}`);
            });
          }

          if (d.typography?.length) {
            lines.push("=== TYPOGRAPHY ===");
            d.typography.slice(0, 40).forEach((t: any) => {
              lines.push(`  "${t.text}" — ${t.fontFamily} ${t.fontSize} weight:${t.fontWeight} color:${t.color}`);
            });
          }

          if (d.colors?.length) {
            lines.push(`=== COLORS ===\n  ${d.colors.join(", ")}`);
          }

          liveContext = lines.join("\n");
          const btnCount = d.buttons?.length ?? 0;
          const typoCount = d.typography?.length ?? 0;
          send("step", { text: `Extracted ${typoCount} text elements, ${btnCount} buttons, nav, footer from live site.` });

        } else if (Array.isArray(liveStyles) && liveStyles.length > 0) {
          // Legacy flat styles array from old extension
          const fonts   = Array.from(new Set(liveStyles.map((s: any) => s.fontFamily).filter(Boolean)));
          const sizes   = Array.from(new Set(liveStyles.map((s: any) => s.fontSize).filter(Boolean)));
          const weights = Array.from(new Set(liveStyles.map((s: any) => s.fontWeight).filter(Boolean)));
          const colors  = Array.from(new Set(liveStyles.map((s: any) => s.color).filter(Boolean))).slice(0, 25);
          const typoLines = liveStyles.slice(0, 40).map((s: any) =>
            `  "${s.text}" — ${s.fontFamily} ${s.fontSize} weight:${s.fontWeight} color:${s.color}`
          );
          liveContext = `=== TYPOGRAPHY ===\n${typoLines.join("\n")}\n\nFont families: ${fonts.join(", ")}\nFont sizes: ${sizes.join(", ")}\nFont weights: ${weights.join(", ")}\nColors: ${colors.join(", ")}`;
          send("step", { text: `Using ${liveStyles.length} computed styles from extension.` });

        } else {
          // Fallback: server-side CSS scraping only
          send("step", { text: `No extension data — scraping CSS from ${liveUrl}…` });
          try {
            const scrapeRes = await fetch(`${process.env.NEXT_PUBLIC_APP_URL ?? "https://memry-team-opal.vercel.app"}/api/scrape-styles`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ url: liveUrl }),
              signal: AbortSignal.timeout(20_000),
            });
            if (scrapeRes.ok) {
              const s = await scrapeRes.json() as any;
              liveContext = `Font families: ${s.fonts?.join(", ")}\nFont sizes: ${s.sizes?.join(", ")}\nColors: ${s.colors?.join(", ")}`;
              send("step", { text: "CSS scraped (limited — install extension for full data)." });
            }
          } catch {}
        }

        send("step", { text: "Comparing Figma nodes with live styles via AI…" });

        // ── Step 5: AI comparison ─────────────────────────────────────────────
        const figmaFonts   = Array.from(new Set(textNodes.map(n => n.fontFamily).filter(Boolean)));
        const figmaSizes   = Array.from(new Set(textNodes.map(n => n.fontSize).filter(Boolean))).sort((a, b) => b - a);
        const figmaWeights = Array.from(new Set(textNodes.map(n => n.fontWeight).filter(Boolean)));
        const figmaColors  = Array.from(new Set(textNodes.map(n => n.color).filter(Boolean)));

        // Deduplicate text nodes by unique font+size+weight combo — keeps prompt small
        const seenFontCombos = new Set<string>();
        const nodeDetails: string[] = [];
        for (const n of [...textNodes].sort((a, b) => b.fontSize - a.fontSize)) {
          const key = `${n.fontFamily}|${n.fontSize}|${n.fontWeight}|${n.color}`;
          if (seenFontCombos.has(key)) continue;
          seenFontCombos.add(key);
          nodeDetails.push(`text="${n.characters.slice(0, 50)}" font="${n.fontFamily}" size=${n.fontSize}px weight=${n.fontWeight} color=${n.color}`);
          if (nodeDetails.length >= 15) break;
        }

        // Visual nodes: buttons, nav, footer
        const figmaButtons    = visualNodes.filter(n => n.role === "button").slice(0, 5);
        const figmaNavNodes   = visualNodes.filter(n => n.role === "nav").slice(0, 2);
        const figmaFooterNodes = visualNodes.filter(n => n.role === "footer").slice(0, 2);

        const visualDetail = (nodes: VisualNode[]) => nodes.map(n =>
          `  bg:${n.backgroundColor ?? "none"} radius:${n.borderRadius ?? 0}px shadow:${n.shadow ?? "none"} padding:${n.paddingTop ?? 0}/${n.paddingRight ?? 0}/${n.paddingBottom ?? 0}/${n.paddingLeft ?? 0}px`
        ).join("\n");

        // Trim live context to cap total prompt size
        const trimmedLiveContext = liveContext.split("\n").slice(0, 80).join("\n");

        const figmaSummary = `=== FIGMA TYPOGRAPHY ===
Fonts: ${figmaFonts.join(", ")} | Sizes: ${figmaSizes.slice(0, 10).join(", ")}px | Weights: ${figmaWeights.join(", ")} | Colors: ${figmaColors.slice(0, 10).join(", ")}

TEXT NODES:
${nodeDetails.join("\n")}

=== FIGMA NAV ===
${figmaNavNodes.length ? visualDetail(figmaNavNodes) : "  none detected"}

=== FIGMA FOOTER ===
${figmaFooterNodes.length ? visualDetail(figmaFooterNodes) : "  none detected"}

=== FIGMA BUTTONS ===
${figmaButtons.length ? visualDetail(figmaButtons) : "  none detected"}`;

        send("step", { text: "Sending to Groq AI for analysis…" });

        const aiRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method:  "POST",
          signal:  AbortSignal.timeout(55_000),
          headers: {
            Authorization:  `Bearer ${process.env.GROQ_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "llama-3.1-8b-instant",
            temperature: 0,
            max_tokens: 4000,
            messages: [
              {
                role: "system",
                content: `You are a design QA engineer. Compare a Figma design spec against real computed CSS styles from a live website.

The Figma spec and live page may be different pages of the same product — do NOT require text content to match exactly.

Only check the categories the user selected: ${(checks && checks.length > 0 ? checks : ["font_family","font_size","font_weight","color"]).join(", ")}

Category rules:
- font_family: flag typeface mismatches. Use EXACT names from the data.
- font_size: flag size differences > 2px only
- font_weight: flag weight mismatches
- color: flag visually distinct color differences (ignore minor shade variations)
- menu: compare nav/navigation background, font, item colors between FIGMA NAVIGATION and live === NAVIGATION ===
- footer: compare footer background, font, link colors between FIGMA FOOTER and live === FOOTER ===
- buttons: compare button background, border-radius, shadow, font, padding between FIGMA BUTTONS and live === CTA BUTTONS ===
- spacing: compare padding values on buttons/nav/footer

Rules:
- ONLY flag real differences — if Figma value equals Live value, skip it
- Do not flag if values differ by less than 2px for sizes
- Use EXACT values from the data in the "issue" field

For each discrepancy return:
- "element": the element name or text that has the issue (e.g. "Primary Button", "Nav background", or copy exact text from TEXT NODES)
- "label": short human title e.g. "Button border radius wrong"
- "category": font_family | font_size | font_weight | color | menu | footer | buttons | spacing
- "severity": high | medium | low
- "issue": "Figma: <exact value> — Live: <exact value>"
- "severity": "high" | "medium" | "low"

Return ONLY a valid JSON array. No text outside the array.`,
              },
              {
                role: "user",
                content: `FIGMA SPEC:\n${figmaSummary}\n\nLIVE SITE COMPUTED STYLES from ${liveUrl}:\n${trimmedLiveContext}\n\nFind all discrepancies for the selected checks.`,
              },
            ],
          }),
        });

        if (!aiRes.ok) {
          const errTxt = await aiRes.text().catch(() => "");
          send("error", { text: `AI comparison failed: ${aiRes.status} — ${errTxt.slice(0, 200)}` });
          controller.close();
          return;
        }

        send("step", { text: "AI responded — parsing results…" });

        const aiData = await aiRes.json() as { choices: Array<{ message: { content: string } }> };
        const rawContent = aiData.choices[0]?.message?.content?.trim() ?? "[]";

        let discrepancies: Array<{ element: string; label?: string; category?: string; issue: string; severity: string }> = [];
        try {
          const jsonMatch = rawContent.match(/\[[\s\S]*\]/);
          if (!jsonMatch) {
            send("error", { text: `AI returned an unexpected response: ${rawContent.slice(0, 300)}` });
            controller.close();
            return;
          }
          discrepancies = JSON.parse(jsonMatch[0]);
        } catch {
          send("error", { text: `Could not parse AI response: ${rawContent.slice(0, 300)}` });
          controller.close();
          return;
        }

        // Remove false positives (same value on both sides) and deduplicate by issue text
        const seenIssues = new Set<string>();
        discrepancies = discrepancies.filter(d => {
          const parts = d.issue.match(/Figma:\s*(.+?)\s*—\s*Live:\s*(.+)/);
          if (parts && parts[1].trim() === parts[2].trim()) return false; // same value
          if (seenIssues.has(d.issue)) return false; // duplicate
          seenIssues.add(d.issue);
          return true;
        });

        send("step", { text: `AI identified ${discrepancies.length} discrepancies.` });

        // ── Step 6: Post comments to Figma ────────────────────────────────────
        const table: Array<{ element: string; issue: string; commentId?: string }> = [];

        if (discrepancies.length === 0) {
          send("result", {
            text: "No discrepancies found. This can happen if:\n• The live URL doesn't match the Figma frame (e.g. wrong page)\n• The Loupe extension hasn't captured styles from the live site yet (visit the page first, then run again)\n• The design and live site genuinely match",
            table: [],
          });
          controller.close();
          return;
        }

        // Fetch existing comments to avoid duplicates
        let existingMessages = new Set<string>();
        try {
          const existingRes = await fetch(`https://api.figma.com/v1/files/${fileKey}/comments`, {
            headers: { "X-Figma-Token": pat },
          });
          if (existingRes.ok) {
            const existingData = await existingRes.json() as { comments: Array<{ message: string }> };
            existingMessages = new Set(existingData.comments.map(c => c.message));
          }
        } catch {}

        // Group by element text — one comment per unique text element listing all its issues
        const groupedByElement = new Map<string, typeof discrepancies>();
        for (const d of discrepancies) {
          const key = d.element.slice(0, 60);
          if (!groupedByElement.has(key)) groupedByElement.set(key, []);
          groupedByElement.get(key)!.push(d);
        }

        send("step", { text: `Posting ${groupedByElement.size} comments to Figma (one per element)…` });

        const fb = frame.absoluteBoundingBox ?? { x: 0, y: 0, width: 800, height: 600 };
        const elementGroups = Array.from(groupedByElement.entries());

        for (let i = 0; i < elementGroups.length; i++) {
          const [elementText, items] = elementGroups[i];

          // Find matching text node in Figma
          const matchNode = textNodes.find(n =>
            n.characters.toLowerCase().startsWith(elementText.toLowerCase().slice(0, 20)) ||
            elementText.toLowerCase().startsWith(n.characters.toLowerCase().slice(0, 20))
          );

          let offsetX = 20;
          let offsetY = 20 + i * 40;
          if (matchNode?.absoluteBoundingBox) {
            const bbox = matchNode.absoluteBoundingBox;
            offsetX = Math.max(0, bbox.x - fb.x);
            offsetY = Math.max(0, bbox.y - fb.y);
          }

          const severity = items.some(d => d.severity === "high") ? "❌" : items.some(d => d.severity === "medium") ? "⚠️" : "ℹ️";
          const issueLines = items.map(d => {
            const catLabel = (d.category ?? "issue").replace(/_/g, " ");
            return `• ${catLabel}: ${d.issue}`;
          }).join("\n");
          const message = `${severity} "${elementText}"\n\n${issueLines}`;

          if (existingMessages.has(message)) {
            for (const d of items) table.push({ element: elementText, issue: d.issue, commentId: "already posted" });
            continue;
          }

          const commentRes = await fetch(`https://api.figma.com/v1/files/${fileKey}/comments`, {
            method:  "POST",
            headers: { "X-Figma-Token": pat, "Content-Type": "application/json" },
            body: JSON.stringify({
              message,
              client_meta: { node_id: frame.id, node_offset: { x: offsetX, y: offsetY } },
            }),
          });

          let commentId: string | undefined;
          if (commentRes.ok) {
            const cd = await commentRes.json() as { id?: string };
            commentId = cd.id;
          } else {
            console.error(`Comment failed ${commentRes.status}: ${await commentRes.text().catch(() => "")}`);
          }

          for (const d of items) table.push({ element: elementText, issue: `${(d.category ?? "").replace(/_/g, " ")}: ${d.issue}`, commentId });
          await new Promise(r => setTimeout(r, 400));
        }

        const posted = table.filter(r => r.commentId).length;
        const byCategory = discrepancies.reduce((acc, d) => {
          const cat = d.category ?? "other";
          acc[cat] = (acc[cat] ?? 0) + 1;
          return acc;
        }, {} as Record<string, number>);
        const summary = Object.entries(byCategory)
          .map(([cat, count]) => `${count} ${cat.replace("_", " ")}`)
          .join(", ");

        // ── Step 7: Post summary report comment ───────────────────────────────
        send("step", { text: "Posting QA summary report to Figma…" });

        const mentionLine = assignTo ? `\nAssigned to: @${assignTo}` : "";

        const categoryLines = Object.entries(byCategory)
          .map(([cat, count]) => `  • ${count}× ${cat.replace(/_/g, " ")}`)
          .join("\n");

        const reportDate = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
        const reportMessage = `📋 Loupe QA Report — ${reportDate}\n\n${discrepancies.length} issue${discrepancies.length !== 1 ? "s" : ""} found:\n${categoryLines}${mentionLine}\n\nSee individual comments on each element for details.`;

        if (!existingMessages.has(reportMessage)) {
          await fetch(`https://api.figma.com/v1/files/${fileKey}/comments`, {
            method:  "POST",
            headers: { "X-Figma-Token": pat, "Content-Type": "application/json" },
            body: JSON.stringify({
              message: reportMessage,
              client_meta: { node_id: frame.id, node_offset: { x: 0, y: 0 } },
            }),
          });
        }

        send("result", {
          text: `Found ${discrepancies.length} issues: ${summary}. ${posted} comments posted in Figma — open the file to review.`,
          table,
        });

      } catch (err) {
        controller.enqueue(encoder.encode(sse("error", { text: `Unexpected error: ${String(err)}` })));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type":  "text/event-stream",
      "Cache-Control": "no-cache",
      Connection:      "keep-alive",
    },
  });
}
