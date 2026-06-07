/**
 * Team-based Figma file discovery.
 *
 * Only `listTeamFiles` is used by the live sync path
 * (app/api/figma/pull/route.ts). Per-file comment sync runs via
 * app/api/figma-files/[id]/sync/route.ts which owns AI classify,
 * owner resolution, profile upserts, and accountability timestamps.
 */

import { figmaHeaders } from "./api";

const FIGMA_API = "https://api.figma.com/v1";

// ─── Figma API shapes ─────────────────────────────────────────────────────────

interface FigmaProject { id: string; name: string }
interface FigmaFile    { key: string; name: string; thumbnail_url?: string }

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TeamFile {
  key: string;
  name: string;
  projectId: string;
  projectName: string;
  thumbnailUrl?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function figmaGet<T>(path: string, pat: string): Promise<T> {
  const res = await fetch(`${FIGMA_API}${path}`, { headers: figmaHeaders(pat) });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Figma API ${res.status} on ${path}: ${text.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

// ─── Public surface ───────────────────────────────────────────────────────────

/**
 * Discover all files across every project in a Figma team.
 * Called by POST /api/figma/pull — results are fanned out to per-file sync.
 */
export async function listTeamFiles(teamId: string, pat: string): Promise<TeamFile[]> {
  const team = await figmaGet<{ projects: FigmaProject[] }>(
    `/teams/${encodeURIComponent(teamId)}/projects`,
    pat,
  );
  const all: TeamFile[] = [];
  for (const project of team.projects ?? []) {
    try {
      const proj = await figmaGet<{ files: FigmaFile[] }>(
        `/projects/${project.id}/files`,
        pat,
      );
      for (const f of proj.files ?? []) {
        all.push({
          key: f.key,
          name: f.name,
          projectId: project.id,
          projectName: project.name,
          thumbnailUrl: f.thumbnail_url,
        });
      }
    } catch (e) {
      console.warn(`[team-sync] skipping project ${project.name}:`, e);
    }
  }
  return all;
}
