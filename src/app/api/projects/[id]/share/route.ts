import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { projects } from "@/db/schema";
import { captchaEnforced, captchaErrorResponse, verifyCaptcha } from "@/lib/server/captcha";
import { canonicalOrigin } from "@/lib/server/supabase";
import { enforceRateLimit, hourlyLimit, rateLimitHeaders, rateLimitResponse } from "@/lib/server/rateLimit";
import { createShareLink, listShares, revokeAllShares } from "@/lib/server/shareLinks";
import { resolveWorkspace } from "@/lib/server/workspace";

export const dynamic = "force-dynamic";

/** Owner-only: list this project's live and revoked share links. */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const workspace = await resolveWorkspace();

  const [row] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, id), eq(projects.workspaceId, workspace.id)))
    .limit(1);
  if (!row) return Response.json({ error: "Project not found" }, { status: 404 });

  return Response.json({ shares: await listShares(id) });
}

/** Mints a new read-only link. The raw token is returned exactly once. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const verdict = await enforceRateLimit(request, "share-create", hourlyLimit("RATE_LIMIT_SHARE_PER_HOUR", 30));
  if (!verdict.allowed) return rateLimitResponse(verdict);

  // After the rate limit rather than before it. This endpoint is capped per-IP,
  // so a failed challenge cannot consume anyone else's allowance, and checking
  // the cheap local counter first keeps a flood from becoming a flood of
  // outbound hCaptcha calls.
  if (captchaEnforced()) {
    const body = (await request.json().catch(() => ({}))) as { captchaToken?: string };
    const captcha = await verifyCaptcha(body.captchaToken, request);
    if (!captcha.ok) return captchaErrorResponse(captcha.reason);
  }

  const workspace = await resolveWorkspace();
  const [row] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, id), eq(projects.workspaceId, workspace.id)))
    .limit(1);
  if (!row) return Response.json({ error: "Project not found" }, { status: 404 });

  const share = await createShareLink(id, canonicalOrigin(request.url));
  return Response.json(
    { share },
    { status: 201, headers: { ...rateLimitHeaders(verdict), "Cache-Control": "no-store" } },
  );
}

/** Revokes every live link for the project. */
export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const workspace = await resolveWorkspace();

  const [row] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, id), eq(projects.workspaceId, workspace.id)))
    .limit(1);
  if (!row) return Response.json({ error: "Project not found" }, { status: 404 });

  const revoked = await revokeAllShares(id);
  return Response.json({ revoked });
}
