import { getProviderStatus } from "@/lib/server/authProviders";
import { canonicalOrigin, createSupabaseServerClient } from "@/lib/server/supabase";

export const dynamic = "force-dynamic";

const PROVIDERS = { google: "google" } as const;

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return Response.json(
      { error: "Supabase is not configured. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY." },
      { status: 503 },
    );
  }

  const url = new URL(request.url);
  const requested = (request.headers.get("x-provider") ?? url.searchParams.get("provider") ?? "google") as keyof typeof PROVIDERS;
  const provider = PROVIDERS[requested];
  if (!provider) {
    return Response.json({ error: "Unsupported provider" }, { status: 400 });
  }

  // A disabled provider still yields a valid-looking authorize URL, and the
  // failure only surfaces as a redirect error from Supabase after the user has
  // already been handed off. Refuse here instead, with something actionable.
  const status = await getProviderStatus();
  if (!status[provider].enabled) {
    return Response.json(
      { error: "Google sign-in is not enabled on this site. Use your email and password instead." },
      { status: 503 },
    );
  }

  const next = url.searchParams.get("next");
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : "/projects";
  const origin = canonicalOrigin(url.href);

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo: `${origin}/auth/callback?next=${encodeURIComponent(safeNext)}`,
    },
  });

  if (error) return Response.json({ error: error.message }, { status: 400 });
  return Response.json({ url: data.url });
}
