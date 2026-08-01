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

  const { pathname } = request.nextUrl;

  // Temporarily hidden agents — code stays in the repo, but the routes are
  // unreachable (no nav link, and direct URLs bounce away) so they can be
  // brought back later without rebuilding anything.
  const HIDDEN_AGENT_PATHS = ["/agents/screenshot-diff"];
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
    pathname.startsWith("/privacy");
  const isApiRoute = pathname.startsWith("/api/");

  // Only hit Supabase when the auth state actually affects routing (protected
  // pages, or auth pages that bounce logged-in users). Public pages and API
  // routes skip the network call entirely. Cap the call at 5s so a slow or
  // paused Supabase project can't hang the middleware past Vercel's limit
  // (MIDDLEWARE_INVOCATION_TIMEOUT would take down every route).
  const needsUser = isAuthPage || (!isPublicPage && !isApiRoute);
  let user = null;
  if (needsUser) {
    try {
      const result = await Promise.race([
        supabase.auth.getUser(),
        new Promise<{ data: { user: null } }>((resolve) =>
          setTimeout(() => resolve({ data: { user: null } }), 5000)
        ),
      ]);
      user = result.data.user;
    } catch {
      user = null;
    }
  }

  if (!user && !isAuthPage && !isPublicPage && !isApiRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    url.searchParams.set("redirect", `${pathname}${request.nextUrl.search}`);
    return NextResponse.redirect(url);
  }

  if (user && isAuthPage) {
    const url = request.nextUrl.clone();
    const redirectParam = request.nextUrl.searchParams.get("redirect");
    const next =
      redirectParam?.startsWith("/invite/") || redirectParam?.startsWith("/agents/")
        ? redirectParam
        : "/agents/figma-compare";
    const destination = new URL(next, request.nextUrl.origin);
    url.pathname = destination.pathname;
    url.search = destination.search;
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
