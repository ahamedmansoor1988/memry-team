import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Sidebar from "@/components/layout/Sidebar";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();

  // Get workspace
  const { data: membership } = await admin
    .from("workspace_members")
    .select("workspace_id, workspace:workspaces(name)")
    .eq("user_id", user.id)
    .limit(1)
    .single();

  if (!membership) redirect("/onboarding");

  const workspaceId = membership.workspace_id as string;
  const workspaceName = (membership.workspace as { name?: string } | null)?.name;

  // Open count for inbox badge
  const { count: openCount } = await admin
    .from("feedback_items")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .eq("status", "open");

  return (
    <div className="flex h-screen overflow-hidden bg-[#0f0f13]">
      <Sidebar
        workspaceName={workspaceName}
        userName={user.user_metadata?.full_name ?? user.email}
        userAvatar={user.user_metadata?.avatar_url ?? null}
        openCount={openCount ?? 0}
      />
      <main className="flex-1 overflow-y-auto">
        {children}
      </main>
    </div>
  );
}
