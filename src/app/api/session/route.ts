import { aiProviderName, voiceProviderAvailable } from "@/lib/ai/provider";
import { resolveWorkspace, setWorkspacePlan } from "@/lib/server/workspace";
import { enforceRateLimit, hourlyLimit, rateLimitHeaders, rateLimitResponse } from "@/lib/server/rateLimit";
import { isSupabaseConfigured } from "@/lib/server/supabase";
import type { Plan } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * There is no payment provider wired up, so a self-serve POST here would let
 * anyone grant themselves the paid tiers. Upgrades therefore stay switched
 * off until an operator opts in, and can be narrowed to specific accounts
 * with ALLOWED_PRICE_EMAILS. Downgrading to "free" is always allowed.
 */
function upgradeAllowed(email: string | null): boolean {
  if (process.env.ALLOW_PLAN_UPGRADES !== "true") return false;
  const allowlist = (process.env.ALLOWED_PRICE_EMAILS ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  if (allowlist.length === 0) return true;
  return email !== null && allowlist.includes(email.toLowerCase());
}

/**
 * Every visitor without a cookie gets a workspaces row written for them, which
 * is what makes their projects survive a restart. That also makes this the one
 * unauthenticated endpoint that creates rows on a plain GET, so it would
 * otherwise hand an attacker unbounded storage growth while sidestepping the
 * caps on the endpoints that actually do work. The limit is deliberately loose:
 * ordinary use is a handful of calls, and the goal is to cap the flood rather
 * than to police navigation.
 */
export async function GET(request: Request) {
  const verdict = await enforceRateLimit(request, "session", hourlyLimit("RATE_LIMIT_SESSION_PER_HOUR", 300));
  if (!verdict.allowed) return rateLimitResponse(verdict);

  const workspace = await resolveWorkspace();
  return Response.json(
    {
      workspaceId: workspace.id,
      plan: workspace.plan,
      authenticated: workspace.authenticated,
      user: workspace.user,
      projectsThisMonth: workspace.projectsThisMonth,
      limits: workspace.limits,
      auth: { provider: isSupabaseConfigured() ? "supabase" : null },
      ai: {
        brain: aiProviderName() ?? "zerobox-engine",
        llm: Boolean(aiProviderName()),
        whisper: voiceProviderAvailable(),
      },
      upgradesEnabled: upgradeAllowed(workspace.user?.email ?? null),
    },
    { headers: rateLimitHeaders(verdict) },
  );
}

export async function POST(request: Request) {
  const workspace = await resolveWorkspace();
  const body = (await request.json().catch(() => ({}))) as { plan?: string };
  const plan = body.plan;
  if (plan !== "free" && plan !== "monthly" && plan !== "yearly") {
    return Response.json({ error: "Invalid plan" }, { status: 400 });
  }

  if (plan !== "free" && !upgradeAllowed(workspace.user?.email ?? null)) {
    return Response.json(
      {
        error:
          "Self-serve upgrades are not enabled on this deployment. Set ALLOW_PLAN_UPGRADES=true (and optionally ALLOWED_PRICE_EMAILS) to allow them.",
        code: "UPGRADE_DISABLED",
      },
      { status: 403 },
    );
  }

  await setWorkspacePlan(workspace.id, plan as Plan);
  return Response.json({ ok: true, plan });
}
