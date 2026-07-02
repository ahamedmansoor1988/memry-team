import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { FIGMA_VISIBILITY_SNAPSHOT_CUTOFF, isRenderableFigmaNode, normalizeNodes } from "@/lib/figma-normalize";

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

const RUN_MARKER_CATEGORY = "__run";
const AI_PROVIDERS = new Set(["groq", "openai"]);

interface PersistableIssue {
  element: string;
  category?: string | null;
  issue: string;
  severity?: string | null;
}

interface AiSettings {
  enabled?: boolean;
  provider?: string;
  model?: string;
  apiKey?: string;
}

function resolveAiConfig(ai: AiSettings | undefined) {
  const enabled = ai?.enabled === true;
  const provider = AI_PROVIDERS.has(ai?.provider ?? "") ? ai!.provider! : "groq";
  const keyFromSettings = ai?.apiKey?.trim() ?? "";
  const keyFromEnv = provider === "openai" ? process.env.OPENAI_API_KEY : process.env.GROQ_API_KEY;
  const apiKey = keyFromSettings || keyFromEnv || "";
  const defaultModel = provider === "openai" ? "gpt-4o-mini" : "llama-3.3-70b-versatile";
  const model = ai?.model?.trim() || defaultModel;
  const endpoint = provider === "openai"
    ? "https://api.openai.com/v1/chat/completions"
    : "https://api.groq.com/openai/v1/chat/completions";
  return { enabled, provider, apiKey, model, endpoint };
}

async function persistScanRun(params: {
  snapshotId: string | null;
  fileKey: string;
  nodeId: string;
  liveUrl: string;
  scannedAt: string;
  summary: string;
  issues: PersistableIssue[];
}) {
  const { snapshotId, fileKey, nodeId, liveUrl, scannedAt, summary, issues } = params;
  if (!snapshotId) {
    console.warn("[figma-compare] scan history skipped: missing snapshotId");
    return;
  }

  try {
    const rows = [
      {
        snapshot_id: snapshotId,
        file_key:    fileKey,
        node_id:     nodeId,
        element:     "Scan completed",
        category:    RUN_MARKER_CATEGORY,
        issue:       summary.slice(0, 500),
        severity:    "info",
        live_url:    liveUrl,
        scanned_at:  scannedAt,
      },
      ...issues.map(d => ({
        snapshot_id: snapshotId,
        file_key:    fileKey,
        node_id:     nodeId,
        element:     d.element,
        category:    d.category ?? null,
        issue:       d.issue,
        severity:    d.severity ?? "medium",
        live_url:    liveUrl,
        scanned_at:  scannedAt,
      })),
    ];
    const { error } = await supabaseAdmin().from("qa_issues").insert(rows);
    if (error) console.error("[figma-compare] scan history insert error:", error.message);
  } catch (err) {
    console.error("[figma-compare] scan history insert exception:", err);
  }
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
  if (!isRenderableFigmaNode(node)) return [];
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

function normalizeCopyForCompare(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const COPY_STOP_WORDS = new Set([
  "the", "and", "for", "with", "from", "that", "this", "your", "you", "our",
  "are", "was", "were", "has", "have", "had", "not", "but", "how", "all",
  "its", "into", "through", "using", "hiver",
]);

function meaningfulWords(text: string): string[] {
  return normalizeCopyForCompare(text)
    .split(/\s+/)
    .filter(word => word.length > 2 && !COPY_STOP_WORDS.has(word));
}

function contentIssue(element: string, liveText: string | null) {
  const figmaLabel = element.slice(0, 100);
  const liveLabel = liveText?.slice(0, 100) ?? null;
  return {
    element: figmaLabel,
    category: "content",
    issue: liveLabel
      ? `Content mismatch: Figma says "${figmaLabel}", live says "${liveLabel}"`
      : "Missing content on live page",
    severity: "high",
  };
}

function isLikelyUiCopy(text: string): boolean {
  const normalized = normalizeCopyForCompare(text);
  if (normalized.length < 8) return false;
  if (/^\d+$/.test(normalized)) return false;
  if (/^@(?:keyframes|media|supports|fontface)\b/.test(normalized)) return false;
  if (/[{};]/.test(text) && /\b(?:opacity|transform|animation|display|position|width|height)\s*:/.test(text)) return false;
  return true;
}

interface NormalizedBounds {
  centerX: number;
  centerY: number;
  width: number;
  height: number;
}

interface PhysicalBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
  pageWidth?: number;
}

type CopyShape = "numeric" | "label" | "phrase" | "sentence";

interface ContentCandidate<T = any> {
  item: T;
  text: string;
  key: string;
  shape: CopyShape;
  bounds: NormalizedBounds;
  shapeOrder: number;
  globalOrder: number;
  shapeCount: number;
  globalCount: number;
}

interface LayoutPair {
  figma: TextNode;
  live: any;
  liveIndex: number;
  figmaText: string;
  liveText: string;
  figmaBounds: PhysicalBounds;
  liveBounds: PhysicalBounds;
  matchDistance: number;
  reliableForSpacing: boolean;
}

function normalizedFigmaBounds(node: TextNode, frame: FrameInfo): NormalizedBounds | null {
  const box = node.absoluteBoundingBox;
  const frameBox = frame.absoluteBoundingBox;
  if (!box || !frameBox?.width || !frameBox?.height) return null;
  return {
    centerX: ((box.x - frameBox.x) + box.width / 2) / frameBox.width,
    centerY: ((box.y - frameBox.y) + box.height / 2) / frameBox.height,
    width: box.width / frameBox.width,
    height: box.height / frameBox.height,
  };
}

function physicalFigmaBounds(node: TextNode, frame: FrameInfo): PhysicalBounds | null {
  const box = node.absoluteBoundingBox;
  const frameBox = frame.absoluteBoundingBox;
  if (!box || !frameBox) return null;
  const left = box.x - frameBox.x;
  const top = box.y - frameBox.y;
  return {
    left,
    top,
    right: left + box.width,
    bottom: top + box.height,
    width: box.width,
    height: box.height,
  };
}

function physicalLiveBounds(style: any): PhysicalBounds | null {
  const b = style?.bounds;
  if (
    typeof b?.x !== "number" ||
    typeof b?.y !== "number" ||
    typeof b?.width !== "number" ||
    typeof b?.height !== "number"
  ) return null;
  return {
    left: b.x,
    top: b.y,
    right: b.x + b.width,
    bottom: b.y + b.height,
    width: b.width,
    height: b.height,
    pageWidth: typeof b.pageWidth === "number" ? b.pageWidth : undefined,
  };
}

function normalizedLiveBounds(style: any): NormalizedBounds | null {
  const n = style?.bounds?.normalized;
  if (typeof n?.centerX === "number" && typeof n?.centerY === "number") {
    return {
      centerX: n.centerX,
      centerY: n.centerY,
      width: typeof n.width === "number" ? n.width : 0,
      height: typeof n.height === "number" ? n.height : 0,
    };
  }
  return null;
}

function geometryDistance(a: NormalizedBounds, b: NormalizedBounds): number {
  const dx = Math.abs(a.centerX - b.centerX);
  const dy = Math.abs(a.centerY - b.centerY);
  return Math.sqrt(dx * dx + dy * dy);
}

function textOverlapStats(figmaText: string, liveText: string) {
  const figmaWords = meaningfulWords(figmaText);
  const liveWords = new Set(meaningfulWords(liveText));
  const overlap = figmaWords.filter(word => liveWords.has(word)).length;
  return {
    figmaWords,
    overlap,
    score: figmaWords.length === 0 ? 0 : overlap / figmaWords.length,
  };
}

function bidirectionalTextOverlap(figmaText: string, liveText: string) {
  const figmaWords = meaningfulWords(figmaText);
  const liveWords = meaningfulWords(liveText);
  const figmaSet = new Set(figmaWords);
  const liveSet = new Set(liveWords);
  const overlap = figmaWords.filter(word => liveSet.has(word)).length;
  const reverseOverlap = liveWords.filter(word => figmaSet.has(word)).length;
  return {
    overlap,
    figmaScore: figmaWords.length === 0 ? 0 : overlap / figmaWords.length,
    liveScore: liveWords.length === 0 ? 0 : reverseOverlap / liveWords.length,
  };
}

function copyShape(text: string): CopyShape {
  const normalized = normalizeCopyForCompare(text);
  if (/^[\d\s]+$/.test(normalized)) return "numeric";
  const words = meaningfulWords(text);
  if (words.length <= 2) return "label";
  if (words.length <= 5) return "phrase";
  return "sentence";
}

function isCompatibleContentPair(figmaText: string, liveText: string): boolean {
  const { overlap, score } = textOverlapStats(figmaText, liveText);
  if (overlap > 0 || score > 0) return true;
  const figmaShape = copyShape(figmaText);
  const liveShape = copyShape(liveText);
  if (figmaShape === liveShape) return true;
  if ((figmaShape === "label" && liveShape === "phrase") || (figmaShape === "phrase" && liveShape === "label")) return true;
  return false;
}

function readingOrderDistance(a: ContentCandidate, b: ContentCandidate): number {
  const aShapeOrder = a.shapeCount > 1 ? a.shapeOrder / (a.shapeCount - 1) : 0;
  const bShapeOrder = b.shapeCount > 1 ? b.shapeOrder / (b.shapeCount - 1) : 0;
  const aGlobalOrder = a.globalCount > 1 ? a.globalOrder / (a.globalCount - 1) : 0;
  const bGlobalOrder = b.globalCount > 1 ? b.globalOrder / (b.globalCount - 1) : 0;
  return Math.min(Math.abs(aShapeOrder - bShapeOrder), Math.abs(aGlobalOrder - bGlobalOrder));
}

function lengthRatio(a: string, b: string): number {
  const aLen = normalizeCopyForCompare(a).length;
  const bLen = normalizeCopyForCompare(b).length;
  if (aLen === 0 || bLen === 0) return 0;
  return Math.min(aLen, bLen) / Math.max(aLen, bLen);
}

function shortLabel(text: string, max = 56): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  return cleaned.length > max ? `${cleaned.slice(0, max - 1)}…` : cleaned;
}

