import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getWorkspace } from "@/lib/workspace";

async function deregisterFigmaWebhook(pat: string, webhookId: string): Promise<void> {
  await fetch(`https://api.figma.com/v1/webhooks/${webhookId}`, {
    method: "DELETE",
    headers: { "X-Figma-Token": pat },
  });
}

export async function POST() {
  const ctx = await getWorkspace();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { workspace } = ctx;
  const admin = createAdminClient();

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
