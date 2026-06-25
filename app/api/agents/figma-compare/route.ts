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
  const { figmaNodes: prefetched, styleNameMap: prefetchedStyleMap, fileKey, nodeId, liveUrl, liveStyles, pat, checks, assignTo, forceRefresh } = await req.json() as {
    figmaNodes: any; styleNameMap: Record<string, string>; fileKey: string; nodeId: string;
    liveUrl: string; liveStyles: any[] | null; pat: string; checks?: string[]; assignTo?: string | null; forceRefresh?: boolean;
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

        const hasExtensionStyles = Array.isArray(liveStyles) && liveStyles.length > 0;
        if (!hasExtensionStyles) {
          send("step", { text: `Scraping styles from ${liveUrl}…` });
        } else {
          send("step", { text: `Using ${liveStyles.length} computed styles from extension + scraping for fonts…` });
        }
        let scrapedStyles: { fonts: string[]; sizes: string[]; weights: string[]; colors: string[]; googleFonts: string[] } | null = null;
        try {
          const scrapeRes = await fetch(`${process.env.NEXT_PUBLIC_APP_URL ?? "https://memry-team-opal.vercel.app"}/api/scrape-styles`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url: liveUrl }),
            signal: AbortSignal.timeout(20_000),
          });
          if (scrapeRes.ok) scrapedStyles = await scrapeRes.json();
        } catch {}

        // Merge scraped styles with extension styles if both available
        const mergedFonts   = Array.from(new Set([
          ...(scrapedStyles?.googleFonts ?? []),
          ...(scrapedStyles?.fonts ?? []),
          ...(liveStyles ?? []).map((s: any) => s.fontFamily).filter(Boolean),
        ])).filter(Boolean);
        const mergedSizes   = Array.from(new Set([
          ...(scrapedStyles?.sizes ?? []),
          ...(liveStyles ?? []).map((s: any) => s.fontSize).filter(Boolean),
        ])).filter(Boolean);
        const mergedWeights = Array.from(new Set([
          ...(scrapedStyles?.weights ?? []),
          ...(liveStyles ?? []).map((s: any) => s.fontWeight).filter(Boolean),
        ])).filter(Boolean);
        const mergedColors  = Array.from(new Set([
          ...(scrapedStyles?.colors ?? []),
          ...(liveStyles ?? []).map((s: any) => s.color).filter(Boolean),
        ])).slice(0, 25);

        if (mergedFonts.length > 0 || mergedColors.length > 0) {
          liveContext = `Font families: ${mergedFonts.join(", ")}\nFont sizes: ${mergedSizes.join(", ")}\nFont weights: ${mergedWeights.join(", ")}\nColors: ${mergedColors.join(", ")}`;
          send("step", { text: `Found ${mergedFonts.length} fonts, ${mergedColors.length} colors from live site.` });
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