function assignContentOrders<T>(items: Array<Omit<ContentCandidate<T>, "shapeOrder" | "globalOrder" | "shapeCount" | "globalCount">>): Array<ContentCandidate<T>> {
  const sorted = [...items].sort((a, b) => {
    if (Math.abs(a.bounds.centerY - b.bounds.centerY) > 0.01) return a.bounds.centerY - b.bounds.centerY;
    return a.bounds.centerX - b.bounds.centerX;
  });
  const shapeCounts = new Map<CopyShape, number>();
  sorted.forEach(item => shapeCounts.set(item.shape, (shapeCounts.get(item.shape) ?? 0) + 1));

  const shapeSeen = new Map<CopyShape, number>();
  return sorted.map((item, globalOrder) => {
    const shapeOrder = shapeSeen.get(item.shape) ?? 0;
    shapeSeen.set(item.shape, shapeOrder + 1);
    return {
      ...item,
      globalOrder,
      globalCount: sorted.length,
      shapeOrder,
      shapeCount: shapeCounts.get(item.shape) ?? 1,
    };
  });
}

function contentMatchScore(figma: ContentCandidate<TextNode>, live: ContentCandidate): number | null {
  if (!isCompatibleContentPair(figma.text, live.text)) return null;
  const { overlap, score: overlapScore } = textOverlapStats(figma.text, live.text);
  const sameShape = figma.shape === live.shape;
  const orderDistance = readingOrderDistance(figma, live);
  const geoDistance = geometryDistance(figma.bounds, live.bounds);
  const ratio = lengthRatio(figma.text, live.text);

  // No shared meaningful words means we cannot prove these are the same content
  // slot from text/position alone. Treat it as unmatched instead of inventing a
  // rewrite such as footer copy -> nearby nav link.
  if (overlap === 0) return null;

  // Prevent sentence/paragraph copy from matching logos, terse labels, or far-away text.
  if (figma.shape === "sentence" && live.shape !== "sentence") return null;
  if (overlapScore < 0.5 && (geoDistance > 0.06 || orderDistance > 0.08)) return null;
  if (geoDistance > 0.1 && overlapScore < 0.75) return null;

  const shapeScore = sameShape ? 1 : 0.55;
  const geometryScore = Math.max(0, 1 - geoDistance / 0.22);
  const orderScore = Math.max(0, 1 - orderDistance / 0.18);
  const lengthScore = ratio;
  const textScore = Math.min(1, overlapScore + (overlap > 0 ? 0.25 : 0));

  return (
    shapeScore * 0.25 +
    geometryScore * 0.2 +
    orderScore * 0.35 +
    lengthScore * 0.1 +
    textScore * 0.1
  );
}

