import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { projects, revisions } from "@/db/schema";
import { normalizeSchema } from "@/lib/nlp/engine";
import { describeSchemaChange } from "@/lib/schema/diff";
import { resolveWorkspace } from "@/lib/server/workspace";
import type { DbSchema } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Restores an earlier snapshot as a *new* revision rather than deleting the
 * revisions after it. The history is a log, and rewriting it would make the
 * rollback itself unrecoverable if it was the wrong button.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const workspace = await resolveWorkspace();

  const [row] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, id), eq(projects.workspaceId, workspace.id)))
    .limit(1);
  if (!row) return Response.json({ error: "Project not found" }, { status: 404 });

  const body = (await request.json().catch(() => ({}))) as { revisionId?: number };
  const revisionId = Number(body.revisionId);
  if (!Number.isInteger(revisionId)) {
    return Response.json({ error: "Pick a version to restore." }, { status: 400 });
  }

  const [target] = await db
    .select()
    .from(revisions)
    .where(and(eq(revisions.id, revisionId), eq(revisions.projectId, id)))
    .limit(1);
  if (!target) return Response.json({ error: "That version no longer exists." }, { status: 404 });

  const snapshot = target.snapshot as DbSchema | null;
  if (!snapshot) {
    return Response.json(
      {
        error:
          "This version was saved before snapshots existed, so it cannot be restored. The change is still described in the history.",
      },
      { status: 409 },
    );
  }

  // A snapshot is written by the app, but it came back out of jsonb and is
  // re-validated before it is allowed to become the live schema again.
  const restored = normalizeSchema(snapshot, snapshot.dialect, snapshot.name);
  if (!restored) {
    return Response.json({ error: "That version is not readable any more." }, { status: 422 });
  }

  const current = row.schema as DbSchema;
  const nextSchema: DbSchema = { ...restored, source: current.source };
  const summary = `Restored version #${revisionId} — ${describeSchemaChange(current, nextSchema)}`;

  await db
    .update(projects)
    .set({
      schema: nextSchema,
      dialect: nextSchema.dialect,
      name: nextSchema.name,
      tableCount: nextSchema.tables.length,
      updatedAt: new Date(),
    })
    .where(and(eq(projects.id, id), eq(projects.workspaceId, workspace.id)));

  const [created] = await db
    .insert(revisions)
    .values({
      projectId: id,
      instruction: `Rolled back to version #${revisionId}`,
      summary,
      snapshot: nextSchema,
    })
    .returning({ id: revisions.id, createdAt: revisions.createdAt });

  return Response.json({
    id,
    schema: nextSchema,
    summary,
    revision: {
      id: created?.id ?? null,
      instruction: `Rolled back to version #${revisionId}`,
      summary,
      createdAt: (created?.createdAt ?? new Date()).toISOString(),
    },
  });
}
