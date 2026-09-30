import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Signs short-lived payloads so a client can hand back exactly what the server
 * computed. The diff preview uses this to guarantee that what a reviewer
 * approves is byte-for-byte what gets written, instead of recomputing an
 * LLM answer and hoping it comes out the same twice.
 */

const FALLBACK_SECRET = "dbw-ai-unsigning-secret";

function secret(): string {
  // APP_SIGNING_SECRET is preferred so tokens survive a service-role rotation.
  const explicit = process.env.APP_SIGNING_SECRET?.trim();
  if (explicit) return explicit;
  // The service-role key is always present in production; deriving keeps
  // deployments working before anyone bothers to set the dedicated variable.
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (serviceRole) return serviceRole;
  return FALLBACK_SECRET;
}

function key(): Buffer {
  return Buffer.from(secret(), "utf8");
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function sign(data: string): string {
  return createHmac("sha256", key()).update(data).digest("base64url");
}

/**
 * Encodes `payload` with an expiry and returns `body.signature`. Both parts are
 * base64url so the result is safe to put in a JSON body or a query string.
 */
export function signToken<T extends object>(payload: T, ttlMs: number): string {
  const body = b64url(JSON.stringify({ ...payload, exp: Date.now() + ttlMs }));
  return `${body}.${sign(body)}`;
}

export type VerifyResult<T> = { ok: true; payload: T } | { ok: false; reason: "malformed" | "signature" | "expired" };

/**
 * Checks shape, signature, then expiry. The signature comparison is
 * length-checked first because `timingSafeEqual` throws on a length mismatch,
 * and a wrong-length body is a malformed token, not a forgery attempt.
 */
export function verifyToken<T>(token: string): VerifyResult<T> {
  const dot = token.lastIndexOf(".");
  if (dot <= 0 || dot === token.length - 1) return { ok: false, reason: "malformed" };
  const body = token.slice(0, dot);
  const signature = token.slice(dot + 1);

  const expected = Buffer.from(sign(body), "utf8");
  const received = Buffer.from(signature, "utf8");
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
    return { ok: false, reason: "signature" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "malformed" };
  }

  const exp = (parsed as { exp?: unknown }).exp;
  if (typeof exp !== "number" || !Number.isFinite(exp) || Date.now() > exp) {
    return { ok: false, reason: "expired" };
  }

  return { ok: true, payload: parsed as T };
}

/** URL-safe random secret for share links. 32 bytes of CSPRNG entropy. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}
