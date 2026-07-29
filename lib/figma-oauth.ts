import { createClient } from "@supabase/supabase-js";

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

export interface FigmaConnection {
  connected: boolean;
  figmaUserEmail: string | null;
}

export async function getFigmaConnectionStatus(userId: string): Promise<FigmaConnection> {
  const { data } = await admin()
    .from("figma_connections")
    .select("figma_user_email")
    .eq("user_id", userId)
    .maybeSingle();
  return { connected: Boolean(data), figmaUserEmail: data?.figma_user_email ?? null };
}

export async function disconnectFigma(userId: string) {
  await admin().from("figma_connections").delete().eq("user_id", userId);
}

/** Returns a live access token for the user, refreshing it first if it's expired. Null if never connected or the refresh itself fails (token revoked). */
export async function getValidFigmaAccessToken(userId: string): Promise<string | null> {
  const db = admin();
  const { data: conn } = await db
    .from("figma_connections")
    .select("access_token, refresh_token, expires_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (!conn) return null;

  // Refresh a bit early (60s) rather than right at the boundary.
  if (new Date(conn.expires_at).getTime() > Date.now() + 60_000) {
    return conn.access_token;
  }

  const res = await fetch("https://api.figma.com/v1/oauth/refresh", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.FIGMA_CLIENT_ID!,
      client_secret: process.env.FIGMA_CLIENT_SECRET!,
      refresh_token: conn.refresh_token,
    }),
  });
  if (!res.ok) return null;

  const refreshed = await res.json() as { access_token: string; expires_in: number };
  await db.from("figma_connections").update({
    access_token: refreshed.access_token,
    expires_at: new Date(Date.now() + refreshed.expires_in * 1000).toISOString(),
  }).eq("user_id", userId);

  return refreshed.access_token;
}
