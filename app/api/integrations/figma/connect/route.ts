import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getWorkspace } from "@/lib/workspace";
import crypto from "crypto";

async function registerFigmaWebhook(
  pat: string,
  teamId: string,
  eventType: "FILE_COMMENT",
  endpoint: string,
  passcode: string,
): Promise<string> {
  const res = await fetch("https://api.figma.com/v1/webhooks", {
    method: "POST",
    headers: {
      "X-Figma-Token": pat,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ event_type: eventType, team_id: teamId, endpoint, passcode }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Figma webhook registration failed (${eventType}): ${body}`);
  }
  const data = await res.json() as { id: string };
  return data.id;
}

async function deregisterFigmaWebhook(pat: string, webhookId: string): Promise<void> {
  await fetch(`https://api.figma.com/v1/webhooks/${webhookId}`, {
    method: "DELETE",
    headers: { "X-Figma-Token": pat },
  });
}

export async function POST(req: NextRequest) {
  const ctx = await getWorkspace();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { pat, team_id } = await req.json() as { pat?: string; team_id?: string };
  if (!pat?.trim() || !team_id?.trim()) {
    return NextResponse.json({ error: "PAT and Team ID are required" }, { status: 400 });
  }

  // Verify PAT
  const meRes = await fetch("https://api.figma.com/v1/me", {
    headers: { "X-Figma-Token": pat.trim() },
  });
  if (!meRes.ok) {
    const body = await meRes.text();
    console.error("[figma/connect] PAT verification failed:", meRes.status, body);
    return NextResponse.json(
      { error: `Figma PAT rejected (${meRes.status}): ${body}` },
      { status: 400 },
    );
  }

  const passcode   = crypto.randomBytes(32).toString("hex");
  const origin     = new URL(req.url).origin;
  const endpoint   = `${origin}/api/webhooks/figma?ws=${ctx.workspace.id}`;

  let webhookIdComment: string;
  try {
    webhookIdComment = await registerFigmaWebhook(
      pat.trim(), team_id.trim(), "FILE_COMMENT", endpoint, passcode,
    );
  } catch (err: any) {
    console.error("[figma/connect] webhook registration error:", err.message);
    return NextResponse.json({ error: err.message ?? "Failed to register Figma webhooks" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { error } = await admin.from("workspaces").update({
    figma_pat:                 pat.trim(),
    figma_team_id:             team_id.trim(),
    figma_connected_at:        new Date().toISOString(),
    figma_webhook_id_comment:  webhookIdComment,
    figma_webhook_id_resolved: null,
    figma_webhook_passcode:    passcode,
  }).eq("id", ctx.workspace.id);

  if (error) {
    return NextResponse.json({ error: "Failed to save Figma credentials" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE() {
  const ctx = await getWorkspace();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { workspace } = ctx;
  const admin = createAdminClient();

  // Deregister webhooks if we have the IDs and PAT
  if (workspace.figma_pat) {
    const jobs: Promise<void>[] = [];
    if (workspace.figma_webhook_id_comment) {
      jobs.push(deregisterFigmaWebhook(workspace.figma_pat, workspace.figma_webhook_id_comment));
    }
    if (workspace.figma_webhook_id_resolved) {
      jobs.push(deregisterFigmaWebhook(workspace.figma_pat, workspace.figma_webhook_id_resolved));
    }
    await Promise.allSettled(jobs);
  }

  await admin.from("workspaces").update({
    figma_pat:                 null,
    figma_team_id:             null,
    figma_connected_at:        null,
    figma_webhook_id_comment:  null,
    figma_webhook_id_resolved: null,
    figma_webhook_passcode:    null,
  }).eq("id", workspace.id);

  return NextResponse.json({ ok: true });
}
