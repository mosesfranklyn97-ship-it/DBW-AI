import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { projects, revisions } from "@/db/schema";
import { diffSchemas } from "@/lib/schema/diff";
import { resolveWorkspace } from "@/lib/server/workspace";
import type { DbSchema } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * One revision's snapshot, plus its diff against the live schema. The diff is
 * computed here rather than in the browser because a snapshot is the one thing
 * the client is not allowed to hold: it is a whole other version of the
 * database and the list deliberately omits it.
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string; revisionId: string }> }) {
  const { id, revisionId } = await context.params;
  const parsed = Number(revisionId);
  if (!Number.isInteger(parsed)) return Response.json({ error: "Invalid version" }, { status: 400 });

  const workspace = await resolveWorkspace();
  const [row] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, id), eq(projects.workspaceId, workspace.id)))
    .limit(1);
  if (!row) return Response.json({ error: "Project not found" }, { status: 404 });

  const [target] = await db
    .select()
    .from(revisions)
    .where(and(eq(revisions.id, parsed), eq(revisions.projectId, id)))
    .limit(1);
  if (!target) return Response.json({ error: "That version no longer exists." }, { status: 404 });

  const snapshot = target.snapshot as DbSchema | null;
  if (!snapshot) {
    return Response.json({
      id: target.id,
      instruction: target.instruction,
      summary: target.summary,
      createdAt: target.createdAt.toISOString(),
      snapshot: null,
      diff: null,
    });
  }

  const current = row.schema as DbSchema;

  return Response.json({
    id: target.id,
    instruction: target.instruction,
    summary: target.summary,
    createdAt: target.createdAt.toISOString(),
    snapshot,
    // Direction matters: this answers "what do I get back if I roll back",
    // which is the live schema compared against the snapshot, not the reverse.
    diff: diffSchemas(snapshot, current),
  });
}
