import { figmaHeaders } from "./api";

const FIGMA_API = "https://api.figma.com/v1";

interface FigmaImagesResponse {
  err: string | null;
  images: Record<string, string | null>;
}

// ─── Retry helper ─────────────────────────────────────────────────────────────

const MAX_RETRIES = 3;

/**
 * Fetch with exponential backoff + jitter on 429 responses.
 * Delays: ~1s, ~2s, ~4s (base doubled each attempt, +0–200ms jitter).
 * Returns the last Response even if it's still a 429 after all retries.
 */
async function fetchWithBackoff(
  url: string,
  headers: Record<string, string>,
): Promise<Response> {
  let res!: Response;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    res = await fetch(url, { headers });
    if (res.status !== 429) return res;
    if (attempt === MAX_RETRIES) break;
    const base = Math.pow(2, attempt) * 1000;  // 1 000, 2 000, 4 000 ms
    const jitter = Math.random() * 200;
    await new Promise(r => setTimeout(r, base + jitter));
  }
  return res;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Returns the CDN URL for a PNG export of `nodeId` in `fileKey`, or null if
 * the node has no image, the file isn't accessible, or the API call fails.
 * Retries up to 3× on 429 with exponential backoff before giving up.
 *
 * nodeId may contain ":" (e.g. "1:23") — it is URL-encoded automatically.
 */
export async function getNodeThumbnail(
  fileKey: string,
  nodeId: string,
  pat: string,
): Promise<string | null> {
  try {
    const encodedId = encodeURIComponent(nodeId);
    const url = `${FIGMA_API}/images/${fileKey}?ids=${encodedId}&format=png&scale=1`;

    const res = await fetchWithBackoff(url, figmaHeaders(pat));
    if (!res.ok) return null;

    const data = await res.json() as FigmaImagesResponse;
    if (data.err) return null;

    // Figma returns images keyed by the *original* (un-encoded) node ID
    return data.images[nodeId] ?? null;
  } catch {
    return null;
  }
}

/**
 * Fetches CDN URLs for multiple nodes in a single Figma Images API call.
 * Returns a map of nodeId → URL; nodes with no image are omitted.
 * Retries up to 3× on 429 with exponential backoff before giving up.
 *
 * Use this in the sync pipeline to batch all nodes for a file into one request
 * instead of one request per comment.
 */
export async function getBatchThumbnails(
  fileKey: string,
  nodeIds: string[],
  pat: string,
): Promise<Record<string, string>> {
  if (nodeIds.length === 0) return {};
  try {
    // Encode each ID (may contain ":"), join with literal "," (the separator)
    const encodedIds = nodeIds.map(id => encodeURIComponent(id)).join(",");
    const url = `${FIGMA_API}/images/${fileKey}?ids=${encodedIds}&format=png&scale=1`;

    const res = await fetchWithBackoff(url, figmaHeaders(pat));
    if (!res.ok) return {};

    const data = await res.json() as FigmaImagesResponse;
    if (data.err) return {};

    // Response keys use the original (un-encoded) nodeId
    const result: Record<string, string> = {};
    for (const nodeId of nodeIds) {
      const thumbUrl = data.images[nodeId];
      if (thumbUrl) result[nodeId] = thumbUrl;
    }
    return result;
  } catch {
    return {};
  }
}
