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

interface FigmaRequestLog {
  reqId: string; method: string; path: string; startedAt: string;
  durationMs: number; status: number; retryAfterSec: number | null;
  payloadBytes: number | null; retried: boolean;
}
interface FigmaFetchOptions {
  method?: string; body?: string;
  onWait?: (secs: number) => void;
  onLog?: (log: FigmaRequestLog) => void;
}

async function figmaFetch(
  pat: string,
  path: string,
  onWaitOrOpts?: ((secs: number) => void) | FigmaFetchOptions,
): Promise<Response> {
  const opts: FigmaFetchOptions =
    typeof onWaitOrOpts === "function" ? { onWait: onWaitOrOpts } : (onWaitOrOpts ?? {});
  const { method = "GET", body, onWait, onLog } = opts;
  const reqId = Math.random().toString(36).slice(2, 10);

  async function doFetch(retried: boolean): Promise<Response> {
    const startedAt = new Date().toISOString();
    const t0 = Date.now();
    const res = await fetch(`https://api.figma.com/v1${path}`, {
      method,
      headers: { "X-Figma-Token": pat, ...(body ? { "Content-Type": "application/json" } : {}) },
      ...(body ? { body } : {}),
    });
    const durationMs    = Date.now() - t0;
    const raHeader      = res.headers.get("Retry-After");
    const retryAfterSec = raHeader !== null ? parseInt(raHeader, 10) : null;
    const clHeader      = res.headers.get("Content-Length");
    const payloadBytes  = clHeader !== null ? parseInt(clHeader, 10) : null;
    const logEntry: FigmaRequestLog = {
      reqId, method, path, startedAt, durationMs,
      status: res.status, retryAfterSec, payloadBytes, retried,
    };
    onLog?.(logEntry);
    console.log(
      `[figma] [${reqId}] ${method} ${path} → ${res.status} ${durationMs}ms` +
      (retryAfterSec !== null ? ` retry-after:${retryAfterSec}s` : "") +
      (payloadBytes !== null ? ` ${(payloadBytes / 1024).toFixed(1)}KB` : ""),
    );

    if (res.status === 429) {
      if (retried) throw new Error("Figma rate limit persists — please wait a moment and try again.");
      const waitSec = Math.min(retryAfterSec ?? 30, 30);
      onWait?.(waitSec);
      await new Promise(r => setTimeout(r, waitSec * 1_000));
      return doFetch(true);
    }
    return res;
  }

  return doFetch(false);
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
  return decodeURIComponent(m[1]).replace(/-/g, ":");
}

