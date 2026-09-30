import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { and, count, eq, gte, isNull, lt, notExists, sql } from "drizzle-orm";
import { db } from "@/db";
import { projects, workspaces } from "@/db/schema";
import { createSupabaseServerClient } from "@/lib/server/supabase";
import { PLAN_LIMITS, type Plan } from "@/lib/types";

const WORKSPACE_COOKIE = "dbw-workspace";
const ONE_YEAR = 60 * 60 * 24 * 365;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

// The cookie is attacker-controlled, so it is only honoured when it is
// exactly the shape newWorkspaceId() produces. Anything else is discarded
// and replaced with a fresh id.
const WORKSPACE_ID_PATTERN = /^ws-[0-9a-f]{24}$/;

export interface AuthUser {
  id: string;
  email: string | null;
}

export interface WorkspaceContext {
  id: string;
  plan: Plan;
  authenticated: boolean;
  user: AuthUser | null;
  projectsThisMonth: number;
  limits: (typeof PLAN_LIMITS)[Plan];
}

function toPlan(stored: string): Plan {
  return stored === "monthly" || stored === "yearly" ? stored : "free";
}

function newWorkspaceId(): string {
  return `ws-${randomUUID().replace(/-/g, "").slice(0, 24)}`;
}

function isWorkspaceId(value: string | null | undefined): value is string {
  return typeof value === "string" && WORKSPACE_ID_PATTERN.test(value);
}

async function currentUser(): Promise<AuthUser | null> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return null;
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  return { id: user.id, email: user.email ?? null };
}

/**
 * Moves databases built before signing in over to the account. Revisions
 * point at project ids, so they follow along untouched.
 *
 * Only ever sources from an anonymous workspace (user_id IS NULL). The cookie
 * names the source, so without this check a crafted cookie could re-point
 * another account's projects at the caller's new workspace.
 */
async function claimAnonymousProjects(fromId: string, toId: string): Promise<void> {
  if (fromId === toId || !isWorkspaceId(fromId)) return;

  const [source] = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(and(eq(workspaces.id, fromId), isNull(workspaces.userId)))
    .limit(1);
  if (!source) return;

  await db.transaction(async (tx) => {
    await tx.update(projects).set({ workspaceId: toId }).where(eq(projects.workspaceId, fromId));
    await tx
      .delete(workspaces)
      .where(and(eq(workspaces.id, fromId), isNull(workspaces.userId)));
  });
}

/**
 * workspaces.user_id is unique, so two concurrent requests for the same fresh
 * account race on the insert. Only the winner may keep its generated id —
 * the loser has to adopt the row that actually landed, otherwise it would go
 * on to write projects against a workspace id that does not exist.
 */
async function ensureUserWorkspace(
  userId: string,
): Promise<{ id: string; plan: Plan }> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const candidate = newWorkspaceId();
    const inserted = await db
      .insert(workspaces)
      .values({ id: candidate, userId, plan: "free" })
      .onConflictDoNothing()
      .returning({ id: workspaces.id });

    if (inserted.length > 0) return { id: inserted[0].id, plan: "free" };

    const [owned] = await db
      .select()
      .from(workspaces)
      .where(eq(workspaces.userId, userId))
      .limit(1);
    if (owned) return { id: owned.id, plan: toPlan(owned.plan) };
  }

  throw new Error("Could not provision a workspace for this account");
}

export async function resolveWorkspace(): Promise<WorkspaceContext> {
  const cookieStore = await cookies();
  const user = await currentUser();
  const rawCookieId = cookieStore.get(WORKSPACE_COOKIE)?.value ?? null;
  const cookieId = isWorkspaceId(rawCookieId) ? rawCookieId : null;

  let id: string;
  let plan: Plan = "free";

  if (user) {
    const owned = await db.select().from(workspaces).where(eq(workspaces.userId, user.id)).limit(1);

    if (owned.length > 0) {
      id = owned[0].id;
      plan = toPlan(owned[0].plan);
    } else {
      const provisioned = await ensureUserWorkspace(user.id);
      id = provisioned.id;
      plan = provisioned.plan;
    }
    // Claimed on every sign-in, not only the one that provisions the workspace.
    // Signing out and building more anonymously leaves a second orphan batch
    // waiting, and the account already exists by the time they come back.
    if (cookieId) await claimAnonymousProjects(cookieId, id);
  } else {
    id = cookieId ?? newWorkspaceId();
    if (!cookieId) {
      cookieStore.set(WORKSPACE_COOKIE, id, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        maxAge: ONE_YEAR,
        path: "/",
      });
    }
    const existing = await db.select().from(workspaces).where(eq(workspaces.id, id)).limit(1);
    if (existing.length === 0) {
      await db.insert(workspaces).values({ id, plan: "free" }).onConflictDoNothing();
    } else {
      plan = toPlan(existing[0].plan);
    }
  }

  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);

  const [usage] = await db
    .select({ value: count() })
    .from(projects)
    .where(and(eq(projects.workspaceId, id), gte(projects.createdAt, monthStart)));

  return {
    id,
    plan,
    authenticated: user !== null,
    user,
    projectsThisMonth: usage?.value ?? 0,
    limits: PLAN_LIMITS[plan],
  };
}

export async function setWorkspacePlan(id: string, plan: Plan): Promise<void> {
  await db
    .insert(workspaces)
    .values({ id, plan })
    .onConflictDoUpdate({ target: workspaces.id, set: { plan } });
}

/**
 * Drops anonymous workspaces that never received a project.
 *
 * A visitor who bounces without generating anything leaves a row behind, and
 * the rate limit on /api/session caps how fast those accumulate but cannot
 * stop them building up over weeks. Workspaces holding projects are excluded
 * outright: for a signed-out visitor that row may be the only thing keeping
 * their work reachable, so a cookie that has expired must never be mistaken for
 * abandonment.
 *
 * Signed-in workspaces are also excluded. Those are claimed by an account and
 * are cheap, so there is nothing to reclaim.
 */
export async function sweepAbandonedWorkspaces(): Promise<void> {
  try {
    await db
      .delete(workspaces)
      .where(
        and(
          isNull(workspaces.userId),
          lt(workspaces.createdAt, new Date(Date.now() - ONE_DAY_MS)),
          notExists(
            db.select({ one: sql`1` }).from(projects).where(eq(projects.workspaceId, workspaces.id)),
          ),
        ),
      );
  } catch (error) {
    console.error("abandoned workspace sweep failed", error);
  }
}
