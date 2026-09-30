import { sql } from "drizzle-orm";
import { db } from "@/db";
import { rateLimits } from "@/db/schema";

export interface RateLimitVerdict {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
}

const HOUR_MS = 3_600_000;
export const MINUTE_MS = 60_000;
let sweeps = 0;

function lastHop(value: string | null): string | null {
  if (!value) return null;
  const hops = value.split(",").map((hop) => hop.trim()).filter(Boolean);
  return hops.length > 0 ? hops[hops.length - 1] : null;
}

/**
 * Vercel populates x-vercel-forwarded-for and x-real-ip at the edge, so neither
 * can be set by the caller. A client that sends its own x-forwarded-for has it
 * appended to rather than replaced, which is why the last hop is the one to
 * trust. Revisit this if the app is ever hosted anywhere else.
 */
export function clientIp(request: Request): string {
  const headers = request.headers;
  const edge = lastHop(headers.get("x-vercel-forwarded-for") ?? headers.get("x-real-ip"));
  if (edge) return edge;
  return lastHop(headers.get("x-forwarded-for")) ?? "unknown";
}

/** Env-tunable so the caps can be tightened once a metered AI key is added. */
export function hourlyLimit(name: string, fallback: number): number {
  const parsed = process.env[name] ? Number(process.env[name]) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : fallback;
}

/**
 * Fixed window counted in Postgres. The increment is a single statement so two
 * concurrent requests cannot both read a count and each write their own copy of
 * the next number.
 *
 * Fails open on error. The endpoints being protected already require this same
 * database, so a failure here is not something the request could have survived,
 * and turning a blip into a total lockout would be strictly worse.
 *
 * Takes a pre-built bucket so callers can choose the axis: per-IP for cost
 * control, per-account for credential guessing.
 */
export async function enforceBucket(
  bucket: string,
  limit: number,
  windowMs: number,
): Promise<RateLimitVerdict> {
  const now = Date.now();
  const windowStart = Math.floor(now / windowMs) * windowMs;
  const resetAt = new Date(windowStart + windowMs);

  try {
    const rows = await db
      .insert(rateLimits)
      .values({ bucket, count: 1, resetAt })
      .onConflictDoUpdate({
        target: rateLimits.bucket,
        set: { count: sql`${rateLimits.count} + 1` },
      })
      .returning({ count: rateLimits.count });
    const count = rows[0]?.count ?? 1;
    // Awaited rather than left floating: a serverless function can be frozen
    // the moment the response is returned, which would silently skip the sweep.
    await sweepRateLimits();
    return {
      allowed: count <= limit,
      limit,
      remaining: Math.max(0, limit - count),
      retryAfterSeconds: Math.max(1, Math.ceil((resetAt.getTime() - now) / 1000)),
    };
  } catch (error) {
    console.error("rate limit check failed", error);
    return { allowed: true, limit, remaining: limit, retryAfterSeconds: 0 };
  }
}

/** Drops a counter outright, used to forgive a legitimate user on success. */
export async function clearBucket(bucket: string): Promise<void> {
  try {
    await db.delete(rateLimits).where(sql`${rateLimits.bucket} = ${bucket}`);
  } catch (error) {
    console.error("rate limit clear failed", error);
  }
}

/** Window start shared by a bucket key, so caller and counter agree on the clock. */
export function windowStartFor(windowMs: number): number {
  return Math.floor(Date.now() / windowMs) * windowMs;
}

/** Per-IP hourly cap, for endpoints whose cost is the thing being bounded. */
export function enforceRateLimit(
  request: Request,
  scope: string,
  limit: number,
): Promise<RateLimitVerdict> {
  return enforceBucket(`${scope}:${clientIp(request)}:${windowStartFor(HOUR_MS)}`, limit, HOUR_MS);
}

export function rateLimitHeaders(verdict: RateLimitVerdict): Record<string, string> {
  return {
    "X-RateLimit-Limit": String(verdict.limit),
    "X-RateLimit-Remaining": String(verdict.remaining),
  };
}

export function rateLimitResponse(verdict: RateLimitVerdict): Response {
  return Response.json(
    {
      error: "Too many requests. Wait a few minutes and try again.",
      code: "RATE_LIMITED",
    },
    {
      status: 429,
      headers: {
        ...rateLimitHeaders(verdict),
        "Retry-After": String(verdict.retryAfterSeconds),
      },
    },
  );
}

/**
 * Buckets are hourly, so everything before the current window is dead weight
 * that would otherwise accumulate forever. Cheaper to do opportunistically here
 * than to stand up a cron, and it self-tunes with traffic.
 */
export async function sweepRateLimits(): Promise<void> {
  sweeps += 1;
  if (sweeps % 50 !== 0) return;
  try {
    await db.delete(rateLimits).where(sql`${rateLimits.resetAt} <= now()`);
  } catch (error) {
    console.error("rate limit sweep failed", error);
  }
  // Reclaimed on the same trigger. Imported lazily because the workspace module
  // reaches back into this one, and a static cycle would leave one side of it
  // uninitialised depending on which module the runtime happens to load first.
  const { sweepAbandonedWorkspaces } = await import("./workspace");
  await sweepAbandonedWorkspaces();
}