function isStrictTextFallbackMatch(figmaText: string, liveText: string): boolean {
  const figmaKey = normalizeCopyForCompare(figmaText);
  const liveKey = normalizeCopyForCompare(liveText);
  if (!figmaKey || !liveKey || figmaKey === liveKey) return false;
  if (figmaKey.length >= 12 && (figmaKey.includes(liveKey) || liveKey.includes(figmaKey))) return true;
  const { figmaWords, overlap, score } = textOverlapStats(figmaText, liveText);
  if (figmaWords.length <= 2) return overlap === figmaWords.length && score === 1;
  if (figmaWords.length <= 4) return overlap === figmaWords.length;
  return overlap >= 4 && score >= 0.85;
}

function isContainmentTextMatch(figmaText: string, liveText: string): boolean {
  const figmaKey = normalizeCopyForCompare(figmaText);
  const liveKey = normalizeCopyForCompare(liveText);
  if (!figmaKey || !liveKey || figmaKey === liveKey) return false;
  return figmaKey.length >= 8 && liveKey.length >= 8 && (figmaKey.includes(liveKey) || liveKey.includes(figmaKey));
}

function shouldReportContentMismatch(figma: ContentCandidate<TextNode>, live: any): boolean {
  const figmaText = figma.text;
  const liveText = live?.text?.trim() ?? "";
  const figmaKey = normalizeCopyForCompare(figmaText);
  const liveKey = normalizeCopyForCompare(liveText);
  if (!figmaKey || !liveKey || figmaKey === liveKey) return false;
  if (isContainmentTextMatch(figmaText, liveText)) return false;

  const liveBounds = normalizedLiveBounds(live);
  if (!liveBounds) return false;

  const overlap = bidirectionalTextOverlap(figmaText, liveText);
  const geoDistance = geometryDistance(figma.bounds, liveBounds);
  const ratio = lengthRatio(figmaText, liveText);
  const liveShape = copyShape(liveText);
  const sameShape = figma.shape === liveShape;

  if (Math.max(overlap.figmaScore, overlap.liveScore) >= 0.55) return true;
  if (sameShape && geoDistance <= 0.025 && ratio >= 0.45) return true;
  if (sameShape && geoDistance <= 0.04 && ratio >= 0.5 && Math.max(overlap.figmaScore, overlap.liveScore) >= 0.4) return true;
  return false;
}

function bestLiveMatchByGeometry(figmaNode: TextNode, frame: FrameInfo, candidates: any[]): any | null {
  if (candidates.length === 0) return null;
  const figmaBounds = normalizedFigmaBounds(figmaNode, frame);
  if (!figmaBounds) return candidates[0];
  return [...candidates].sort((a, b) => {
    const aBounds = normalizedLiveBounds(a);
    const bBounds = normalizedLiveBounds(b);
    if (!aBounds && !bBounds) return 0;
    if (!aBounds) return 1;
    if (!bBounds) return -1;
    return geometryDistance(figmaBounds, aBounds) - geometryDistance(figmaBounds, bBounds);
  })[0];
}

function findLiveMatchForFigmaNode(figmaNode: TextNode, frame: FrameInfo, rawStyles: any[], allowSubstring: boolean) {
  const figmaTextRaw = figmaNode.characters.trim();
  const figmaText = figmaTextRaw.toLowerCase();
  const figmaKey = normalizeCopyForCompare(figmaTextRaw);
  const isShortNavText = figmaText.length <= 20;
  const nodeY = (figmaNode.absoluteBoundingBox?.y ?? 0) - (frame.absoluteBoundingBox?.y ?? 0);
  const frameH = frame.absoluteBoundingBox?.height ?? 1000;
  const isFigmaNavNode = isShortNavText && (nodeY / frameH) < 0.15;

  const exactCandidates = rawStyles.filter(s => {
    const liveTextRaw = s.text?.trim() ?? "";
    const liveText = liveTextRaw.toLowerCase();
    const liveKey = normalizeCopyForCompare(liveTextRaw);
    if (liveText !== figmaText && liveKey !== figmaKey) return false;
    if (isFigmaNavNode && s.inNav === false) return false;
    return true;
  });
  if (exactCandidates.length > 0) return bestLiveMatchByGeometry(figmaNode, frame, exactCandidates);

  if (!allowSubstring) return null;

  const substringCandidates = rawStyles.filter(s => {
    const liveTextRaw = s.text?.trim() ?? "";
    const liveText = liveTextRaw.toLowerCase();
    const liveKey = normalizeCopyForCompare(liveTextRaw);
    const hasRawContainment = liveText.includes(figmaText);
    const hasNormalizedContainment =
      figmaKey.length >= 4 &&
      (
        liveKey.includes(figmaKey) ||
        (liveKey.length >= 12 && figmaKey.includes(liveKey))
      );
    if ((!hasRawContainment && !hasNormalizedContainment) || figmaText.length < 4) return false;
    if (isFigmaNavNode && s.inNav === false) return false;
    if (isShortNavText && (s.text?.trim().length ?? 0) > figmaText.length + 5) return false;
    return true;
  });
  return bestLiveMatchByGeometry(figmaNode, frame, substringCandidates);
}

function overlapRatio(startA: number, endA: number, startB: number, endB: number): number {
  const overlap = Math.max(0, Math.min(endA, endB) - Math.max(startA, startB));
  const smallest = Math.min(endA - startA, endB - startB);
  return smallest > 0 ? overlap / smallest : 0;
}

function sameColumn(a: PhysicalBounds, b: PhysicalBounds): boolean {
  const overlap = overlapRatio(a.left, a.right, b.left, b.right);
  const centerDistance = Math.abs((a.left + a.right) / 2 - (b.left + b.right) / 2);
  return overlap >= 0.25 || centerDistance <= Math.max(a.width, b.width) * 0.35;
}

function sameRow(a: PhysicalBounds, b: PhysicalBounds): boolean {
  const overlap = overlapRatio(a.top, a.bottom, b.top, b.bottom);
  const centerDistance = Math.abs((a.top + a.bottom) / 2 - (b.top + b.bottom) / 2);
  return overlap >= 0.35 || centerDistance <= Math.max(a.height, b.height) * 0.5;
}

