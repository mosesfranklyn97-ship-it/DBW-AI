import { enforceAuthAttempt } from "@/lib/server/authRateLimit";
import { createSupabaseServerClient } from "@/lib/server/supabase";

export const dynamic = "force-dynamic";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Re-sends the confirmation mail for an address that signed up before
 * SUPABASE_SERVICE_ROLE_KEY was configured, so those stranded accounts are not
 * left with no way back in.
 *
 * GoTrue answers identically whether or not the address exists, and the answer
 * here is the same in both cases too. Reporting the difference would turn this
 * into a membership oracle.
 */
export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return Response.json({ error: "Supabase is not configured." }, { status: 503 });
  }

  const body = (await request.json().catch(() => ({}))) as { email?: string };
  const email = (body.email ?? "").trim().toLowerCase();
  if (!EMAIL_PATTERN.test(email)) {
    return Response.json({ error: "Enter a valid email address." }, { status: 400 });
  }

  const attempt = await enforceAuthAttempt(request, email);
  if (!attempt.allowed) {
    return Response.json(
      { error: "Too many attempts. Wait a few minutes and try again.", code: "RATE_LIMITED" },
      { status: 429, headers: { "Retry-After": String(attempt.retryAfterSeconds) } },
    );
  }

  const origin = new URL(request.url).origin;
  const { error } = await supabase.auth.resend({
    type: "signup",
    email,
    options: { emailRedirectTo: `${origin}/auth/callback` },
  });

  // A missing account is not an error worth surfacing, and neither is a project
  // that cannot send mail at all — both come back as the same neutral answer.
  if (error && !/not found|does not exist|signups not allowed/i.test(error.message)) {
    return Response.json({ error: error.message }, { status: 400 });
  }

  return Response.json({ ok: true, sent: true });
}
