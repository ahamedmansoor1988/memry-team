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
  const { figmaNodes: prefetched, styleNameMap: prefetchedStyleMap, fileKey, nodeId, liveUrl, liveStyles, pat, checks } = await req.json() as {
    figmaNodes: any; styleNameMap: Record<string, string>; fileKey: string; nodeId: string;
    liveUrl: string; liveStyles: any[] | null; pat: string; checks?: string[];
  };

  const encoder = new TextEncoder();
  const stream  = new ReadableStream({
    async start(controller) {
      function send(type: string, payload: object) {
        controller.enqueue(encoder.encode(sse(type, payload)));
      }

      try {
        // ── Fetch Figma nodes ─────────────────────────────────────────────────
        let figmaNodes = prefetched;
        let styleNameMap: Record<string, string> = prefetchedStyleMap ?? {};

        {
          const db = supabaseAdmin();

          // ── Load Supabase cache first ───────────────────────────
          const { data: cached } = await db
            .from("figma_node_cache")
            .select("figma_nodes, style_map, cached_at")
            .eq("file_key", fileKey)
            .eq("node_id", nodeId)
            .maybeSingle();

          // Use prefetched (localStorage) or Supabase cache first — skip Figma API
          if (figmaNodes) {
            send("step", { text: "Using Figma data from local cache." });
          } else if (cached) {
            // Check lastModified only when we have a Supabase cache to compare against
            send("step", { text: "Checking if Figma file has changed…" });
            let figmaLastModified: string | null = null;
            try {
              const metaRes = await fetch(`https://api.figma.com/v1/files/${fileKey}?depth=1`, {
                headers: { "X-Figma-Token": pat },
                signal: AbortSignal.timeout(8_000),
              });
              if (metaRes.ok) {
                const meta = await metaRes.json() as { lastModified?: string };
                figmaLastModified = meta.lastModified ?? null;
              }
            } catch { /* rate limited or timeout — use cache */ }

            const fileChanged = figmaLastModified
              ? new Date(figmaLastModified) > new Date(cached.cached_at)
              : false; // can't confirm change → use cache

            if (!fileChanged) {
              figmaNodes   = cached.figma_nodes;
              styleNameMap = (cached.style_map as Record<string, string>) ?? {};
              send("step", { text: `Using cached Figma data (saved ${new Date(cached.cached_at).toLocaleDateString()}).` });
            } else {
              send("step", { text: "Figma file was updated — re-fetching latest nodes…" });
            }
          }

          if (!figmaNodes) {
            if (!cached) send("step", { text: "Fetching Figma nodes for the first time…" });

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
          } // end if (!figmaNodes)
        } // end block

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

        const frameName = rootDoc.name ?? "Unknown frame";
        send("step", { text: `Found frame: "${frameName}" — ${textNodes.length} text nodes.` });

        if (textNodes.length === 0) {
          send("error", { text: `No text found in frame "${frameName}". Make sure you right-clicked the correct frame and used "Copy link to selection".` });
          controller.close();
          return;
        }

        // ── Step 4: Get live page styles ─────────────────────────────────────
        let liveContext = "";

        if (liveStyles && liveStyles.length > 0) {
          // Use real computed styles from the Chrome extension — aggregate only, no per-element text
          send("step", { text: `Using ${liveStyles.length} computed styles from Loupe extension.` });
          const liveFonts   = Array.from(new Set(liveStyles.map((s: any) => s.fontFamily).filter(Boolean)));
          const liveSizes   = Array.from(new Set(liveStyles.map((s: any) => s.fontSize).filter(Boolean))).sort((a: any, b: any) => parseFloat(b) - parseFloat(a));
          const liveWeights = Array.from(new Set(liveStyles.map((s: any) => s.fontWeight).filter(Boolean)));
          const liveColors  = Array.from(new Set(liveStyles.map((s: any) => s.color).filter(Boolean))).slice(0, 20);
          liveContext = `Font families: ${liveFonts.join(", ")}\nFont sizes: ${liveSizes.slice(0, 15).join(", ")}\nFont weights: ${liveWeights.join(", ")}\nColors: ${liveColors.join(", ")}`;
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

        const sampleTexts = [
          ...textNodes.filter(n => n.fontSize >= 24).slice(0, 8),
          ...textNodes.filter(n => n.fontSize < 24).slice(0, 8),
        ].map(n => `"${n.characters.slice(0, 60)}" (${n.fontFamily} ${n.fontSize}px/${n.fontWeight} ${n.color})`);

        const figmaSummary = `Font families: ${figmaFonts.join(", ")}
Font sizes: ${figmaSizes.join(", ")}px
Font weights: ${figmaWeights.join(", ")}
Colors: ${figmaColors.slice(0, 20).join(", ")}

Sample text nodes (use these for "element" field):
${sampleTexts.join("\n")}`;

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
            max_tokens: 2000,
            messages: [
              {
                role: "system",
                content: `You are a design QA engineer. Compare a Figma design spec against real computed CSS styles from a live website.

The Figma spec and live page may be different pages of the same product — do NOT require text content to match.

Only check the following categories (ignore everything else): ${(checks && checks.length > 0 ? checks : ["font_family","font_size","font_weight","color"]).join(", ")}

Category rules:
- font_family: Flag typeface mismatches (e.g. Figma: Inter, Live: Arial)
- font_size: Flag size differences > 2px, especially headings
- font_weight: Flag weight mismatches (e.g. Figma: 700, Live: 400)
- color: Flag visually distinct color differences in text or backgrounds
- spacing: Flag notable padding/margin differences if visible in the data
- menu: Focus on navigation/header text styles
- footer: Focus on footer text styles
- buttons: Focus on button label styles

Be specific: state Figma value vs live value.
Be thorough — real products almost always have discrepancies.

Return ONLY a JSON array. Each item must have:
- "element": the EXACT text content from the Figma spec that best illustrates this issue (copy a short snippet verbatim, e.g. "We are sad to see you go.")
- "category": the check category (font_family, font_size, etc.)
- "issue": "Figma: X — Live: Y"
- "severity": "high"|"medium"|"low"

Example: { "element": "We are sad to see you go.", "category": "font_size", "issue": "Figma: 26px — Live: 20px", "severity": "high" }

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

        let discrepancies: Array<{ element: string; category?: string; issue: string; severity: string }> = [];
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

        send("step", { text: `Posting ${discrepancies.length} comments to Figma…` });

        const fb = frame.absoluteBoundingBox ?? { x: 0, y: 0, width: 800, height: 600 };
        const total = discrepancies.length;

        for (let commentIndex = 0; commentIndex < discrepancies.length; commentIndex++) {
          const d = discrepancies[commentIndex];

          // Match by actual text content the AI returned
          const needle = d.element.toLowerCase().trim();
          const match = textNodes.find(n =>
            n.characters.toLowerCase().includes(needle.slice(0, 20)) ||
            needle.includes(n.characters.toLowerCase().slice(0, 20))
          );

          let offsetX: number;
          let offsetY: number;

          if (match?.absoluteBoundingBox) {
            const bbox = match.absoluteBoundingBox;
            offsetX = Math.max(0, (bbox.x - fb.x) + bbox.width  / 2);
            offsetY = Math.max(0, (bbox.y - fb.y) + bbox.height / 2);
          } else {
            // Spread evenly down the frame with slight horizontal offset alternation
            offsetX = fb.width * (commentIndex % 2 === 0 ? 0.25 : 0.75);
            offsetY = (fb.height / (total + 1)) * (commentIndex + 1);
          }

          const severity = d.severity === "high" ? "❌" : d.severity === "medium" ? "⚠️" : "ℹ️";
          const message  = `${severity} ${d.element}\n${d.issue}`;

          const commentRes = await fetch(`https://api.figma.com/v1/files/${fileKey}/comments`, {
            method:  "POST",
            headers: { "X-Figma-Token": pat, "Content-Type": "application/json" },
            body: JSON.stringify({
              message,
              client_meta: {
                node_id:     frame.id,
                node_offset: { x: offsetX, y: offsetY },
              },
            }),
          });

          let commentId: string | undefined;
          if (commentRes.ok) {
            const cd = await commentRes.json() as { id?: string };
            commentId = cd.id;
          } else {
            const errText = await commentRes.text().catch(() => "");
            console.error(`Comment post failed ${commentRes.status}: ${errText}`);
          }

          table.push({ element: d.category ?? d.element, issue: `${d.element} — ${d.issue}`, commentId });
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
