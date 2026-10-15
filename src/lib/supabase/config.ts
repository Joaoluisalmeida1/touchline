/**
 * Supabase public config. Accepts both our names and the names injected by the official
 * Supabase ↔ Vercel integration (NEXT_PUBLIC_SUPABASE_ANON_KEY).
 */
export function supabasePublicConfig(): { url: string; key: string } {
  return {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    key: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
  };
}
