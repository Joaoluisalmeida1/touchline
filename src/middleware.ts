import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { supabasePublicConfig } from "./lib/supabase/config";

/** Refreshes the Supabase session cookie on navigation (no-op in local dev-auth mode). */
export async function middleware(request: NextRequest) {
  const response = NextResponse.next({ request });
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
  await supabase.auth.getUser();
  return response;
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|api/health|api/cron).*)"] };