function isSignificantSpacingDiff(figmaGap: number, liveGap: number): boolean {
  const diff = Math.abs(figmaGap - liveGap);
  if (diff < 8) return false;
  return diff / Math.max(12, figmaGap) >= 0.25;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function estimateSpacingScale(layoutPairs: LayoutPair[], frame: FrameInfo): number {
  const textWidthRatios = layoutPairs
    .filter(pair => pair.reliableForSpacing && pair.figmaBounds.width >= 20 && pair.liveBounds.width >= 20)
    .map(pair => pair.liveBounds.width / pair.figmaBounds.width)
    .filter(ratio => ratio >= 0.45 && ratio <= 1.8);
  const textScale = median(textWidthRatios);
  if (textScale !== null) return textScale;

  const pageWidth = layoutPairs.find(pair => typeof pair.liveBounds.pageWidth === "number")?.liveBounds.pageWidth;
  const frameWidth = frame.absoluteBoundingBox?.width;
  if (pageWidth && frameWidth) return Math.min(1.8, Math.max(0.45, pageWidth / frameWidth));
  return 1;
}

function buildSpacingIssues(layoutPairs: LayoutPair[], frame: FrameInfo) {
  const pairs = layoutPairs
    .filter(pair => pair.reliableForSpacing)
    .sort((a, b) => {
      if (Math.abs(a.figmaBounds.top - b.figmaBounds.top) > 2) return a.figmaBounds.top - b.figmaBounds.top;
      return a.figmaBounds.left - b.figmaBounds.left;
    });
  const issues: Array<{ element: string; category: string; issue: string; severity: string; diff: number }> = [];
  const seen = new Set<string>();
  const scale = estimateSpacingScale(pairs, frame);

  function pushIssue(axis: "vertical" | "horizontal", current: LayoutPair, next: LayoutPair, figmaGap: number, liveGap: number) {
    const scaledFigmaGap = figmaGap * scale;
    if (!isSignificantSpacingDiff(scaledFigmaGap, liveGap)) return;
    const key = `${axis}|${current.figma.id}|${next.figma.id}`;
    if (seen.has(key)) return;
    seen.add(key);
    issues.push({
      element: `${shortLabel(current.figmaText, 36)} → ${shortLabel(next.figmaText, 36)}`,
      category: "spacing",
      issue: `Spacing mismatch between adjacent items. Figma: ${axis} gap ${Math.round(figmaGap)}px${Math.abs(scale - 1) > 0.05 ? ` (scaled ${Math.round(scaledFigmaGap)}px)` : ""} — Live: ${axis} gap ${Math.round(liveGap)}px`,
      severity: "medium",
      diff: Math.abs(scaledFigmaGap - liveGap),
    });
  }

  for (const current of pairs) {
    const below = pairs
      .filter(next =>
        next !== current &&
        next.figmaBounds.top >= current.figmaBounds.bottom &&
        sameColumn(current.figmaBounds, next.figmaBounds)
      )
      .sort((a, b) =>
        (a.figmaBounds.top - current.figmaBounds.bottom) -
        (b.figmaBounds.top - current.figmaBounds.bottom)
      )[0];

    const liveBelow = pairs
      .filter(next =>
        next !== current &&
        next.liveBounds.top >= current.liveBounds.bottom &&
        sameColumn(current.liveBounds, next.liveBounds)
      )
      .sort((a, b) =>
        (a.liveBounds.top - current.liveBounds.bottom) -
        (b.liveBounds.top - current.liveBounds.bottom)
      )[0];

    if (below && liveBelow?.figma.id === below.figma.id) {
      const figmaGap = below.figmaBounds.top - current.figmaBounds.bottom;
      const liveGap = below.liveBounds.top - current.liveBounds.bottom;
      if (figmaGap >= 0 && liveGap >= 0 && Math.max(figmaGap * scale, liveGap) <= 220) {
        pushIssue("vertical", current, below, figmaGap, liveGap);
      }
    }

    const right = pairs
      .filter(next =>
        next !== current &&
        next.figmaBounds.left >= current.figmaBounds.right &&
        sameRow(current.figmaBounds, next.figmaBounds)
      )
      .sort((a, b) =>
        (a.figmaBounds.left - current.figmaBounds.right) -
        (b.figmaBounds.left - current.figmaBounds.right)
      )[0];

    const liveRight = pairs
      .filter(next =>
        next !== current &&
        next.liveBounds.left >= current.liveBounds.right &&
        sameRow(current.liveBounds, next.liveBounds)
      )
      .sort((a, b) =>
        (a.liveBounds.left - current.liveBounds.right) -
        (b.liveBounds.left - current.liveBounds.right)
      )[0];

    if (right && liveRight?.figma.id === right.figma.id) {
      const figmaGap = right.figmaBounds.left - current.figmaBounds.right;
      const liveGap = right.liveBounds.left - current.liveBounds.right;
      if (figmaGap >= 0 && liveGap >= 0 && Math.max(figmaGap * scale, liveGap) <= 180) {
        pushIssue("horizontal", current, right, figmaGap, liveGap);
      }
    }
  }

  return issues
    .sort((a, b) => b.diff - a.diff)
    .slice(0, 20)
    .map(issue => ({
      element: issue.element,
      category: issue.category,
      issue: issue.issue,
      severity: issue.severity,
    }));
}

function parsePx(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const match = String(value ?? "").match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function normalizeFontName(value: unknown): string {
  return String(value ?? "")
    .split(",")[0]
    .replace(/['"]/g, "")
    .trim()
    .toLowerCase();
}

function normalizeWeight(value: unknown): string {
  const raw = String(value ?? "").trim().toLowerCase();
  const named: Record<string, string> = {
    normal: "400",
    regular: "400",
    medium: "500",
    semibold: "600",
    "semi bold": "600",
    bold: "700",
  };
  return named[raw] ?? raw;
}

function normalizeHex(value: unknown): string {
  return String(value ?? "").trim().toUpperCase();
}

function buildTypographyIssues(
  layoutPairs: LayoutPair[],
  allFigmaTextNodes: TextNode[],
  checks: {
    family: boolean;
    size: boolean;
    weight: boolean;
    color: boolean;
  },
) {
  const issues: Array<{ element: string; category: string; issue: string; severity: string }> = [];
  const seen = new Set<string>();
  const pairs = layoutPairs.filter(pair => normalizeCopyForCompare(pair.figmaText) === normalizeCopyForCompare(pair.liveText));
  const figmaVariants = new Map<string, {
    families: Set<string>;
    sizes: Set<string>;
    weights: Set<string>;
    colors: Set<string>;
  }>();
  for (const node of allFigmaTextNodes) {
    const key = normalizeCopyForCompare(node.characters);
    if (!key) continue;
    const variants = figmaVariants.get(key) ?? {
      families: new Set<string>(),
      sizes: new Set<string>(),
      weights: new Set<string>(),
      colors: new Set<string>(),
    };
    variants.families.add(normalizeFontName(node.fontFamily));
    variants.sizes.add(String(parsePx(node.fontSize) ?? ""));
    variants.weights.add(normalizeWeight(node.fontWeight));
    variants.colors.add(normalizeHex(node.color));
    figmaVariants.set(key, variants);
  }

  const hasConflictingFigmaValue = (pair: LayoutPair, category: "families" | "sizes" | "weights" | "colors") => {
    const key = normalizeCopyForCompare(pair.figmaText);
    const values = figmaVariants.get(key)?.[category];
    return values ? Array.from(values).filter(Boolean).length > 1 : false;
  };

  function push(pair: LayoutPair, category: string, figmaValue: string, liveValue: string, severity = "medium") {
    const key = `${category}|${pair.figma.id}|${pair.liveIndex}|${figmaValue}|${liveValue}`;
    if (seen.has(key)) return;
    seen.add(key);
    issues.push({
      element: shortLabel(pair.figmaText, 80),
      category,
      issue: `Figma: ${figmaValue} — Live: ${liveValue}`,
      severity,
    });
  }

  for (const pair of pairs) {
    if (checks.family && !hasConflictingFigmaValue(pair, "families")) {
      const figmaFont = String(pair.figma.fontFamily ?? "").trim();
      const liveFont = String(pair.live.fontFamily ?? "").trim();
      if (normalizeFontName(figmaFont) && normalizeFontName(liveFont) && normalizeFontName(figmaFont) !== normalizeFontName(liveFont)) {
        push(pair, "font_family", figmaFont, liveFont);
      }
    }

    if (checks.size && !hasConflictingFigmaValue(pair, "sizes")) {
      const figmaSize = parsePx(pair.figma.fontSize);
      const liveSize = parsePx(pair.live.fontSize);
      if (figmaSize !== null && liveSize !== null && Math.abs(figmaSize - liveSize) > 2) {
        push(pair, "font_size", `${Math.round(figmaSize * 10) / 10}px`, `${Math.round(liveSize * 10) / 10}px`);
      }
    }

    if (checks.weight && !hasConflictingFigmaValue(pair, "weights")) {
      const figmaWeight = String(pair.figma.fontWeight ?? "").trim();
      const liveWeight = String(pair.live.fontWeight ?? "").trim();
      if (normalizeWeight(figmaWeight) && normalizeWeight(liveWeight) && normalizeWeight(figmaWeight) !== normalizeWeight(liveWeight)) {
        push(pair, "font_weight", figmaWeight, liveWeight);
      }
    }

    if (checks.color && !hasConflictingFigmaValue(pair, "colors")) {
      const figmaColor = normalizeHex(pair.figma.color);
      const liveColor = normalizeHex(pair.live.color);
      if (figmaColor && liveColor && figmaColor !== liveColor) {
        push(pair, "color", figmaColor, liveColor, "low");
      }
    }
  }

  return issues.slice(0, 30);
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
    if (!isRenderableFigmaNode(node)) return;
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
  if (!isRenderableFigmaNode(node)) return;

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
    skipNamePrefixes, skipAncestorNames, ai,
  } = await req.json() as {
    figmaNodes: any; styleNameMap: Record<string, string>; fileKey: string; nodeId: string;
    liveUrl: string; liveStyles: any[] | null; liveData?: any | null; pat: string;
    checks?: string[]; assignTo?: string | null; forceRefresh?: boolean;
    snapshotId?: string | null;
    skipNamePrefixes?: string[]; skipAncestorNames?: string[];
    ai?: AiSettings;
  };
  const aiConfig = resolveAiConfig(ai);

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
        let visibilityStatsForLog: any = null;

        {
          const db0 = supabaseAdmin();
          if (!snapshotId && !forceRefresh) {
            const { data: latestSnap } = await db0
              .from("figma_snapshots")
              .select("id, frame_name, frame_bounds")
              .eq("file_key", fileKey)
              .eq("node_id", nodeId)
              .eq("is_stale", false)
              .gte("synced_at", FIGMA_VISIBILITY_SNAPSHOT_CUTOFF)
              .order("synced_at", { ascending: false })
              .limit(1)
              .maybeSingle();
            snapshotId = latestSnap?.id ?? null;
            frameName  = latestSnap?.frame_name ?? "";
            rootBbox   = (latestSnap?.frame_bounds as any) ?? rootBbox;
          }

          if (snapshotId) {
            const { data: snapMeta } = await db0
              .from("figma_snapshots")
              .select("id, frame_name, frame_bounds, synced_at")
              .eq("id", snapshotId)
              .maybeSingle();

            const snapshotSyncedAt = snapMeta?.synced_at ? new Date(snapMeta.synced_at).getTime() : 0;
            const visibilityCutoff = new Date(FIGMA_VISIBILITY_SNAPSHOT_CUTOFF).getTime();
            if (!snapMeta || snapshotSyncedAt < visibilityCutoff) {
              send("step", { text: "Cached snapshot is older than the hidden-layer filter — syncing Figma again." });
              snapshotId = null;
            } else {
              frameName = snapMeta.frame_name ?? frameName;
              rootBbox = (snapMeta.frame_bounds as any) ?? rootBbox;
            }
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

          const normalized = normalizeNodes(rootDoc, { skipNamePrefixes, skipAncestorNames });
          for (const r of normalized.text_nodes) {
            textNodes.push({
              id:                  r.node_id,
              name:                r.node_name,
              characters:          r.content,
              fontFamily:          r.font_family,
              fontSize:            r.font_size,
              fontWeight:          r.font_weight,
              lineHeightPx:        r.line_height_px,
              color:               r.fill_color,
              absoluteBoundingBox: r.bounds ?? { x: 0, y: 0, width: 0, height: 0 },
              styleId:             r.style_id ?? undefined,
              fillStyleId:         r.fill_style_id ?? undefined,
            });
          }
          visibilityStatsForLog = normalized.visibility_stats;
          rootBbox  = normalized.frame_bounds ?? rootDoc.absoluteBoundingBox ?? { x: 0, y: 0, width: 100, height: 100 };
          frameName = normalized.frame_name;
        }

        const frame: FrameInfo = { id: nodeId, absoluteBoundingBox: rootBbox };
        console.log("[figma-compare] visibility-filter", JSON.stringify(visibilityStatsForLog ?? {
          textNodesTotal: textNodes.length,
          skippedHiddenInherited: 0,
          skippedHiddenSelf: 0,
          skippedZeroSize: 0,
          skippedTransparent: 0,
          skippedByName: 0,
          skippedComponentDef: 0,
          skippedVariant: 0,
          skippedAriaHidden: 0,
          skippedSrOnly: 0,
          diffCandidates: textNodes.length,
          skippedClipped: 0,
          skippedMasked: 0,
        }));

        send("step", { text: `Found frame: "${frameName}" — ${textNodes.length} text nodes.` });

        if (textNodes.length === 0) {
          send("error", { text: `No text found in frame "${frameName}". Make sure you right-clicked the correct frame and used "Copy link to selection".` });
          controller.close();
          return;
        }

        // ── Step 4: Build live context — match Figma nodes to live styles by text ─
        // Declare check flags here so Step 4 matching can use them
        const TYPOGRAPHY_CHECKS = ["font_family", "font_size", "font_weight", "color"] as const;
        const ALL_CHECKS = [...TYPOGRAPHY_CHECKS, "missing_elements"] as const;
        const enabledChecks = (checks ?? TYPOGRAPHY_CHECKS as unknown as string[])
          .filter(c => (ALL_CHECKS as readonly string[]).includes(c));
        const activeChecks = enabledChecks.length > 0 ? enabledChecks : [...TYPOGRAPHY_CHECKS];
        const inclFamily  = activeChecks.includes("font_family");
        const inclSize    = activeChecks.includes("font_size");
        const inclWeight  = activeChecks.includes("font_weight");
        const inclColor   = activeChecks.includes("color");
        const inclContent = activeChecks.includes("content");
        const inclSpacing = activeChecks.includes("spacing");

        let liveContext = "";
        const rawStyles: any[] = Array.isArray(liveStyles) && liveStyles.length > 0
          ? liveStyles
          : (liveData?.styles ?? []);
        const layoutPairsByFigmaId = new Map<string, LayoutPair>();
        const figmaIdByLiveIndex = new Map<number, string>();
        const addLayoutPair = (figmaNode: TextNode, liveStyle: any) => {
          const figmaText = figmaNode.characters.trim();
          const liveText = liveStyle?.text?.trim() ?? "";
          const figmaBounds = physicalFigmaBounds(figmaNode, frame);
          const liveBounds = physicalLiveBounds(liveStyle);
          if (!figmaText || !liveText || !figmaBounds || !liveBounds) return;
          const liveIndex = rawStyles.indexOf(liveStyle);
          if (liveIndex < 0) return;
          const figmaNormBounds = normalizedFigmaBounds(figmaNode, frame);
          const liveNormBounds = normalizedLiveBounds(liveStyle);
          const matchDistance = figmaNormBounds && liveNormBounds ? geometryDistance(figmaNormBounds, liveNormBounds) : 1;
          const figmaKey = normalizeCopyForCompare(figmaText);
          const liveKey = normalizeCopyForCompare(liveText);
          const overlap = textOverlapStats(figmaText, liveText).score;
          const reliableForSpacing =
            figmaKey === liveKey ||
            (figmaKey.length >= 8 && liveKey.includes(figmaKey)) ||
            (liveKey.length >= 8 && figmaKey.includes(liveKey)) ||
            overlap >= 0.75;
          const existing = layoutPairsByFigmaId.get(figmaNode.id);
          if (existing && existing.matchDistance <= matchDistance) return;

          const existingFigmaForLive = figmaIdByLiveIndex.get(liveIndex);
          if (existingFigmaForLive && existingFigmaForLive !== figmaNode.id) {
            const existingLivePair = layoutPairsByFigmaId.get(existingFigmaForLive);
            if (existingLivePair && existingLivePair.matchDistance <= matchDistance) return;
            layoutPairsByFigmaId.delete(existingFigmaForLive);
          }

          if (existing) figmaIdByLiveIndex.delete(existing.liveIndex);
          figmaIdByLiveIndex.set(liveIndex, figmaNode.id);
          layoutPairsByFigmaId.set(figmaNode.id, {
            figma: figmaNode,
            live: liveStyle,
            liveIndex,
            figmaText,
            liveText,
            figmaBounds,
            liveBounds,
            matchDistance,
            reliableForSpacing,
          });
        };

        const unmatchedFigma: string[] = [];
        if (rawStyles.length > 0) {
          const matchedLines: string[] = [];

          for (const n of [...textNodes].sort((a, b) => {
            const ay = a.absoluteBoundingBox?.y ?? 0;
            const by = b.absoluteBoundingBox?.y ?? 0;
            if (Math.abs(ay - by) > 2) return ay - by;
            return (a.absoluteBoundingBox?.x ?? 0) - (b.absoluteBoundingBox?.x ?? 0);
          })) {
            const live = findLiveMatchForFigmaNode(n, frame, rawStyles, true);

            if (live) {
              addLayoutPair(n, live);
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
        const missingContentLabels: string[] = [];
        const contentMatchedFigmaKeys = new Set<string>();
        let deterministicContentIssues: Array<{ element: string; category: string; issue: string; severity: string }> = [];
        if ((inclContent || inclSpacing) && rawStyles.length > 0) {
          const contentLines: string[] = [];
          const missingLines: string[] = [];
          const liveHasGeometry = rawStyles.some(s => normalizedLiveBounds(s));
          if (!liveHasGeometry && inclContent) {
            send("step", { text: "Content position data is missing from live capture — update/reload the extension for accurate changed-copy mapping." });
          }
          if (!rawStyles.some(s => physicalLiveBounds(s)) && inclSpacing) {
            send("step", { text: "Spacing position data is missing from live capture — update/reload the extension before running spacing checks." });
          }
          const figmaContentCandidates = assignContentOrders(
            textNodes.flatMap(n => {
              const text = n.characters.trim();
              const key = normalizeCopyForCompare(text);
              const bounds = normalizedFigmaBounds(n, frame);
              if (text.length < 4 || !key || meaningfulWords(text).length < 1 || !bounds) return [];
              return [{ item: n, text, key, shape: copyShape(text), bounds }];
            })
          );
          const liveContentCandidates = assignContentOrders(
            rawStyles.flatMap(s => {
              const text = s.text?.trim() ?? "";
              const key = normalizeCopyForCompare(text);
              const bounds = normalizedLiveBounds(s);
              if (!key || !bounds || !isLikelyUiCopy(text)) return [];
              return [{ item: s, text, key, shape: copyShape(text), bounds }];
            })
          );
          const liveStylesByExactKey = new Map<string, any[]>();
          for (const s of rawStyles) {
            const key = normalizeCopyForCompare(s.text?.trim() ?? "");
            if (!key) continue;
            const items = liveStylesByExactKey.get(key) ?? [];
            items.push(s);
            liveStylesByExactKey.set(key, items);
          }
          const usedLiveContentKeys = new Set<string>();

          for (const candidate of figmaContentCandidates) {
            const n = candidate.item;
            const figmaText = n.characters.trim();
            if (figmaText.length < 4) continue;
            const figmaWords = meaningfulWords(figmaText);
            const figmaKey = normalizeCopyForCompare(figmaText);
            if (!figmaKey || figmaWords.length < 1) continue;

            let bestMatch: any = null;
            const exactMatch = bestLiveMatchByGeometry(n, frame, liveStylesByExactKey.get(figmaKey) ?? [])
              ?? findLiveMatchForFigmaNode(n, frame, rawStyles, false);
            if (exactMatch) {
              addLayoutPair(n, exactMatch);
              contentMatchedFigmaKeys.add(figmaKey);
              continue;
            }

            if (liveHasGeometry) {
              let bestScore = 0;
              for (const liveCandidate of liveContentCandidates) {
                if (usedLiveContentKeys.has(liveCandidate.key)) continue;
                const score = contentMatchScore(candidate, liveCandidate);
                if (score === null || score < 0.62 || score <= bestScore) continue;
                bestScore = score;
                bestMatch = liveCandidate.item;
              }
            }

            if (!bestMatch) {
              let bestScore = 0;
              for (const s of rawStyles) {
                const liveText = s.text?.trim() ?? "";
                if (!isLikelyUiCopy(liveText)) continue;
                if (!isStrictTextFallbackMatch(figmaText, liveText)) continue;
                const { score } = textOverlapStats(figmaText, liveText);
                if (score > bestScore) {
                  bestScore = score;
                  bestMatch = s;
                }
              }
            }

            if (bestMatch) {
              const liveText = bestMatch.text?.trim() ?? "";
              addLayoutPair(n, bestMatch);
              contentMatchedFigmaKeys.add(figmaKey);
              usedLiveContentKeys.add(normalizeCopyForCompare(liveText));
              if (inclContent && shouldReportContentMismatch(candidate, bestMatch)) {
                contentLines.push(`Figma: "${figmaText.slice(0, 100)}" → Live: "${liveText.slice(0, 100)}"`);
                deterministicContentIssues.push(contentIssue(figmaText, liveText));
              }
            } else if (inclContent && (figmaWords.length >= 2 || figmaText.length >= 12)) {
              // No live match found — could be missing or heavily reworded content
              const label = figmaText.slice(0, 100);
              missingLines.push(`"${label}"`);
              missingContentLabels.push(label);
            }
          }

          if (inclContent) {
            send("step", { text: `Content scan matched ${contentMatchedFigmaKeys.size} Figma text item${contentMatchedFigmaKeys.size === 1 ? "" : "s"} to live text by exact text or position.` });
          }

          if (inclContent && contentLines.length > 0) {
            contentPairs += `\n\nCONTENT PAIRS TO CHECK (same element, copy may differ):\n${contentLines.join("\n")}`;
          }
          if (inclContent && missingLines.length > 0) {
            contentPairs += `\n\nFIGMA TEXT WITH NO LIVE MATCH:\n${missingLines.join("\n")}`;
          }
        }
        deterministicContentIssues = deterministicContentIssues.filter((issue, index, arr) =>
          arr.findIndex(other => other.element === issue.element && other.issue === issue.issue) === index
        );
        let deterministicSpacingIssues: Array<{ element: string; category: string; issue: string; severity: string }> = [];
        if (inclSpacing) {
          deterministicSpacingIssues = buildSpacingIssues([...layoutPairsByFigmaId.values()], frame);
          send("step", {
            text: `Spacing scan checked ${layoutPairsByFigmaId.size} matched text item${layoutPairsByFigmaId.size === 1 ? "" : "s"} and found ${deterministicSpacingIssues.length} spacing issue${deterministicSpacingIssues.length === 1 ? "" : "s"}.`,
          });
        }
        const deterministicTypographyIssues = buildTypographyIssues([...layoutPairsByFigmaId.values()], textNodes, {
          family: inclFamily,
          size: inclSize,
          weight: inclWeight,
          color: inclColor,
        });
        if (inclFamily || inclSize || inclWeight || inclColor) {
          send("step", {
            text: `Typography scan checked ${layoutPairsByFigmaId.size} matched text item${layoutPairsByFigmaId.size === 1 ? "" : "s"} and found ${deterministicTypographyIssues.length} typography issue${deterministicTypographyIssues.length === 1 ? "" : "s"}.`,
          });
        }

        const deterministicCheckNames = new Set(["missing_elements", "font_family", "font_size", "font_weight", "color"]);
        const onlyDeterministicChecks = activeChecks.every(c => deterministicCheckNames.has(c));
        if (onlyDeterministicChecks) {
          let deterministicDiscrepancies = [
            ...deterministicTypographyIssues,
            ...deterministicSpacingIssues,
            ...(inclContent ? deterministicContentIssues : []),
          ];

          if (activeChecks.includes("missing_elements") && unmatchedFigma.length > 0) {
            const missingItems = unmatchedFigma
              .map(label => label.replace(/" \(no live match.*$/, "").replace(/^"/, ""))
              .filter(label => {
                const key = normalizeCopyForCompare(label);
                if (!key || !isLikelyUiCopy(label)) return false;
                return !contentMatchedFigmaKeys.has(key);
              })
              .map(label => ({
                element: label,
                category: "missing_elements",
                issue: "Missing on live page",
                severity: "high",
              }));
            deterministicDiscrepancies = [...missingItems, ...deterministicDiscrepancies];
          }

          if (inclContent && !activeChecks.includes("missing_elements") && missingContentLabels.length > 0) {
            const seenContent = new Set(deterministicDiscrepancies.map(d => d.element.toLowerCase()));
            const missingContentItems = missingContentLabels
              .filter(label => {
                const key = label.toLowerCase();
                if (seenContent.has(key)) return false;
                seenContent.add(key);
                return true;
              })
              .map(label => ({
                element: label,
                category: "content",
                issue: "Missing content on live page",
                severity: "high",
              }));
            deterministicDiscrepancies = [...deterministicDiscrepancies, ...missingContentItems];
          }

          if (deterministicDiscrepancies.length === 0) {
            const scannedAt = new Date().toISOString();
            const resultText = "No discrepancies found for the selected deterministic checks.";
            await persistScanRun({
              snapshotId: snapshotId ?? null,
              fileKey,
              nodeId,
              liveUrl,
              scannedAt,
              summary: resultText,
              issues: [],
            });
            send("result", {
              text: resultText,
              table: [],
              snapshotId: snapshotId ?? null,
            });
            controller.close();
            return;
          }

          const byCategory = deterministicDiscrepancies.reduce((acc, d) => {
            acc[d.category] = (acc[d.category] ?? 0) + 1;
            return acc;
          }, {} as Record<string, number>);
          const summary = Object.entries(byCategory)
            .map(([cat, count]) => `${count} ${cat.replace("_", " ")}`)
            .join(", ");
          const resultText = `Found ${deterministicDiscrepancies.length} issue${deterministicDiscrepancies.length === 1 ? "" : "s"}: ${summary}.`;
          const scannedAt = new Date().toISOString();
          await persistScanRun({
            snapshotId: snapshotId ?? null,
            fileKey,
            nodeId,
            liveUrl,
            scannedAt,
            summary: resultText,
            issues: deterministicDiscrepancies,
          });

          send("result", {
            text: resultText,
            table: deterministicDiscrepancies.map(d => ({
              element: d.element,
              issue: d.issue,
              category: d.category,
              severity: d.severity,
            })),
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
          controller.close();
          return;
        }

        if (!aiConfig.enabled) {
          send("error", {
            text: "AI fallback is disabled. Loupe's deterministic checks ran, but this scan requested an unsupported AI-only check. Enable AI fallback in Settings to use future AI-assisted checks.",
          });
          controller.close();
          return;
        }
        if (!aiConfig.apiKey) {
          send("error", {
            text: `AI fallback needs a ${aiConfig.provider === "openai" ? "OpenAI" : "Groq"} API key. Add one in Settings → AI Keys & Guardrails.`,
          });
          controller.close();
          return;
        }

        send("step", { text: `Comparing Figma nodes with live styles via ${aiConfig.provider === "openai" ? "OpenAI" : "Groq"} AI…` });

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
        if (inclContent) checkRules.push("- content: Do not report content issues. Content is validated separately by deterministic matching.");
        if (inclSpacing) checkRules.push("- spacing: Do not report spacing issues. Spacing is validated separately by deterministic layout matching.");

        const checkListStr = activeChecks.join(", ");

        send("step", { text: `Sending to ${aiConfig.provider === "openai" ? "OpenAI" : "Groq"} AI — checking: ${activeChecks.map(c => c.replace("_", " ")).join(", ")}…` });

        const groqBody = JSON.stringify({
          model: aiConfig.model,
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
          aiRes = await fetch(aiConfig.endpoint, {
            method: "POST",
            signal: AbortSignal.timeout(55_000),
            headers: {
              Authorization: `Bearer ${aiConfig.apiKey}`,
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

        // Remove false positives, off-category results, and duplicates.
        // Content checks are handled deterministically above because the model
        // tends to invent generic labels like "Call to Action" for copy pairs.
        const seenIssues = new Set<string>();
        discrepancies = discrepancies.filter(d => {
          // Strip anything not in the user's enabled checks (safety net for model drift)
          if (d.category && !activeChecks.includes(d.category)) return false;
          if (d.category === "content") return false;
          if (d.category === "spacing") return false;
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

        if (deterministicContentIssues.length > 0) {
          const existingContentIssues = new Set(
            discrepancies.map(d => `${d.category ?? ""}||${d.element.toLowerCase()}||${d.issue.toLowerCase()}`)
          );
          const contentItems = deterministicContentIssues.filter(d => {
            const key = `${d.category}||${d.element.toLowerCase()}||${d.issue.toLowerCase()}`;
            if (existingContentIssues.has(key)) return false;
            existingContentIssues.add(key);
            return true;
          });
          discrepancies = [...contentItems, ...discrepancies];
        }

        if (deterministicSpacingIssues.length > 0) {
          const existingSpacingIssues = new Set(
            discrepancies.map(d => `${d.category ?? ""}||${d.element.toLowerCase()}||${d.issue.toLowerCase()}`)
          );
          const spacingItems = deterministicSpacingIssues.filter(d => {
            const key = `${d.category}||${d.element.toLowerCase()}||${d.issue.toLowerCase()}`;
            if (existingSpacingIssues.has(key)) return false;
            existingSpacingIssues.add(key);
            return true;
          });
          discrepancies = [...spacingItems, ...discrepancies];
        }

        // Prepend missing elements (no AI needed — direct from unmatched nodes)
        if (activeChecks.includes("missing_elements") && unmatchedFigma.length > 0) {
          const missingItems = unmatchedFigma
            .map(label => label.replace(/" \(no live match.*$/, "").replace(/^"/, ""))
            .filter(label => {
              const key = normalizeCopyForCompare(label);
              if (!key || !isLikelyUiCopy(label)) return false;
              return !contentMatchedFigmaKeys.has(key);
            })
            .map(label => ({
              element: label,
              category: "missing_elements",
              issue: "Missing on live page",
              severity: "high",
            }));
          discrepancies = [...missingItems, ...discrepancies];
        }

        // When Missing Elements is enabled, Figma-only copy is reported there.
        // Only use content missing rows for content-only scans.
        if (inclContent && !activeChecks.includes("missing_elements") && missingContentLabels.length > 0) {
          const seenContent = new Set(discrepancies.map(d => d.element.toLowerCase()));
          const missingContentItems = missingContentLabels
            .filter(label => {
              const key = label.toLowerCase();
              if (seenContent.has(key)) return false;
              seenContent.add(key);
              return true;
            })
            .map(label => ({
              element: label,
              category: "content",
              issue: "Missing content on live page",
              severity: "high",
            }));
          discrepancies = [...missingContentItems, ...discrepancies];
        }

        // ── Step 6: Save issues to internal database (zero Figma API calls) ────
        const table: Array<{ element: string; issue: string; category?: string; severity?: string; commentId?: string }> = [];

        if (discrepancies.length === 0) {
          const resultText = "No discrepancies found. This can happen if:\n• The live URL doesn't match the Figma frame (e.g. wrong page)\n• The Loupe extension hasn't captured styles from the live site yet (visit the page first, then run again)\n• The design and live site genuinely match";
          const scannedAt = new Date().toISOString();
          await persistScanRun({
            snapshotId: snapshotId ?? null,
            fileKey,
            nodeId,
            liveUrl,
            scannedAt,
            summary: resultText,
            issues: [],
          });
          send("result", {
            text: resultText,
            table: [],
            snapshotId: snapshotId ?? null,
          });
          controller.close();
          return;
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
        const resultText = `Found ${discrepancies.length} issues: ${summary}. Use "Publish to Figma" to post comments when ready.`;
        const scannedAt = new Date().toISOString();
        await persistScanRun({
          snapshotId: snapshotId ?? null,
          fileKey,
          nodeId,
          liveUrl,
          scannedAt,
          summary: resultText,
          issues: discrepancies,
        });

        send("result", {
          text: resultText,
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
