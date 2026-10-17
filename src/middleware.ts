import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { supabasePublicConfig } from "./lib/supabase/config";

/**
 * Refreshes the Supabase session cookie on navigation (no-op in local dev-auth mode).
 * Router prefetches are skipped: they render no user data, and the real navigation that follows refreshes the session.
 * getClaims() refreshes an expired token and verifies the JWT locally (asymmetric keys) instead of calling Supabase Auth.
 */
export async function middleware(request: NextRequest) {
  const response = NextResponse.next({ request });
  if (request.headers.has("next-router-prefetch")) return response;
  const { url, key } = supabasePublicConfig();
  if (process.env.AUTH_MODE === "dev" || !url || !key) return response;
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        for (const { name, value, options } of list) response.cookies.set(name, value, options);
      },
    },
  });
  await supabase.auth.getClaims();
  return response;
}

// static files in public/ (service worker, icons) never need a session
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/health|api/cron|.*\\.(?:js|svg|png|jpg|jpeg|gif|webp|ico|webmanifest|txt)$).*)"],
};
