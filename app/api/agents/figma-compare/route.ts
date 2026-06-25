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
  const { figmaNodes: prefetched, styleNameMap: prefetchedStyleMap, fileKey, nodeId, liveUrl, liveStyles, pat, checks, forceRefresh } = await req.json() as {
    figmaNodes: any; styleNameMap: Record<string, string>; fileKey: string; nodeId: string;
    liveUrl: string; liveStyles: any[] | null; pat: string; checks?: string[]; forceRefresh?: boolean;
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

            let figmaRes: Response | null = null;
            try {
              figmaRes = await figmaFetch(
                pat,
                `/files/${fileKey}/nodes?ids=${encodeURIComponent(nodeId)}&depth=10`,
                (secs) => send("step", { text: `Figma rate limit — waiting ${secs}s…` }),
              );
            } catch {
              // Rate limit persists — fall back to stale cache if available
            }

            if (!figmaRes || !figmaRes.ok) {
              if (cached) {
                figmaNodes   = cached.figma_nodes;
                styleNameMap = (cached.style_map as Record<string, string>) ?? {};
                send("step", { text: "Figma rate limited — using cached data to continue." });
              } else {
                const txt = figmaRes ? await figmaRes.text().catch(() => "") : "rate limit";
                send("error", { text: `Figma API error: ${txt.slice(0, 200)}. Wait 1 minute and try again.` });
                controller.close();
                return;
              }
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

        // Include per-node detail so AI uses exact font names and can reference real text
        const nodeDetails = [
          ...textNodes.filter(n => n.fontSize >= 24).slice(0, 10),
          ...textNodes.filter(n => n.fontSize < 24 && n.fontSize >= 14).slice(0, 10),
        ].map(n => `text="${n.characters.slice(0, 60)}" font="${n.fontFamily}" size=${n.fontSize}px weight=${n.fontWeight} color=${n.color}`);

        const figmaSummary = `DESIGN SYSTEM:
Font families: ${figmaFonts.join(", ")}
Font sizes: ${figmaSizes.join(", ")}px
Font weights: ${figmaWeights.join(", ")}
Colors: ${figmaColors.slice(0, 15).join(", ")}

TEXT NODES (use exact text value for "element" field):
${nodeDetails.join("\n")}`;

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

The Figma spec and live page may be different pages of the same product — do NOT require text content to match.

Only check: ${(checks && checks.length > 0 ? checks : ["font_family","font_size","font_weight","color"]).join(", ")}

Rules:
- Use EXACT font names from the data — never generalise (e.g. never say "Apple font", say "-apple-system" or "SF Pro")
- font_family: flag typeface mismatches
- font_size: flag size differences > 2px
- font_weight: flag weight mismatches
- color: flag visually distinct color differences

For each discrepancy return:
- "element": copy the EXACT text value from the TEXT NODES list above that best illustrates this issue
- "label": a short human title, e.g. "Heading font family wrong" or "Body text color off"
- "category": font_family | font_size | font_weight | color
- "issue": "Figma: <exact value> — Live: <exact value>"
- "severity": "high" | "medium" | "low"

Return ONLY a valid JSON array. No text outside the array.`,
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

        send("step", { text: `Posting ${discrepancies.length} comments to Figma…` });

        const fb = frame.absoluteBoundingBox ?? { x: 0, y: 0, width: 800, height: 600 };
        const usedNodeIds = new Set<string>();

        for (let i = 0; i < discrepancies.length; i++) {
          const d = discrepancies[i];

          // Find the best matching text node using exact text snippet from AI
          const needle = d.element.toLowerCase().trim();
          const match = textNodes.find(n => {
            if (usedNodeIds.has(n.id)) return false;
            const chars = n.characters.toLowerCase();
            return chars.includes(needle.slice(0, 30)) || needle.slice(0, 30).includes(chars.slice(0, 20));
          }) ?? textNodes.find(n => !usedNodeIds.has(n.id));

          if (match) usedNodeIds.add(match.id);

          const bbox    = match?.absoluteBoundingBox ?? fb;
          const offsetX = Math.max(0, (bbox.x - fb.x) + bbox.width  / 2);
          const offsetY = Math.max(0, (bbox.y - fb.y) + bbox.height / 2);

          const severity = d.severity === "high" ? "❌" : d.severity === "medium" ? "⚠️" : "ℹ️";
          const label    = d.label ?? d.category ?? "Design mismatch";
          const message  = `${severity} ${label}\n\n"${d.element.slice(0, 80)}"\n\n${d.issue}`;

          if (existingMessages.has(message)) {
            table.push({ element: d.label ?? d.category ?? d.element, issue: d.issue, commentId: "already posted" });
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

          table.push({ element: d.label ?? d.category ?? d.element, issue: d.issue, commentId });
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
