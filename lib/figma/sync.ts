import { figmaHeaders } from "./api";

const FIGMA_API = "https://api.figma.com/v1";

export interface FigmaComment {
  id: string;           // unique comment ID
  order_id: string;     // display number — replies use this as their parent_id
  parent_id: string | null; // if set, this is a reply; value = parent's order_id
  message: string;
  created_at: string;
  resolved_at: string | null;
  user: {
    handle: string;
    img_url: string | null;
    email?: string;
  };
  client_meta?: {
    node_id?: string;   // frame this comment is pinned to (only if anchored)
  };
}

export async function fetchComments(fileKey: string, pat: string): Promise<FigmaComment[]> {
  const res = await fetch(`${FIGMA_API}/files/${fileKey}/comments`, {
    headers: figmaHeaders(pat),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Figma comments API ${res.status}: ${text}`);
  }
  const data = await res.json() as { comments?: FigmaComment[] };
  return data.comments ?? [];
}

/**
 * Batch fetch frame preview images for multiple node IDs.
 * ONE API call for all nodes — avoids rate limiting.
 * Returns map of { nodeId -> imageUrl | null }
 */
export async function fetchFramePreviews(
  fileKey: string,
  nodeIds: string[],
  pat: string
): Promise<Record<string, string | null>> {
  if (nodeIds.length === 0) return {};

  try {
    // Figma node IDs use ":" separator (e.g. "123:456")
    // Normalise any "-" separators to ":"
    const canonicalIds = nodeIds.map(id =>
      id.includes(":") ? id : id.replace("-", ":")
    );

    const url = `${FIGMA_API}/images/${fileKey}?ids=${canonicalIds.join(",")}&scale=2&format=png`;
    console.log("[fetchFramePreviews] GET", url);

    const res = await fetch(url, { headers: figmaHeaders(pat) });
    const body = await res.text();
    console.log("[fetchFramePreviews] status=", res.status, "body=", body.slice(0, 300));

    if (res.status === 429) throw new Error("RATE_LIMITED");
    if (!res.ok) return {};

    const data = JSON.parse(body) as {
      err?: string;
      images?: Record<string, string | null>;
    };

    if (data.err || !data.images) return {};

    // Build result keyed by original nodeId
    const result: Record<string, string | null> = {};
    for (let i = 0; i < nodeIds.length; i++) {
      const orig = nodeIds[i];
      const canon = canonicalIds[i];
      const dash = canon.replace(":", "-");
      result[orig] = data.images[canon] ?? data.images[dash] ?? null;
    }
    return result;
  } catch (e) {
    if (e instanceof Error && e.message === "RATE_LIMITED") throw e;
    console.error("[fetchFramePreviews] error", e);
    return {};
  }
}
