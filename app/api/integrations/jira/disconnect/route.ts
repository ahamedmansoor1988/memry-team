import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getWorkspace } from "@/lib/workspace";

export async function POST() {
  const ctx = await getWorkspace();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  await admin.from("workspaces").update({
    jira_access_token:  null,
    jira_refresh_token: null,
    jira_cloud_id:      null,
    jira_connected_at:  null,
  }).eq("id", ctx.workspace.id);

  return NextResponse.json({ ok: true });
}
