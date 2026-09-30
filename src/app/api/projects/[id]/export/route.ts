import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { projects } from "@/db/schema";
import { generateDiagramSVG, generateReadme } from "@/lib/diagram";
import { generateDDL } from "@/lib/sql/generate";
import { generateInsertSQL, generateSampleRows } from "@/lib/sql/sampleData";
import { resolveWorkspace } from "@/lib/server/workspace";
import { DIALECT_META, DIALECTS, type DbSchema, type Dialect } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const url = new URL(request.url);
  const type = url.searchParams.get("type") ?? "schema";
  const rawRows = url.searchParams.get("rows");
  // Number("abc") is NaN and Number("") is 0, either of which would silently
  // poison the sample-data generator and produce an empty
  // database.sql/sample_data.sql.
  const requestedRows = rawRows === null || rawRows.trim() === "" ? 20 : Number(rawRows);
  const rows = Number.isFinite(requestedRows)
    ? Math.min(Math.max(Math.trunc(requestedRows), 3), 50)
    : 20;
  const workspace = await resolveWorkspace();

  const [row] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, id), eq(projects.workspaceId, workspace.id)))
    .limit(1);

  if (!row) return Response.json({ error: "Project not found" }, { status: 404 });

  const stored = row.schema as DbSchema;
  const dialect = (DIALECTS.includes(url.searchParams.get("dialect") as Dialect)
    ? (url.searchParams.get("dialect") as Dialect)
    : (row.dialect as Dialect)) as Dialect;
  const schema: DbSchema = { ...stored, dialect };

  const download = url.searchParams.get("download") === "1";
  const fileBase = schema.name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "database";

  const respond = (body: string, contentType: string, fileName: string) =>
    new Response(body, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "no-store",
        ...(download ? { "Content-Disposition": `attachment; filename="${fileName}"` } : {}),
      },
    });

  switch (type) {
    case "data":
      return respond(
        generateInsertSQL(schema, dialect, generateSampleRows(schema, rows)),
        "text/plain; charset=utf-8",
        "sample_data.sql",
      );
    case "sheet":
      return Response.json({ data: generateSampleRows(schema, rows) });
    case "diagram":
      return respond(generateDiagramSVG(schema), "image/svg+xml; charset=utf-8", "diagram.svg");
    case "readme":
      return respond(
        generateReadme(schema, DIALECT_META[dialect].file),
        "text/markdown; charset=utf-8",
        "README.md",
      );
    case "json":
      return Response.json({ schema });
    case "schema":
    default:
      return respond(
        generateDDL(schema, dialect),
        "text/plain; charset=utf-8",
        `${fileBase}_${dialect}.sql`,
      );
  }
}
