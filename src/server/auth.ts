import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { serverEnv } from "./env";
import { getPool } from "./db";
import { supabaseServer } from "@/lib/supabase/server";

export interface SessionUser {
  id: string;
  email: string | null;
}

const DEV_COOKIE = "tl_dev_session";

/* ---------------- DEV AUTH ADAPTER (local testing only; refused on Vercel/production by serverEnv) ---------------- */
function sign(value: string): string {
  return createHmac("sha256", serverEnv().DEV_AUTH_SECRET!).update(value).digest("hex");
}
async function devUser(): Promise<SessionUser | null> {
  const raw = (await cookies()).get(DEV_COOKIE)?.value;
  if (!raw) return null;
  const [id, sig] = raw.split(".");
  if (!id || !sig) return null;
  const expected = sign(id);
  if (expected.length !== sig.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) return null;
  const r = await getPool().query<{ email: string }>(`select email from auth.users where id = $1`, [id]);
  return r.rowCount ? { id, email: r.rows[0].email } : null;
}
async function setDevCookie(id: string) {
  (await cookies()).set(DEV_COOKIE, `${id}.${sign(id)}`, { httpOnly: true, sameSite: "lax", path: "/", secure: false, maxAge: 60 * 60 * 24 * 7 });
}
/* ------------------------------------------------------------------------------------------------------------------- */

/**
 * The signed-in user, resolved once per request (React cache): layouts and pages both call this.
 * getClaims() verifies the JWT signature locally against the project's JWKS (asymmetric signing keys), so it needs no
 * round trip to Supabase Auth; with legacy HS256 keys it falls back to getUser() (a network call), exactly as before.
 * Trade-off: a session revoked server-side stays valid until the access token expires (Supabase default 1 h).
 */
export const getUser = cache(async (): Promise<SessionUser | null> => {
  if (serverEnv().AUTH_MODE === "dev") return devUser();
  const supabase = await supabaseServer();
  const { data, error } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (error || !claims?.sub) return null;
  return { id: claims.sub, email: typeof claims.email === "string" ? claims.email : null };
});

export async function requireUser(next?: string): Promise<SessionUser> {
  const u = await getUser();
  if (!u) redirect(`/auth${next ? `?next=${encodeURIComponent(next)}` : ""}`);
  return u;
}

export async function signIn(email: string, password: string): Promise<{ error?: string }> {
  if (serverEnv().AUTH_MODE === "dev") {
    const r = await getPool().query<{ id: string }>(
      `select id from auth.users where email = lower($1) and encrypted_password = extensions.crypt($2, encrypted_password)`, [email, password]);
    if (!r.rowCount) return { error: "Email ou palavra-passe incorretos." };
    await setDevCookie(r.rows[0].id);
    return {};
  }
  const supabase = await supabaseServer();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  return error ? { error: error.message === "Invalid login credentials" ? "Email ou palavra-passe incorretos." : error.message } : {};
}

export async function signUp(email: string, password: string, displayName: string): Promise<{ error?: string; needsConfirmation?: boolean }> {
  if (serverEnv().AUTH_MODE === "dev") {
    try {
      const r = await getPool().query<{ id: string }>(
        `insert into auth.users (email, encrypted_password, raw_user_meta_data)
         values (lower($1), extensions.crypt($2, extensions.gen_salt('bf')), $3) returning id`,
        [email, password, JSON.stringify({ display_name: displayName })]);
      await setDevCookie(r.rows[0].id);
      return {};
    } catch {
      return { error: "Já existe uma conta com este email." };
    }
  }
  const supabase = await supabaseServer();
  const { data, error } = await supabase.auth.signUp({
    email, password,
    options: { data: { display_name: displayName }, emailRedirectTo: `${serverEnv().APP_BASE_URL}/auth/callback` },
  });
  if (error) return { error: error.message };
  return { needsConfirmation: !data.session };
}

export async function signOut() {
  if (serverEnv().AUTH_MODE === "dev") {
    (await cookies()).delete(DEV_COOKIE);
    return;
  }
  const supabase = await supabaseServer();
  await supabase.auth.signOut();
}
