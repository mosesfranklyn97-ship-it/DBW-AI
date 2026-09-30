import { clientIp } from "./rateLimit";

/**
 * hCaptcha verification.
 *
 * Client-side captcha is decoration: a bot posts straight to the API and never
 * loads the widget, so the only meaningful check is this one. The widget proves
 * a human solved a challenge; the token it produces is handed to the server,
 * which asks hCaptcha directly whether that token is genuine.
 *
 * Both halves are configured together or not at all. `NEXT_PUBLIC_*` variables
 * are readable on the server as well as inlined into the browser bundle, so
 * requiring the pair here keeps the two sides in step:
 *
 *   - site key only  -> the widget draws, the server ignores the token. Noisy,
 *                       but harmless, and nothing is silently unprotected in a
 *                       way that would lock anyone out.
 *   - secret only    -> the server would demand a token the browser has no way
 *                       to produce, and every sign-in would fail. This is the
 *                       dangerous half-configured state, so it is refused.
 *
 * The mode is deliberately off-by-default: an unconfigured deployment keeps
 * working on its existing rate limits rather than bricking sign-in.
 */

const VERIFY_URL = "https://api.hcaptcha.com/siteverify";

/** hCaptcha's own guidance; anything longer is the widget hanging, not latency. */
const TIMEOUT_MS = 10_000;

export type CaptchaFailure =
  /** No token in the request, so the widget was skipped or the solve expired. */
  | "missing"
  /** hCaptcha answered, and the token did not pass. */
  | "invalid"
  /** hCaptcha could not be asked at all, so no verdict exists either way. */
  | "unavailable";

export type CaptchaVerdict = { ok: true } | { ok: false; reason: CaptchaFailure };

function siteKey(): string {
  return process.env.NEXT_PUBLIC_HCAPTCHA_SITE_KEY ?? "";
}

function secret(): string {
  return process.env.HCAPTCHA_SECRET ?? "";
}

/**
 * True only when the feature is fully configured.
 *
 * Note the asymmetry with the client, which renders the widget on the site key
 * alone. A site key without a secret therefore shows a challenge whose answer is
 * not checked, which is the safe direction to be wrong in: it looks protected and
 * behaves normally, rather than demanding something impossible.
 */
export function captchaEnforced(): boolean {
  return siteKey().length > 0 && secret().length > 0;
}

/**
 * Asks hCaptcha whether a token is real.
 *
 * Fails closed when hCaptcha cannot be reached. On an endpoint that gates
 * credential guessing, "we could not check" must not be treated as "the check
 * passed", or an attacker only has to wait for an outage. The trade is that a
 * sustained hCaptcha outage blocks sign-in, which is why the caller is expected
 * to surface this as a 503 "try again" rather than a wrong-password error.
 */
export async function verifyCaptcha(
  token: string | undefined,
  request: Request,
): Promise<CaptchaVerdict> {
  if (!captchaEnforced()) return { ok: true };

  const value = token?.trim();
  if (!value) return { ok: false, reason: "missing" };

  const form = new URLSearchParams({
    secret: secret(),
    response: value,
    // Sent on hCaptcha's recommendation. It is advisory only - hCaptcha does not
    // reject a mismatch - so it must never be treated as a security boundary.
    remoteip: clientIp(request),
    sitekey: siteKey(),
  });

  try {
    const response = await fetch(VERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!response.ok) return { ok: false, reason: "unavailable" };

    const payload = (await response.json()) as {
      success?: boolean;
      "error-codes"?: string[];
    };

    if (payload.success === true) return { ok: true };

    // `invalid-input-secret` is a deployment mistake rather than a bad solve, and
    // reporting it as a failed captcha would send the user round the loop forever.
    // Log it plainly so the cause is visible instead of guessed at.
    const codes = payload["error-codes"] ?? [];
    if (codes.includes("invalid-input-secret") || codes.includes("missing-input-secret")) {
      console.error("hCaptcha rejected HCAPTCHA_SECRET; check it against the site key", codes);
      return { ok: false, reason: "unavailable" };
    }

    return { ok: false, reason: "invalid" };
  } catch (error) {
    // Timeout or DNS/network failure. Never booleans this into a pass.
    console.error("hCaptcha verification could not be completed", error);
    return { ok: false, reason: "unavailable" };
  }
}

/** User-facing copy, and the status each failure deserves. */
export function captchaErrorResponse(reason: CaptchaFailure): Response {
  if (reason === "unavailable") {
    return Response.json(
      {
        error: "We could not check that you are human just now. Try again in a moment.",
        code: "CAPTCHA_UNAVAILABLE",
      },
      { status: 503 },
    );
  }
  return Response.json(
    {
      error: "Please complete the challenge to prove you are human, then try again.",
      code: "CAPTCHA",
    },
    // 400 rather than 401/403: the request is malformed for want of a token, and
    // a distinctive code lets the client reset the widget and re-solve.
    { status: 400 },
  );
}
