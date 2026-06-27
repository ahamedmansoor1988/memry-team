"use server";

import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export async function completeOnboarding(formData: {
  name: string;
  workspaceName: string;
  figmaPat?: string;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();

  // Update display name
  await admin.auth.admin.updateUserById(user.id, {
    user_metadata: { full_name: formData.name.trim() },
  });

  // Create workspace (needs admin client to bypass RLS)
  const { data: workspace, error: wsErr } = await admin
    .from("workspaces")
    .insert({ name: formData.workspaceName.trim() })
    .select("id")
    .single();
  if (wsErr) throw new Error(wsErr.message);

  // Add user as owner
  const { error: memberErr } = await admin
    .from("workspace_members")
    .insert({ workspace_id: workspace.id, user_id: user.id, role: "owner" });
  if (memberErr) throw new Error(memberErr.message);

  // Save Figma PAT if provided
  if (formData.figmaPat?.trim()) {
    await admin
      .from("workspaces")
      .update({
        figma_access_token: formData.figmaPat.trim(),
        figma_connected_at: new Date().toISOString(),
      })
      .eq("id", workspace.id);
  }

  redirect("/");
}
