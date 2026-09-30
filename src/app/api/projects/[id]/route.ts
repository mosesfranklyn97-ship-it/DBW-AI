import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { projects, revisions } from "@/db/schema";
import { normalizeSchema } from "@/lib/nlp/engine";
import { describeSchemaChange } from "@/lib/schema/diff";
import { resolveWorkspace } from "@/lib/server/workspace";
import { DIALECTS, type DbSchema, type Dialect } from "@/lib/types";

export const dynamic = "force-dynamic";

async function loadProject(id: string) {
  const workspace = await resolveWorkspace();
  const [row] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, id), eq(projects.workspaceId, workspace.id)))
    .limit(1);
  return { workspace, row };
}

function ownedProject(workspaceId: string, id: string) {
  return and(eq(projects.id, id), eq(projects.workspaceId, workspaceId));
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const { workspace, row } = await loadProject(id);
  if (!row) return Response.json({ error: "Project not found" }, { status: 404 });

  const history = await db
    .select()
    .from(revisions)
    .where(eq(revisions.projectId, id))
    .orderBy(revisions.id)
    .limit(50);

  const current = row.schema as DbSchema;

  return Response.json(
    {
      id: row.id,
      name: row.name,
      prompt: row.prompt,
      dialect: row.dialect as Dialect,
      schema: current,
      plan: workspace.plan,
      limits: workspace.limits,
      history: history.map((item) => {
        const snapshot = item.snapshot as DbSchema | null;
        return {
          id: item.id,
          instruction: item.instruction,
          summary: item.summary,
          createdAt: item.createdAt.toISOString(),
          // The snapshot itself is only fetched for the version the user picks
          // to compare, so the list stays small however long the project is.
          hasSnapshot: Boolean(snapshot),
          tables: snapshot?.tables.length ?? null,
          columns: snapshot?.tables.reduce((total, table) => total + table.columns.length, 0) ?? null,
          isCurrent: snapshot ? JSON.stringify(snapshot) === JSON.stringify(current) : false,
        };
      }),
    },
  );
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const { workspace, row } = await loadProject(id);
  if (!row) return Response.json({ error: "Project not found" }, { status: 404 });

  const body = (await request.json().catch(() => ({}))) as {
    schema?: unknown;
    dialect?: string;
    name?: string;
  };

  const currentSchema = row.schema as DbSchema;
  const dialect = (DIALECTS.includes(body.dialect as Dialect) ? body.dialect : row.dialect) as Dialect;

  let nextSchema: DbSchema = { ...currentSchema, dialect };
  let changed = false;
  if (body.schema) {
    const normalized = normalizeSchema(body.schema, dialect, currentSchema.name);
    if (!normalized) return Response.json({ error: "Invalid schema payload" }, { status: 400 });
    nextSchema = { ...normalized, source: currentSchema.source, notes: currentSchema.notes };
    changed = true;
  }
  if (typeof body.name === "string" && body.name.trim()) {
    nextSchema.name = body.name.trim().slice(0, 120);
    changed = true;
  }

  await db
    .update(projects)
    .set({
      schema: nextSchema,
      dialect,
      name: nextSchema.name,
      tableCount: nextSchema.tables.length,
      updatedAt: new Date(),
    })
    .where(ownedProject(workspace.id, id));

  // A hand edit is still a version. Without this the history only ever recorded
  // refinements, so a rollback could silently undo something the user typed.
  if (changed) {
    await db.insert(revisions).values({
      projectId: id,
      instruction: "Edited in the builder",
      summary: describeSchemaChange(currentSchema, nextSchema),
      snapshot: nextSchema,
    });
  }

  return Response.json({ id, schema: nextSchema });
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const { workspace, row } = await loadProject(id);
  if (!row) return Response.json({ error: "Project not found" }, { status: 404 });
  await db.delete(revisions).where(eq(revisions.projectId, id));
  await db.delete(projects).where(ownedProject(workspace.id, id));
  return Response.json({ ok: true });
}
