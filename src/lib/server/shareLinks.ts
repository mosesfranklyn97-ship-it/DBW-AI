import { createHash, randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { projectShares, projects } from "@/db/schema";
import { randomToken } from "@/lib/server/sign";
import type { Dialect, DbSchema } from "@/lib/types";

/**
 * Read-only share links.
 *
 * A share is a bearer capability: whoever holds the token can read the schema
 * and the generated SQL, and nothing else. Two rules keep that safe.
 *
 *  1. Only the SHA-256 of the token is persisted, so a database dump or a
 *     leaked backup does not yield usable links. The raw token is returned once,
 *     at creation, and is unrecoverable afterwards.
 *  2. The public read path never touches `revisions` or the owner's prompt
 *     history, and it is capped by the same rate limiter as everything else.
 */

export const SHARE_TOKEN_BYTES = 32;

/** Tokens are stored hashed, so a lookup is a plain indexed equality match. */
function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export interface CreatedShare {
  id: string;
  url: string;
  createdAt: string;
}

export interface ShareSummary {
  id: string;
  createdAt: string;
  revokedAt: string | null;
  viewCount: number;
  lastViewedAt: string | null;
}

export async function createShareLink(projectId: string, origin: string): Promise<CreatedShare> {
  const token = randomToken(SHARE_TOKEN_BYTES);
  const id = `sh-${randomUUID().replace(/-/g, "").slice(0, 20)}`;
  const [row] = await db
    .insert(projectShares)
    .values({ id, projectId, tokenHash: hashToken(token) })
    .returning({ createdAt: projectShares.createdAt });
  return {
    id,
    url: `${origin.replace(/\/+$/, "")}/share/${token}`,
    createdAt: (row?.createdAt ?? new Date()).toISOString(),
  };
}

export async function listShares(projectId: string): Promise<ShareSummary[]> {
  const rows = await db
    .select({
      id: projectShares.id,
      createdAt: projectShares.createdAt,
      revokedAt: projectShares.revokedAt,
      viewCount: projectShares.viewCount,
      lastViewedAt: projectShares.lastViewedAt,
    })
    .from(projectShares)
    .where(eq(projectShares.projectId, projectId))
    .orderBy(projectShares.createdAt);
  return rows.map((row) => ({
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    revokedAt: row.revokedAt ? row.revokedAt.toISOString() : null,
    viewCount: row.viewCount,
    lastViewedAt: row.lastViewedAt ? row.lastViewedAt.toISOString() : null,
  }));
}

/** Revokes every live link for a project. Already-issued tokens stop working. */
export async function revokeAllShares(projectId: string): Promise<number> {
  const revoked = await db
    .update(projectShares)
    .set({ revokedAt: new Date() })
    .where(and(eq(projectShares.projectId, projectId), isNull(projectShares.revokedAt)))
    .returning({ id: projectShares.id });
  return revoked.length;
}

export interface SharedProject {
  name: string;
  description: string;
  dialect: Dialect;
  schema: DbSchema;
  updatedAt: string;
  sharedAt: string;
}

export type ShareLookup =
  | { status: "ok"; project: SharedProject }
  | { status: "not-found" }
  | { status: "revoked" };

/**
 * Resolves a raw token to a read-only project view. Revoked and unknown tokens
 * are reported separately so the UI can say "this link was turned off"
 * without confirming that the project ever existed.
 */
export async function resolveShareToken(token: string): Promise<ShareLookup> {
  if (token.length < 16 || token.length > 128) return { status: "not-found" };

  const [hit] = await db
    .select({
      shareId: projectShares.id,
      revokedAt: projectShares.revokedAt,
      createdAt: projectShares.createdAt,
      viewCount: projectShares.viewCount,
      name: projects.name,
      dialect: projects.dialect,
      schema: projects.schema,
      updatedAt: projects.updatedAt,
    })
    .from(projectShares)
    .innerJoin(projects, eq(projects.id, projectShares.projectId))
    .where(eq(projectShares.tokenHash, hashToken(token)))
    .limit(1);

  if (!hit) return { status: "not-found" };
  if (hit.revokedAt) return { status: "revoked" };

  // A view counter is a nice-to-have, never worth failing the read over.
  void db
    .update(projectShares)
    .set({
      viewCount: hit.viewCount + 1,
      lastViewedAt: new Date(),
    })
    .where(eq(projectShares.id, hit.shareId))
    .catch(() => undefined);

  const schema = hit.schema as DbSchema;
  return {
    status: "ok",
    project: {
      name: hit.name,
      description: schema?.description ?? "",
      dialect: hit.dialect as Dialect,
      schema: { ...schema, notes: undefined },
      updatedAt: hit.updatedAt.toISOString(),
      sharedAt: hit.createdAt.toISOString(),
    },
  };
}
