import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { Sidebar } from "./_sidebar";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const pathname = headers().get("x-pathname") ?? "";
  const isPublicAgent = pathname === "/agents/responsive" || pathname === "/agents/accessibility" || pathname === "/agents/screenshot-diff";
  if (!user && !isPublicAgent) redirect("/login");

  return (
    <div className="flex h-screen overflow-hidden bg-white">
      <Sidebar userEmail={user?.email ?? "Guest"} />
      <main className="flex-1 overflow-hidden">
        {children}
      </main>
    </div>
  );
}
