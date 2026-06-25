import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 15;

export async function POST(req: NextRequest) {
  const { fileKey, pat } = await req.json() as { fileKey: string; pat: string };
  if (!fileKey || !pat) return NextResponse.json({ error: "Missing fileKey or pat" }, { status: 400 });

  // Fetch version history — each version has the user who made the edit
  const res = await fetch(`https://api.figma.com/v1/files/${fileKey}/versions`, {
    headers: { "X-Figma-Token": pat },
  });

  if (!res.ok) return NextResponse.json({ error: `Figma error ${res.status}` }, { status: 400 });

  const data = await res.json() as { versions: Array<{ user: { id: string; handle: string; img_url: string } }> };

  // Deduplicate users, preserve order (most recent first)
  const seen = new Set<string>();
  const users: Array<{ id: string; handle: string; img_url: string }> = [];
  for (const v of data.versions ?? []) {
    if (v.user?.handle && !seen.has(v.user.id)) {
      seen.add(v.user.id);
      users.push(v.user);
    }
  }

  return NextResponse.json({ users });
}
