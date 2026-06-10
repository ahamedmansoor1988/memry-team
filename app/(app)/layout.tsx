import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Sidebar from "@/components/layout/Sidebar";
import SearchBar from "@/components/layout/SearchBar";
import NotificationBell from "@/components/layout/NotificationBell";

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

  if (!membership) {
    // Check for pending invite matching this user's email
    const { data: pendingInvite } = await admin
      .from("workspace_invites")
      .select("token")
      .eq("email", user.email ?? "")
      .is("accepted_at", null)
      .gt("expires_at", new Date().toISOString())
      .limit(1)
      .single();
    if (pendingInvite) {
      redirect(`/invite/${(pendingInvite as { token: string }).token}`);
    }
    redirect("/onboarding");
  }

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
    <div className="flex h-screen overflow-hidden bg-white">
      <Sidebar
        workspaceName={workspaceName}
        userName={user.user_metadata?.full_name ?? user.email}
        userAvatar={user.user_metadata?.avatar_url ?? null}
        openCount={openCount ?? 0}
      />
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top bar */}
        <div className="h-12 border-b border-zinc-100 bg-white flex items-center px-6 gap-3 shrink-0">
          <SearchBar />
          <div className="ml-auto flex items-center gap-1">
            <NotificationBell />
          </div>
        </div>
        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
