import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export function supabaseEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  return { url, anonKey };
}

export function isSupabaseConfigured(): boolean {
  return supabaseEnv() !== null;
}

/**
 * Service-role key, or null.
 *
 * Server-only, and never returned to the browser: the anon client is the only
 * one built into anything under `src/lib/client`. Its one job is to create
 * already-confirmed accounts, because a Supabase project with no SMTP cannot
 * deliver the confirmation mail that `mailer_autoconfirm = false` demands — so
 * every new signup is created successfully and then locked out of signing in
 * forever. See /api/auth/password.
 */
export function serviceRoleKey(): string | null {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return key && key.trim().length > 0 ? key.trim() : null;
}

/**
 * Canonical origin for redirects that carry credentials or auth codes.
 * The `Origin` request header is caller-controlled, so a value taken from it
 * lets a hostile page aim an OAuth code at its own server. Prefer an
 * operator-configured site URL and fall back to the origin the platform
 * actually served, which is what the request URL reflects.
 */
export function canonicalOrigin(requestUrl: string): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL;
  if (configured) {
    try {
      return new URL(configured).origin;
    } catch {
      // Misconfigured; fall through to the request origin.
    }
  }
  return new URL(requestUrl).origin;
}

export async function createSupabaseServerClient() {
  const env = supabaseEnv();
  if (!env) return null;

  const cookieStore = await cookies();

  return createServerClient(env.url, env.anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Components cannot write cookies. The proxy
          // refreshes the session, so this is safe to ignore.
        }
      },
    },
  });
}
