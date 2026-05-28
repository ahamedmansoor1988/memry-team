const FIGMA_API = "https://api.figma.com/v1";

export function figmaHeaders(pat: string): Record<string, string> {
  return pat.startsWith("figd_")
    ? { "X-Figma-Token": pat }
    : { "Authorization": `Bearer ${pat}` };
}

export async function validatePat(pat: string): Promise<boolean> {
  try {
    const res = await fetch(`${FIGMA_API}/me`, { headers: figmaHeaders(pat) });
    return res.ok;
  } catch { return false; }
}

export async function getFigmaMe(pat: string): Promise<{ handle: string; email: string } | null> {
  try {
    const res = await fetch(`${FIGMA_API}/me`, { headers: figmaHeaders(pat) });
    if (!res.ok) return null;
    const data = await res.json() as { handle?: string; email?: string };
    return { handle: data.handle ?? "", email: data.email ?? "" };
  } catch { return null; }
}

export async function getFigmaFileName(fileKey: string, pat: string): Promise<string | null> {
  try {
    const res = await fetch(`${FIGMA_API}/files/${fileKey}?depth=1`, {
      headers: figmaHeaders(pat),
    });
    if (!res.ok) return null;
    const data = await res.json() as { name?: string };
    return data.name ?? null;
  } catch { return null; }
}

export function extractFileKey(url: string): string | null {
  const match = url.match(/figma\.com\/(?:file|design)\/([a-zA-Z0-9]+)/);
  return match?.[1] ?? null;
}
