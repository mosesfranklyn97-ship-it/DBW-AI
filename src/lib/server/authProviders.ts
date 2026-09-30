import { supabaseEnv } from "./supabase";

export interface ProviderStatus {
  email: { enabled: boolean; requiresConfirmation: boolean };
  google: { enabled: boolean };
  /** False when GoTrue could not be asked, so callers must not assume anything. */
  reachable: boolean;
}

const UNREACHABLE: ProviderStatus = {
  email: { enabled: true, requiresConfirmation: true },
  google: { enabled: false },
  reachable: false,
};

// GoTrue's own settings endpoint changes only when someone edits the Dashboard,
// and this sits on the path of every login page view. A short TTL keeps that
// from becoming a request per render without ever serving a stale "disabled"
// verdict long enough to strand a user mid sign-in.
const TTL_MS = 60_000;
let cached: { value: ProviderStatus; expires: number } | null = null;

/**
 * Asks GoTrue which sign-in methods are actually switched on.
 *
 * This exists because a provider that is off still produces a well-formed
 * authorize URL. Handing that to a browser sends the user through a redirect
 * that Google completes happily and Supabase then rejects, which surfaces as a
 * bare error page rather than anything resembling "this method is unavailable".
 */
export async function getProviderStatus(): Promise<ProviderStatus> {
  const env = supabaseEnv();
  if (!env) return UNREACHABLE;
  if (cached && cached.expires > Date.now()) return cached.value;

  try {
    const response = await fetch(`${env.url}/auth/v1/settings`, {
      headers: { apikey: env.anonKey, Authorization: `Bearer ${env.anonKey}` },
      cache: "no-store",
    });
    if (!response.ok) return UNREACHABLE;

    const settings = (await response.json()) as {
      external?: { email?: boolean; google?: boolean };
      mailer_autoconfirm?: boolean;
      disable_signup?: boolean;
    };

    const value: ProviderStatus = {
      email: {
        enabled: settings.external?.email !== false && settings.disable_signup !== true,
        requiresConfirmation: settings.mailer_autoconfirm === false,
      },
      google: { enabled: settings.external?.google === true },
      reachable: true,
    };
    cached = { value, expires: Date.now() + TTL_MS };
    return value;
  } catch {
    return UNREACHABLE;
  }
}
