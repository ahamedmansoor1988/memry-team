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
  const { figmaNodes: prefetched, styleNameMap: prefetchedStyleMap, fileKey, nodeId, liveUrl, liveStyles, pat } = await req.json() as {
    figmaNodes: any; styleNameMap: Record<string, string>; fileKey: string; nodeId: string;
    liveUrl: string; liveStyles: any[] | null; pat: string;
  };

  const encoder = new TextEncoder();
  const stream  = new ReadableStream({
    async start(controller) {
      function send(type: string, payload: object) {
        controller.enqueue(encoder.encode(sse(type, payload)));
      }

      try {
        // ── Fetch Figma nodes server-side if not pre-fetched ─────────────────
        let figmaNodes = prefetched;
        let styleNameMap: Record<string, string> = prefetchedStyleMap ?? {};

        if (!figmaNodes) {
          // ── Check Supabase cache ────────────────────────────────
          const db = supabaseAdmin();
          const { data: cached } = await db
            .from("figma_node_cache")
            .select("figma_nodes, style_map, cached_at")
            .eq("file_key", fileKey)
            .eq("node_id", nodeId)
            .maybeSingle();

          if (cached) {
            figmaNodes   = cached.figma_nodes;
            styleNameMap = (cached.style_map as Record<string, string>) ?? {};
            send("step", { text: `Figma nodes loaded from database cache (saved ${new Date(cached.cached_at).toLocaleDateString()}).` });
          } else {
            send("step", { text: "Fetching Figma node tree via server…" });
            const figmaRes = await figmaFetch(
            pat,
            `/files/${fileKey}/nodes?ids=${encodeURIComponent(nodeId)}&depth=10`,
            (secs) => send("step", { text: `Figma rate limit — waiting ${secs}s…` }),
          );
          if (!figmaRes.ok) {
            const txt = await figmaRes.text();
            send("error", { text: `Figma API error ${figmaRes.status}: ${txt.slice(0, 200)}` });
            controller.close();
            return;
          }
          figmaNodes = await figmaRes.json();

          // Resolve named styles
          const rootDocTmp = figmaNodes?.nodes?.[nodeId]?.document;
          const styleIds = extractStyleIdsFromNode(rootDocTmp);
          if (styleIds.length) {
            const stylesRes = await figmaFetch(
              pat,
              `/files/${fileKey}/nodes?ids=${styleIds.map(encodeURIComponent).join(",")}`,
            );
            if (stylesRes.ok) {
              const stylesData = await stylesRes.json() as { nodes: Record<string, { document: any }> };
              for (const [id, node] of Object.entries(stylesData.nodes ?? {})) {
                if ((node as any)?.document?.name) styleNameMap[id] = (node as any).document.name;
              }
            }
          }

          // ── Save to Supabase cache ────────────────────────────
          send("step", { text: "Saving Figma nodes to database cache…" });
          await db.from("figma_node_cache").upsert({
            file_key:    fileKey,
            node_id:     nodeId,
            figma_nodes: figmaNodes,
            style_map:   styleNameMap,
            cached_at:   new Date().toISOString(),
          }, { onConflict: "file_key,node_id" });

          // Also send to client localStorage as secondary cache
          send("cache", { figmaNodes, styleNameMap });
          }
        }

        const rootDoc = (figmaNodes as { nodes: Record<string, { document: any }> }).nodes[nodeId]?.document;

        if (!rootDoc) {
          send("error", { text: "Frame not found — make sure the node-id points to a frame or component." });
          controller.close();
          return;
        }

        const textNodes: TextNode[] = [];
        const frameRef = { frame: null as FrameInfo | null };
        extractTextNodes(rootDoc, null, textNodes, frameRef);
        // Anchor to root node; fall back to first child frame if bbox missing
        const rootBbox = rootDoc.absoluteBoundingBox ?? frameRef.frame?.absoluteBoundingBox ?? { x: 0, y: 0, width: 100, height: 100 };
        const frame: FrameInfo = { id: rootDoc.id, absoluteBoundingBox: rootBbox };

        send("step", { text: `Found ${textNodes.length} text nodes in frame.` });

        // ── Step 4: Get live page styles ─────────────────────────────────────
        let liveContext = "";

        if (liveStyles && liveStyles.length > 0) {
          // Use real computed styles from the Chrome extension
          send("step", { text: `Using ${liveStyles.length} computed styles from Loupe extension.` });
          liveContext = liveStyles.slice(0, 100).map((s: any) =>
            `"${s.text}" — ${s.fontFamily} ${s.fontSize}/${s.fontWeight} ${s.color ?? "no color"}`
          ).join("\n");
        } else {
          // Fallback: fetch raw HTML
          send("step", { text: `Fetching live page HTML from ${liveUrl}…` });
          let liveHtml = "";
          try {
            const liveRes = await fetch(liveUrl, {
              headers: { "User-Agent": "Mozilla/5.0 (compatible; Loupe/1.0)" },
              signal: AbortSignal.timeout(15_000),
            });
            liveHtml = await liveRes.text();
            liveHtml = liveHtml.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "");
            liveHtml = liveHtml.slice(0, 12_000);
          } catch (e) {
            send("error", { text: `Could not fetch live URL: ${String(e)}` });
            controller.close();
            return;
          }
          liveContext = liveHtml;
          send("step", { text: "Tip: Install the Loupe extension for more accurate results using real computed styles." });
        }

        send("step", { text: "Comparing Figma nodes with live styles via AI…" });

        // ── Step 5: AI comparison ─────────────────────────────────────────────
        // Build design-system-level summary instead of per-element text matching
        const figmaFonts   = Array.from(new Set(textNodes.map(n => n.fontFamily).filter(Boolean)));
        const figmaSizes   = Array.from(new Set(textNodes.map(n => n.fontSize).filter(Boolean))).sort((a, b) => b - a);
        const figmaWeights = Array.from(new Set(textNodes.map(n => n.fontWeight).filter(Boolean)));
        const figmaColors  = Array.from(new Set(textNodes.map(n => n.color).filter(Boolean)));

        const headingNodes = textNodes.filter(n => n.fontSize >= 24).slice(0, 10);
        const bodyNodes    = textNodes.filter(n => n.fontSize < 24).slice(0, 15);

        const figmaSummary = `DESIGN SYSTEM:
Font families: ${figmaFonts.join(", ")}
Font sizes: ${figmaSizes.join(", ")}px
Font weights: ${figmaWeights.join(", ")}
Colors: ${figmaColors.join(", ")}

HEADINGS:
${headingNodes.map(n => `"${n.characters.slice(0, 50)}" — ${n.fontFamily} ${n.fontSize}px/${n.fontWeight} ${n.color}`).join("\n")}

BODY TEXT:
${bodyNodes.map(n => `"${n.characters.slice(0, 50)}" — ${n.fontFamily} ${n.fontSize}px/${n.fontWeight} ${n.color}`).join("\n")}`;

        send("step", { text: "Sending to Groq AI for analysis…" });

        const aiRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method:  "POST",
          signal:  AbortSignal.timeout(55_000),
          headers: {
            Authorization:  `Bearer ${process.env.GROQ_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "llama-3.3-70b-versatile",
            temperature: 0,
            max_tokens: 2000,
            messages: [
              {
                role: "system",
                content: `You are a design QA engineer. Compare a Figma design spec against real computed CSS styles from a live website.

The Figma spec and live page may be different pages of the same product — do NOT require text content to match. Compare design system properties:

1. FONT FAMILIES — does the live site use the same typefaces? Flag any mismatch (e.g. Figma: Inter, Live: Arial).
2. FONT SIZES — compare the size scale. Flag if heading sizes differ by more than 2px.
3. FONT WEIGHTS — if Figma uses 700 but live renders 400, flag it.
4. COLORS — compare the palettes. Flag color differences that are visually distinct.

Be specific with your findings: state the Figma value vs the live value.
Be thorough — real products almost always have at least some discrepancies.

Return ONLY a JSON array:
[{ "element": "description", "issue": "Figma: X — Live: Y", "severity": "high"|"medium"|"low" }]

Do not include any text outside the JSON array.`,
              },
              {
                role: "user",
                content: `FIGMA SPEC:\n${figmaSummary}\n\nLIVE SITE COMPUTED STYLES from ${liveUrl}:\n${liveContext}\n\nFind all typography and color discrepancies.`,
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

        let discrepancies: Array<{ element: string; issue: string; severity: string }> = [];
        try {
          const jsonMatch = rawContent.match(/\[[\s\S]*\]/);
          discrepancies = jsonMatch ? JSON.parse(jsonMatch[0]) : [];
        } catch {
          send("error", { text: `Could not parse AI response: ${rawContent.slice(0, 300)}` });
          controller.close();
          return;
        }

        send("step", { text: `AI identified ${discrepancies.length} discrepancies.` });

        // ── Step 6: Post comments to Figma ────────────────────────────────────
        const table: Array<{ element: string; issue: string; commentId?: string }> = [];

        if (discrepancies.length === 0) {
          send("result", {
            text: "No discrepancies found — the live site appears to match the Figma frame. Try switching to the live site tab so the extension can re-capture fresh styles, then run again.",
            table: [],
          });
          controller.close();
          return;
        }

        send("step", { text: `Posting ${discrepancies.length} comments to Figma…` });

        const frameBbox = frame.absoluteBoundingBox;
        let commentIndex = 0;

        for (const d of discrepancies) {
          // Find best matching text node
          const match = textNodes.find(n =>
            n.characters.toLowerCase().includes(d.element.toLowerCase().split(" ")[0]) ||
            d.element.toLowerCase().includes(n.name.toLowerCase())
          ) ?? textNodes[commentIndex % textNodes.length];

          const bbox    = match?.absoluteBoundingBox ?? frameBbox ?? { x: 0, y: 0, width: 100, height: 100 };
          const fb      = frameBbox ?? { x: 0, y: 0, width: 100, height: 100 };
          const offsetX = (bbox.x - fb.x) + bbox.width / 2;
          const offsetY = (bbox.y - fb.y) + bbox.height / 2;

          const severity = d.severity === "high" ? "❌" : d.severity === "medium" ? "⚠️" : "ℹ️";
          const message  = `${severity} DESIGN MISMATCH\n\n${d.element}\n\n${d.issue}`;

          const commentRes = await fetch(`https://api.figma.com/v1/files/${fileKey}/comments`, {
            method:  "POST",
            headers: { "X-Figma-Token": pat, "Content-Type": "application/json" },
            body: JSON.stringify({
              message,
              client_meta: {
                node_id:           frame.id,
                node_offset:       { x: offsetX, y: offsetY },
                region_width:      bbox.width,
                region_height:     bbox.height,
                comment_pin_corner: "bottom-right",
              },
            }),
          });

          let commentId: string | undefined;
          if (commentRes.ok) {
            const cd = await commentRes.json() as { id?: string };
            commentId = cd.id;
          }

          table.push({ element: d.element, issue: d.issue, commentId });
          commentIndex++;
        }

        const posted = table.filter(r => r.commentId).length;
        send("result", {
          text: `Comparison complete — ${discrepancies.length} discrepancies found, ${posted} comments posted in Figma. Open the file to review.`,
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
