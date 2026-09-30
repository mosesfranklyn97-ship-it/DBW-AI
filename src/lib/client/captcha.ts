/**
 * The hCaptcha site key, and whether a widget is worth drawing at all.
 *
 * `@hcaptcha/react-hcaptcha` is rendered directly by the two screens that gate
 * on a human solving a challenge - sign-in/sign-up and share-link creation - and
 * both need this same pair of answers, so it lives here rather than being
 * re-derived per component.
 *
 * The key is inlined at build time, so a change needs a rebuild.
 *
 * Note the asymmetry with the server (see `lib/server/captcha.ts`), which
 * enforces only when the site key *and* the secret are present. A site key
 * without a secret therefore draws a challenge whose answer is never checked,
 * which is the safe direction to be wrong in: it looks protected and behaves
 * normally, rather than demanding something impossible.
 */

const SITE_KEY = process.env.NEXT_PUBLIC_HCAPTCHA_SITE_KEY ?? "";

export function captchaSiteKey(): string {
  return SITE_KEY;
}

export function captchaConfigured(): boolean {
  return SITE_KEY.length > 0;
}
