import { createClient } from "@supabase/supabase-js";
import { enforceAuthAttempt, forgiveAuthAccount } from "@/lib/server/authRateLimit";
import { captchaEnforced, captchaErrorResponse, verifyCaptcha } from "@/lib/server/captcha";
import { createSupabaseServerClient, serviceRoleKey, supabaseEnv } from "@/lib/server/supabase";

export const dynamic = "force-dynamic";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * GoTrue phrases duplicate signups differently depending on whether the address
 * is already known, and `createUser` has its own wording. Everything that could
 * leak account existence is funnelled through this one test.
 */
const ALREADY_REGISTERED = /already registered|already been registered|already exists|already been created/i;

/** Only same-site absolute paths survive; "//evil.com" and absolute URLs do not. */
function safeNext(raw: unknown): string {
  if (typeof raw !== "string") return "/projects";
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return "/projects";
  return raw;
}

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return Response.json(
      { error: "Supabase is not configured. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY." },
      { status: 503 },
    );
  }

  const body = (await request.json().catch(() => ({}))) as {
    action?: string;
    email?: string;
    password?: string;
    next?: string;
    captchaToken?: string;
  };

  const action = body.action === "signup" ? "signup" : "signin";
  const email = (body.email ?? "").trim().toLowerCase();
  const password = body.password ?? "";

  if (!EMAIL_PATTERN.test(email)) {
    return Response.json({ error: "Enter a valid email address." }, { status: 400 });
  }
  if (password.length < 8) {
    return Response.json({ error: "Password must be at least 8 characters." }, { status: 400 });
  }

  // Before the auth budget, and deliberately so. A wrong or missing captcha is
  // the one failure a bot can trigger at will, and charging it to the per-account
  // budget would let anyone exhaust a real user's allowance and lock them out of
  // their own login just by failing the challenge repeatedly.
  if (captchaEnforced()) {
    const captcha = await verifyCaptcha(body.captchaToken, request);
    if (!captcha.ok) return captchaErrorResponse(captcha.reason);
  }

  /**
   * GoTrue runs its own captcha check when CAPTCHA is switched on in the
   * project's Auth settings, and it wants the token in
   * `gotrue_meta_security.captcha_token`, which is what `options.captchaToken`
   * maps to. So the token is forwarded rather than swallowed here.
   *
   * Only when this server did not verify it first, though: an hCaptcha token is
   * good for exactly one verification, and a deployment that has both a secret
   * here and CAPTCHA enabled in the Dashboard would otherwise hand GoTrue a token
   * this route had already spent, and fail the sign-in as a bad solve. Not
   * enforcing is the same state that leaves us no secret to spend, so the two
   * cases line up exactly.
   */
  const gotrueCaptcha = captchaEnforced() ? undefined : body.captchaToken;

  // After the cheap shape checks, before anything reaches Supabase. The email is
  // needed to pick the per-account budget, so the body has to be read first.
  const attempt = await enforceAuthAttempt(request, email);
  if (!attempt.allowed) {
    return Response.json(
      {
        error: "Too many attempts. Wait a few minutes and try again.",
        code: "RATE_LIMITED",
      },
      {
        status: 429,
        headers: {
          "Retry-After": String(attempt.retryAfterSeconds),
          "X-RateLimit-Remaining": String(attempt.remaining),
        },
      },
    );
  }

  if (action === "signup") {
    const origin = new URL(request.url).origin;

    /**
     * Fast path, taken whenever a service-role key is configured.
     *
     * GoTrue will only return a session from signUp when the address is already
     * confirmed. With `mailer_autoconfirm = false` it never is, and the
     * confirmation mail it promises cannot actually be delivered on a project
     * with no SMTP provider attached — so the account gets created and the user
     * is then permanently unable to sign in. Creating the user pre-confirmed is
     * the same outcome as turning "Confirm email" off in the Dashboard, but it
     * is a per-deployment setting rather than a code path that has to remember
     * to stay in step with it.
     */
    const roleKey = serviceRoleKey();
    if (roleKey) {
      const env = supabaseEnv();
      if (env) {
        const admin = createClient(env.url, roleKey, {
          auth: { autoRefreshToken: false, persistSession: false },
        });
        const { error: createError } = await admin.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
        });

        if (!createError) {
          const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
          if (!signInError) {
            await forgiveAuthAccount(email);
            return Response.json({ ok: true, confirmed: true, next: safeNext(body.next) });
          }
          // The account exists and is confirmed, so this is transient rather
          // than wrong: fall through and let the caller sign in normally.
        } else if (!ALREADY_REGISTERED.test(createError.message)) {
          return Response.json({ error: createError.message }, { status: 400 });
        }
      }
    }

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: `${origin}/auth/callback`, captchaToken: gotrueCaptcha },
    });

    if (error) {
      // Supabase's "already registered" would otherwise turn signup into a
      // membership oracle: anyone could enumerate which addresses hold
      // accounts. Answer exactly as a fresh signup would.
      if (ALREADY_REGISTERED.test(error.message)) {
        return Response.json({
          ok: true,
          confirmed: false,
          error: "Account created. Check your inbox to confirm the address, then sign in.",
        });
      }
      return Response.json({ error: error.message }, { status: 400 });
    }

    // Supabase returns no session when email confirmation is switched on.
    if (data.session) return Response.json({ ok: true, confirmed: true });

    return Response.json({
      ok: true,
      confirmed: false,
      error: "Account created. Check your inbox to confirm the address, then sign in.",
    });
  }

  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
    options: { captchaToken: gotrueCaptcha },
  });
  if (error) {
    const message =
      error.message === "Invalid login credentials"
        ? "That email and password combination is not recognised."
        : error.message;
    return Response.json({ error: message }, { status: 401 });
  }

  // Proven beyond doubt that whoever holds this password is them, so the failed
  // attempts leading up to it should not keep counting against them.
  await forgiveAuthAccount(email);

  return Response.json({ ok: true, confirmed: true, next: safeNext(body.next) });
}
