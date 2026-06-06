import { figmaHeaders } from "./api";

const FIGMA_API = "https://api.figma.com/v1";

interface FigmaImagesResponse {
  err: string | null;
  images: Record<string, string | null>;
}

/**
 * Returns the CDN URL for a PNG export of `nodeId` in `fileKey`, or null if
 * the node has no image, the file isn't accessible, or the API call fails.
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

    const res = await fetch(url, { headers: figmaHeaders(pat) });
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

    const res = await fetch(url, { headers: figmaHeaders(pat) });
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
