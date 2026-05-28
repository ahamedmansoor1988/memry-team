import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Sidebar from "@/components/layout/Sidebar";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();

  const { data: membership } = await admin
    .from("workspace_members")
    .select("workspace_id, workspace:workspaces(name)")
    .eq("user_id", user.id)
    .limit(1)
    .single();

  if (!membership) redirect("/onboarding");

  const workspaceId = membership.workspace_id as string;
  const workspaceName = (membership.workspace as { name?: string } | null)?.name;

  const [{ count: openCount }, { data: projects }] = await Promise.all([
    admin.from("feedback_items")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .eq("status", "open"),
    admin.from("projects")
      .select("id, name")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(8),
  ]);

  return (
    <div className="flex h-screen overflow-hidden bg-[#f5f5f7]">
      <Sidebar
        workspaceName={workspaceName}
        userName={user.user_metadata?.full_name ?? user.email}
        userAvatar={user.user_metadata?.avatar_url ?? null}
        openCount={openCount ?? 0}
        projects={(projects ?? []) as { id: string; name: string }[]}
      />
      <main className="flex-1 overflow-y-auto">
        {children}
      </main>
    </div>
  );
}
