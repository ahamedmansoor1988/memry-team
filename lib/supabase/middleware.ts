import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest) {
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-pathname", request.nextUrl.pathname);

  let supabaseResponse = NextResponse.next({
    request: { headers: requestHeaders },
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll(); },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({
            request: { headers: requestHeaders },
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  // Temporarily hidden agents — code stays in the repo, but the routes are
  // unreachable (no nav link, and direct URLs bounce away) so they can be
  // brought back later without rebuilding anything.
  const HIDDEN_AGENT_PATHS = ["/agents/responsive", "/agents/screenshot-diff"];
  if (HIDDEN_AGENT_PATHS.includes(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/agents/accessibility";
    return NextResponse.redirect(url);
  }

  const isAuthPage = pathname.startsWith("/login") || pathname.startsWith("/auth");
  const isPublicPage =
    pathname === "/" ||
    pathname.startsWith("/share") ||
    pathname.startsWith("/report") ||
    pathname.startsWith("/onboarding") ||
    pathname.startsWith("/invite") ||
    pathname.startsWith("/pricing") ||
    pathname.startsWith("/terms") ||
    pathname.startsWith("/privacy") ||
    pathname === "/agents/accessibility";
  const isApiRoute = pathname.startsWith("/api/");

  if (!user && !isAuthPage && !isPublicPage && !isApiRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  if (user && isAuthPage) {
    const url = request.nextUrl.clone();
    url.pathname = "/agents/figma-compare";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
