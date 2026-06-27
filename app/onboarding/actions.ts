"use server";

import { createClient, createAdminClient } from "@/lib/supabase/server";

export async function completeOnboarding(formData: {
  name: string;
  workspaceName: string;
  figmaPat?: string;
}): Promise<{ error: string } | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();

  // Update display name
  const { error: nameErr } = await admin.auth.admin.updateUserById(user.id, {
    user_metadata: { full_name: formData.name.trim() },
  });
  if (nameErr) return { error: "Name update failed: " + nameErr.message };

  // Create workspace
  const { data: workspace, error: wsErr } = await admin
    .from("workspaces")
    .insert({ name: formData.workspaceName.trim() })
    .select("id")
    .single();
  if (wsErr) return { error: "Workspace creation failed: " + wsErr.message };

  // Add user as owner
  const { error: memberErr } = await admin
    .from("workspace_members")
    .insert({ workspace_id: workspace.id, user_id: user.id, role: "owner" });
  if (memberErr) return { error: "Member setup failed: " + memberErr.message };

  // Save Figma PAT if provided
  if (formData.figmaPat?.trim()) {
    const { error: patErr } = await admin
      .from("workspaces")
      .update({
        figma_access_token: formData.figmaPat.trim(),
        figma_connected_at: new Date().toISOString(),
      })
      .eq("id", workspace.id);
    if (patErr) return { error: "Figma PAT save failed: " + patErr.message };
  }

  return null;
}
