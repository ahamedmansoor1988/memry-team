import { redirect } from "next/navigation";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { Sidebar } from "./_sidebar";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const { data: member } = await admin
    .from("workspace_members")
    .select("workspaces(id, name)")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!member?.workspaces) redirect("/onboarding");

  return (
    <div className="flex h-screen overflow-hidden bg-white">
      <Sidebar userEmail={user.email ?? ""} />
      <main className="flex-1 overflow-hidden">
        {children}
      </main>
    </div>
  );
}
