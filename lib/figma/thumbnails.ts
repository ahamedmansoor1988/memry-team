/**
 * Lightweight Figma image-export helper.
 *
 * Calls the Figma Images API to get a 1× PNG export URL for a single node.
 * No caching here — the caller (preview route) is responsible for persisting
 * the URL so we never hit this endpoint more than once per item.
 */

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