function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (v: number) => Math.round(v * 255).toString(16).padStart(2, "0").toUpperCase();
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
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
    if (node.visible === false) return;
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
  if (node.visible === false) return;

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
  const {
    figmaNodes: prefetched, styleNameMap: prefetchedStyleMap,
    fileKey, nodeId, liveUrl, liveStyles, liveData,
    pat, checks, assignTo, forceRefresh, snapshotId: incomingSnapshotId,
  } = await req.json() as {
    figmaNodes: any; styleNameMap: Record<string, string>; fileKey: string; nodeId: string;
    liveUrl: string; liveStyles: any[] | null; liveData?: any | null; pat: string;
    checks?: string[]; assignTo?: string | null; forceRefresh?: boolean;
    snapshotId?: string | null;
  };

  const encoder = new TextEncoder();
  const stream  = new ReadableStream({
    async start(controller) {
      function send(type: string, payload: object) {
        controller.enqueue(encoder.encode(sse(type, payload)));
      }

      const figmaLogs: FigmaRequestLog[] = [];
      function logFigma(l: FigmaRequestLog) {
        figmaLogs.push(l);
        send("figma-log", {
          reqId: l.reqId, method: l.method, path: l.path,
          status: l.status, durationMs: l.durationMs,
          retryAfterSec: l.retryAfterSec, payloadBytes: l.payloadBytes,
          retried: l.retried,
        });
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

        // ── Stage 0: Snapshot cache (highest priority — zero Figma API calls) ──
        let snapshotId: string | null = incomingSnapshotId ?? null;
        let fromSnapshot = false;
        const textNodes: TextNode[] = [];
        const frameRef = { frame: null as FrameInfo | null };
        let rootBbox = { x: 0, y: 0, width: 800, height: 600 };
        let frameName = "";

        {
          const db0 = supabaseAdmin();
          if (!snapshotId && !forceRefresh) {
            const { data: latestSnap } = await db0
              .from("figma_snapshots")
              .select("id, frame_name, frame_bounds")
              .eq("file_key", fileKey)
              .eq("node_id", nodeId)
              .eq("is_stale", false)
              .order("synced_at", { ascending: false })
              .limit(1)
              .maybeSingle();
            snapshotId = latestSnap?.id ?? null;
            frameName  = latestSnap?.frame_name ?? "";
            rootBbox   = (latestSnap?.frame_bounds as any) ?? rootBbox;
          }

          if (snapshotId) {
            const { data: textRows } = await db0
              .from("snapshot_text")
              .select("node_id, node_name, content, font_family, font_size, font_weight, line_height_px, fill_color, style_id, fill_style_id, bounds")
              .eq("snapshot_id", snapshotId);

            if (textRows && textRows.length > 0) {
              for (const r of textRows) {
                textNodes.push({
                  id:                  r.node_id ?? "",
                  name:                r.node_name ?? "",
                  characters:          r.content  ?? "",
                  fontFamily:          r.font_family ?? "",
                  fontSize:            r.font_size   ?? 0,
                  fontWeight:          r.font_weight ?? 400,
                  lineHeightPx:        r.line_height_px ?? 0,
                  color:               r.fill_color ?? "#000000",
                  absoluteBoundingBox: (r.bounds as any) ?? { x: 0, y: 0, width: 0, height: 0 },
                  styleId:             r.style_id   ?? undefined,
                  fillStyleId:         r.fill_style_id ?? undefined,
                });
              }
              fromSnapshot = true;
              send("step", { text: `Snapshot loaded — ${textNodes.length} nodes. Zero Figma API calls.` });
            }
          }
        }

        // ── Fetch Figma nodes (only when no valid snapshot) ───────────────────
        let figmaNodes = prefetched;
        let styleNameMap: Record<string, string> = prefetchedStyleMap ?? {};

        if (fromSnapshot) {
          // Skip entire Figma fetch block — snapshot has everything we need
        } else {
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

            const nodesPath = `/files/${fileKey}/nodes?ids=${encodeURIComponent(nodeId)}&depth=10`;
            let figmaRes: Response | null = null;
            try {
              figmaRes = await figmaFetch(pat, nodesPath, {
                onWait: (secs) => send("step", { text: `Figma rate limited — waiting ${secs}s then retrying automatically…` }),
                onLog: logFigma,
              });
            } catch (e) {
              if (cached) {
                figmaNodes   = cached.figma_nodes;
                styleNameMap = (cached.style_map as Record<string, string>) ?? {};
                send("step", { text: "Figma rate limited — using cached data." });
              } else {
                send("error", { text: String(e) });
                controller.close();
                return;
              }
            }

            if (figmaRes && figmaRes.status === 429) {
              if (cached) {
                figmaNodes   = cached.figma_nodes;
                styleNameMap = (cached.style_map as Record<string, string>) ?? {};
                send("step", { text: "Figma rate limited — using cached data." });
              } else {
                send("error", { text: "Figma rate limited and no cache available. Please wait a moment and try again." });
                controller.close();
                return;
              }
            } else if (figmaRes && !figmaRes.ok) {
              const txt = await figmaRes.text().catch(() => "");
              let errMsg = `Figma API error ${figmaRes.status}: ${txt.slice(0, 200)}`;
              if (figmaRes.status === 403) {
                try {
                  const parsed = JSON.parse(txt);
                  if (parsed?.err?.toLowerCase().includes("token expired") || parsed?.err?.toLowerCase().includes("expired")) {
                    errMsg = "Figma token expired. Go to Settings → update your Personal Access Token.";
                  } else if (parsed?.err?.toLowerCase().includes("quota") || parsed?.message?.toLowerCase().includes("quota")) {
                    errMsg = "Monthly Figma API quota exhausted. Resets in ~3 days. Upgrade to Figma Professional to remove the cap, or wait for the reset.";
                  } else {
                    errMsg = `Figma access denied (403): ${parsed?.err ?? txt.slice(0, 100)}`;
                  }
                } catch { /* use default */ }
              } else if (figmaRes.status === 429) {
                errMsg = "Figma API quota exhausted. Resets in ~3 days. Upgrade to Figma Professional to remove the monthly cap, or wait for the reset.";
              }
              send("error", { text: errMsg });
              controller.close();
              return;
            } else if (figmaRes) {
            figmaNodes = await figmaRes.json();

            // Resolve named styles
            const rootDocTmp = figmaNodes?.nodes?.[nodeId]?.document;
            const styleIds = extractStyleIdsFromNode(rootDocTmp);
            if (styleIds.length) {
              const stylesRes = await figmaFetch(pat, `/files/${fileKey}/nodes?ids=${styleIds.map(encodeURIComponent).join(",")}`, { onLog: logFigma });
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
        } // end else (not fromSnapshot)

        // ── When NOT from snapshot: extract text nodes from raw Figma JSON ────
        if (!fromSnapshot) {
          const rootDoc = figmaNodes
            ? (figmaNodes as { nodes: Record<string, { document: any }> }).nodes[nodeId]?.document
            : null;

          if (!rootDoc) {
            send("error", { text: "Frame not found — make sure the node-id points to a frame or component." });
            controller.close();
            return;
          }

          extractTextNodes(rootDoc, null, textNodes, frameRef);
          const bbox = rootDoc.absoluteBoundingBox ?? frameRef.frame?.absoluteBoundingBox ?? { x: 0, y: 0, width: 100, height: 100 };
          rootBbox  = bbox;
          frameName = rootDoc.name ?? "Unknown frame";
        }

        const frame: FrameInfo = { id: nodeId, absoluteBoundingBox: rootBbox };

        send("step", { text: `Found frame: "${frameName}" — ${textNodes.length} text nodes.` });

        if (textNodes.length === 0) {
          send("error", { text: `No text found in frame "${frameName}". Make sure you right-clicked the correct frame and used "Copy link to selection".` });
          controller.close();
          return;
        }

        // ── Step 4: Build live context — match Figma nodes to live styles by text ─
        // Declare check flags here so Step 4 matching can use them
        const TYPOGRAPHY_CHECKS = ["font_family", "font_size", "font_weight", "color"] as const;
        const ALL_CHECKS = [...TYPOGRAPHY_CHECKS, "missing_elements", "content"] as const;
        const enabledChecks = (checks ?? TYPOGRAPHY_CHECKS as unknown as string[])
          .filter(c => (ALL_CHECKS as readonly string[]).includes(c));
        const activeChecks = enabledChecks.length > 0 ? enabledChecks : [...TYPOGRAPHY_CHECKS];
        const inclFamily  = activeChecks.includes("font_family");
        const inclSize    = activeChecks.includes("font_size");
        const inclWeight  = activeChecks.includes("font_weight");
        const inclColor   = activeChecks.includes("color");
        const inclContent = activeChecks.includes("content");

        let liveContext = "";
        const rawStyles: any[] = Array.isArray(liveStyles) && liveStyles.length > 0
          ? liveStyles
          : (liveData?.styles ?? []);

        const unmatchedFigma: string[] = [];
        if (rawStyles.length > 0) {
          const matchedLines: string[] = [];

          for (const n of [...textNodes].sort((a, b) => b.fontSize - a.fontSize).slice(0, 80)) {
            const figmaText = n.characters.trim().toLowerCase();

            const isShortNavText = figmaText.length <= 20;
            // Check if this Figma node is in the header zone (top 15% of frame height)
            const nodeY = (n.absoluteBoundingBox?.y ?? 0) - (frame.absoluteBoundingBox?.y ?? 0);
            const frameH = frame.absoluteBoundingBox?.height ?? 1000;
            const isFigmaNavNode = isShortNavText && (nodeY / frameH) < 0.15;

            // 1. Exact match
            let live = rawStyles.find(s => {
              const lt = s.text?.trim().toLowerCase() ?? "";
              if (lt !== figmaText) return false;
              // Nav Figma nodes must match nav live elements only
              if (isFigmaNavNode && s.inNav === false) return false;
              return true;
            });
            // 2. Substring match
            if (!live) live = rawStyles.find(s => {
              const lt = s.text?.trim().toLowerCase() ?? "";
              if (!lt.includes(figmaText) || figmaText.length < 4) return false;
              if (isFigmaNavNode && s.inNav === false) return false;
              if (isShortNavText && (s.text?.trim().length ?? 0) > figmaText.length + 5) return false;
              return true;
            });

            if (live) {
              const parts: string[] = [`"${n.characters.slice(0, 40)}"`];
              if (inclFamily) parts.push(`font: ${n.fontFamily} → ${live.fontFamily}`);
              if (inclSize)   parts.push(`size: ${n.fontSize}px → ${live.fontSize}`);
              if (inclWeight) parts.push(`weight: ${n.fontWeight} → ${live.fontWeight}`);
              if (inclColor)  parts.push(`color: ${n.color} → ${live.color}`);
              matchedLines.push(parts.join(" | "));
            } else {
              unmatchedFigma.push(`"${n.characters.slice(0, 40)}" (no live match — skipped)`);
            }
          }

          liveContext = matchedLines.join("\n");
          if (unmatchedFigma.length > 0) {
            liveContext += `\n\nUNMATCHED FIGMA NODES (skip these):\n${unmatchedFigma.join("\n")}`;
          }
          send("step", { text: `Matched ${matchedLines.length}/${textNodes.length} Figma nodes to live elements. ${unmatchedFigma.length} unmatched (skipped).` });
        } else {
          send("step", { text: "No live style data — install and reload the Loupe extension for accurate results." });
        }

        // ── Content pairs: find Figma text nodes whose copy differs from live ───
        let contentPairs = "";
        if (inclContent && rawStyles.length > 0) {
          const contentLines: string[] = [];
          const missingLines: string[] = [];
          for (const n of textNodes) {
            const figmaText = n.characters.trim();
            if (figmaText.length < 4) continue;
            const figmaWords = figmaText.toLowerCase().split(/\s+/).filter((w: string) => w.length > 2);
            if (figmaWords.length < 1) continue;

            // Score = overlap / figmaWords.length (recall-based: what fraction of Figma's words appear in live text)
            // Require at least 2 matching words OR score >= 0.5 to avoid false positives on 1-word matches
            let bestMatch: any = null;
            let bestScore = 0;
            for (const s of rawStyles) {
              const liveText = s.text?.trim() ?? "";
              if (!liveText || liveText.length < 3) continue;
              const liveWords = liveText.toLowerCase().split(/\s+/);
              const overlap = figmaWords.filter((w: string) => liveWords.includes(w)).length;
              const score = overlap / figmaWords.length;
              const qualifies = overlap >= 2 || (overlap >= 1 && score >= 0.5);
              if (qualifies && score > bestScore) {
                bestScore = score;
                bestMatch = s;
              }
            }

            if (bestMatch) {
              const liveText = bestMatch.text?.trim() ?? "";
              if (figmaText.toLowerCase() !== liveText.toLowerCase()) {
                contentLines.push(`Figma: "${figmaText.slice(0, 100)}" → Live: "${liveText.slice(0, 100)}"`);
              }
            } else if (figmaWords.length >= 3) {
              // No live match found — could be missing or heavily reworded content
              missingLines.push(`"${figmaText.slice(0, 100)}"`);
            }
          }

          if (contentLines.length > 0) {
            contentPairs += `\n\nCONTENT PAIRS TO CHECK (same element, copy may differ):\n${contentLines.join("\n")}`;
          }
        }

        send("step", { text: "Comparing Figma nodes with live styles via AI…" });

        // ── Step 5: AI comparison ─────────────────────────────────────────────
        // Build Figma summary — only include data relevant to enabled checks

        const figmaFonts   = inclFamily ? Array.from(new Set(textNodes.map(n => n.fontFamily).filter(Boolean))) : [];
        const figmaSizes   = inclSize   ? Array.from(new Set(textNodes.map(n => n.fontSize).filter(Boolean))).sort((a, b) => b - a) : [];
        const figmaWeights = inclWeight ? Array.from(new Set(textNodes.map(n => n.fontWeight).filter(Boolean))) : [];
        const figmaColors  = inclColor  ? Array.from(new Set(textNodes.map(n => n.color).filter(Boolean))) : [];

        const seenFontCombos = new Set<string>();
        const nodeDetails: string[] = [];
        for (const n of [...textNodes].sort((a, b) => b.fontSize - a.fontSize)) {
          const key = `${n.fontFamily}|${n.fontSize}|${n.fontWeight}|${n.color}`;
          if (seenFontCombos.has(key)) continue;
          seenFontCombos.add(key);
          const parts: string[] = [`"${n.characters.slice(0, 40)}"`];
          if (inclFamily) parts.push(n.fontFamily);
          if (inclSize)   parts.push(`${n.fontSize}px`);
          if (inclWeight) parts.push(`w:${n.fontWeight}`);
          if (inclColor)  parts.push(n.color);
          nodeDetails.push(parts.join(" "));
          if (nodeDetails.length >= 12) break;
        }

        const summaryLines: string[] = [];
        if (inclFamily) summaryLines.push(`FIGMA FONTS: ${figmaFonts.join(", ")}`);
        if (inclSize)   summaryLines.push(`FIGMA SIZES: ${figmaSizes.slice(0, 10).join(", ")}px`);
        if (inclWeight) summaryLines.push(`FIGMA WEIGHTS: ${figmaWeights.join(", ")}`);
        if (inclColor)  summaryLines.push(`FIGMA COLORS: ${figmaColors.slice(0, 10).join(", ")}`);
        summaryLines.push(`FIGMA TEXT NODES:\n${nodeDetails.join("\n")}`);
        const figmaSummary = summaryLines.join("\n");

        // Build per-property rules for only the enabled checks
        const checkRules: string[] = [];
        if (inclFamily) checkRules.push("- font_family: flag mismatches using EXACT font names from the data");
        if (inclSize)   checkRules.push("- font_size: only flag if difference > 2px");
        if (inclWeight) checkRules.push("- font_weight: flag mismatches");
        if (inclColor)   checkRules.push("- color: flag visually distinct differences only (skip near-identical shades)");
        if (inclContent) checkRules.push("- content: (1) In CONTENT PAIRS section: flag when Figma copy differs from live copy for the same element. Only flag real copy differences, not minor punctuation. (2) In FIGMA TEXT WITH NO LIVE MATCH section: flag each entry as missing content if it looks like real UI copy (headings, labels, CTAs, body text) — skip purely decorative or placeholder text.");

        const checkListStr = activeChecks.join(", ");

        send("step", { text: `Sending to Groq AI — checking: ${activeChecks.map(c => c.replace("_", " ")).join(", ")}…` });

        const groqBody = JSON.stringify({
          model: "llama-3.3-70b-versatile",
          temperature: 0,
          max_tokens: 3000,
          messages: [
            {
              role: "system",
              content: `You are a strict design QA engineer. You are given pre-matched Figma vs live pairs. Each line shows the element text and its Figma vs live property values.

STRICT RULES — follow exactly:
- ONLY report properties listed here: ${checkListStr}
- DO NOT invent or assume values not shown in the data
- NEVER flag a property if the Figma value and live value are identical or visually the same
- ONLY flag differences that are clearly shown in the data you were given
- If you are not certain a value actually differs, DO NOT report it
- Do not flag minor punctuation, capitalisation, or whitespace differences
${checkRules.join("\n")}
- Return at most 15 of the most significant discrepancies
- If there are no real discrepancies, return []

Output format — ONLY a valid JSON array, no text before or after:
[{"element":"<text label>","category":"${activeChecks.join("|")}","issue":"Figma: <value> — Live: <value>","severity":"high|medium|low"}]`,
            },
            {
              role: "user",
              content: `MATCHED FIGMA → LIVE PAIRS (${liveUrl}):\n${liveContext}${contentPairs}\n\nFind discrepancies for: ${checkListStr}.`,
            },
          ],
        });

        // Retry up to 3 times on 429 rate limit
        let aiRes: Response | null = null;
        for (let attempt = 0; attempt < 3; attempt++) {
          if (attempt > 0) {
            send("step", { text: `AI rate limited — retrying in ${attempt * 3}s…` });
            await new Promise(r => setTimeout(r, attempt * 3000));
          }
          aiRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            signal: AbortSignal.timeout(55_000),
            headers: {
              Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
              "Content-Type": "application/json",
            },
            body: groqBody,
          });
          if (aiRes.status !== 429) break;
        }

        if (!aiRes || !aiRes.ok) {
          const errTxt = await aiRes?.text().catch(() => "") ?? "";
          send("error", { text: `AI comparison failed: ${aiRes?.status} — ${errTxt.slice(0, 200)}` });
          controller.close();
          return;
        }

        send("step", { text: "AI responded — parsing results…" });

        const aiData = await aiRes.json() as { choices: Array<{ message: { content: string } }> };
        const rawContent = aiData.choices[0]?.message?.content?.trim() ?? "[]";

        let discrepancies: Array<{ element: string; label?: string; category?: string; issue: string; severity: string }> = [];
        try {
          // Try full parse first
          const jsonMatch = rawContent.match(/\[[\s\S]*\]/);
          if (jsonMatch) {
            discrepancies = JSON.parse(jsonMatch[0]);
          } else {
            // Response was truncated — recover completed objects from the partial JSON
            const partial = rawContent.includes("[") ? rawContent.slice(rawContent.indexOf("[")) : rawContent;
            const objectMatches = partial.match(/\{[^{}]*"element"[^{}]*"issue"[^{}]*\}/g) ?? [];
            for (const obj of objectMatches) {
              try { discrepancies.push(JSON.parse(obj)); } catch {}
            }
            if (discrepancies.length === 0) {
              send("error", { text: `AI response was too long to parse. Try narrowing your checks (e.g. font only, not color).` });
              controller.close();
              return;
            }
            send("step", { text: `Response was truncated — recovered ${discrepancies.length} discrepancies from partial output.` });
          }
        } catch {
          // JSON.parse failed on the full match — try object-by-object recovery
          const objectMatches = rawContent.match(/\{[^{}]*"element"[^{}]*"issue"[^{}]*\}/g) ?? [];
          for (const obj of objectMatches) {
            try { discrepancies.push(JSON.parse(obj)); } catch {}
          }
          if (discrepancies.length === 0) {
            send("error", { text: `Could not parse AI response. Try running again.` });
            controller.close();
            return;
          }
          send("step", { text: `Recovered ${discrepancies.length} discrepancies from partial AI response.` });
        }

        // Remove false positives, off-category results, and duplicates
        const seenIssues = new Set<string>();
        discrepancies = discrepancies.filter(d => {
          // Strip anything not in the user's enabled checks (safety net for model drift)
          if (d.category && !activeChecks.includes(d.category)) return false;
          const parts = d.issue.match(/Figma:\s*(.+?)\s*—\s*Live:\s*(.+)/);
          if (parts) {
            // Normalize: strip trailing notes like "(visually distinct)", take first token
            const normalize = (v: string) => v.trim().split(/\s+/)[0].toLowerCase().replace(/['"]/g, "");
            if (normalize(parts[1]) === normalize(parts[2])) return false;
          }
          if (seenIssues.has(d.issue)) return false;
          seenIssues.add(d.issue);
          return true;
        });

        send("step", { text: `AI identified ${discrepancies.length} discrepancies.` });

        // Prepend missing elements (no AI needed — direct from unmatched nodes)
        if (activeChecks.includes("missing_elements") && unmatchedFigma.length > 0) {
          const missingItems = unmatchedFigma.map(label => ({
            element: label.replace(/" \(no live match.*$/, "").replace(/^"/, ""),
            category: "missing_elements",
            issue: "Missing on live page",
            severity: "high",
          }));
          discrepancies = [...missingItems, ...discrepancies];
        }

        // ── Step 6: Save issues to internal database (zero Figma API calls) ────
        const table: Array<{ element: string; issue: string; category?: string; severity?: string; commentId?: string }> = [];

        if (discrepancies.length === 0) {
          send("result", {
            text: "No discrepancies found. This can happen if:\n• The live URL doesn't match the Figma frame (e.g. wrong page)\n• The Loupe extension hasn't captured styles from the live site yet (visit the page first, then run again)\n• The design and live site genuinely match",
            table: [],
            snapshotId: snapshotId ?? null,
          });
          controller.close();
          return;
        }

        // Persist issues to qa_issues — scanning never touches Figma comments
        if (snapshotId) {
          const issueRows = discrepancies.map(d => ({
            snapshot_id: snapshotId,
            file_key:    fileKey,
            node_id:     nodeId,
            element:     d.element,
            category:    d.category ?? null,
            issue:       d.issue,
            severity:    d.severity ?? "medium",
            live_url:    liveUrl,
            scanned_at:  new Date().toISOString(),
          }));
          const { error: issueInsertErr } = await supabaseAdmin().from("qa_issues").insert(issueRows);
          if (issueInsertErr) console.error("[figma-compare] qa_issues insert error:", issueInsertErr.message);
        }

        for (const d of discrepancies) {
          table.push({ element: d.element, issue: d.issue, category: d.category, severity: d.severity });
        }

        const byCategory = discrepancies.reduce((acc, d) => {
          const cat = d.category ?? "other";
          acc[cat] = (acc[cat] ?? 0) + 1;
          return acc;
        }, {} as Record<string, number>);
        const summary = Object.entries(byCategory)
          .map(([cat, count]) => `${count} ${cat.replace("_", " ")}`)
          .join(", ");

        send("result", {
          text: `Found ${discrepancies.length} issues: ${summary}. Use "Publish to Figma" to post comments when ready.`,
          table,
          snapshotId: snapshotId ?? null,
          figmaApiReport: {
            totalCalls: figmaLogs.length,
            calls: figmaLogs.map(l => ({
              method: l.method,
              path:   l.path,
              status: l.status,
              ms:     l.durationMs,
              kb:     l.payloadBytes !== null ? Math.round(l.payloadBytes / 1024) : null,
              retried: l.retried,
            })),
          },
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
