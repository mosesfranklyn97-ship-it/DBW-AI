import { createHash } from "node:crypto";
import {
  MINUTE_MS,
  clearBucket,
  clientIp,
  enforceBucket,
  windowStartFor,
  type RateLimitVerdict,
} from "./rateLimit";

/**
 * Credential guessing gets a much shorter window than the AI endpoints. Fifteen
 * minutes is short enough that a leaked password has a small shelf life, and
 * long enough that someone fumbling their own password is not punished.
 */
const WINDOW_MS = 15 * MINUTE_MS;

function limitFor(name: string, fallback: number): number {
  const parsed = process.env[name] ? Number(process.env[name]) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : fallback;
}

/**
 * Hashed rather than stored plainly: this table is swept opportunistically and
 * dumped during debugging, and it has no business being a roster of which
 * addresses hold accounts here.
 */
function emailBucket(email: string): string {
  const digest = createHash("sha256").update(email.trim().toLowerCase()).digest("hex").slice(0, 32);
  return `auth-email:${digest}:${windowStartFor(WINDOW_MS)}`;
}

/**
 * Two independent budgets, and a caller has to pass both.
 *
 * Per-IP alone is defeated by a botnet; per-account alone lets an attacker lock
 * a known email out of its own login by failing it deliberately. Requiring both
 * means a distributed attempt is stopped by the account budget while a
 * single-source flood is stopped by the IP budget.
 *
 * The IP budget is the looser of the two because whole offices, schools and
 * carrier NATs share one address, and none of their users should be able to lock
 * each other out.
 */
export async function enforceAuthAttempt(
  request: Request,
  email: string,
): Promise<RateLimitVerdict> {
  const ipBudget = await enforceBucket(
    `auth-ip:${clientIp(request)}:${windowStartFor(WINDOW_MS)}`,
    limitFor("RATE_LIMIT_AUTH_IP", 30),
    WINDOW_MS,
  );
  if (!ipBudget.allowed) return ipBudget;

  const accountBudget = await enforceBucket(
    emailBucket(email),
    limitFor("RATE_LIMIT_AUTH_EMAIL", 10),
    WINDOW_MS,
  );
  return accountBudget.allowed ? ipBudget : accountBudget;
}

/**
 * Wipes the account budget once a login succeeds, so a real user who fumbled
 * their password twice is not left rationed for the rest of the window. The IP
 * budget is deliberately *not* forgiven: it measures traffic, and on a shared
 * NAT one person's success must not hand the whole building a fresh allowance.
 */
export async function forgiveAuthAccount(email: string): Promise<void> {
  await clearBucket(emailBucket(email));
}
