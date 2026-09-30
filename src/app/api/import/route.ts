import { randomUUID } from "node:crypto";
import { db } from "@/db";
import { projects, revisions } from "@/db/schema";
import { enforceRateLimit, hourlyLimit, rateLimitHeaders, rateLimitResponse } from "@/lib/server/rateLimit";
import { resolveWorkspace } from "@/lib/server/workspace";
import { parseSqlToSchema } from "@/lib/sql/parse";
import { DIALECTS, type Dialect } from "@/lib/types";

export const dynamic = "force-dynamic";

// A dumped schema is far bigger than a prompt, so the body needs a ceiling
// well above the generate route's default.
const MAX_SQL_BYTES = 1_500_000;

export async function POST(request: Request) {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_SQL_BYTES) {
    return Response.json({ error: "That file is too large to import. Try splitting the script." }, { status: 413 });
  }

  const verdict = await enforceRateLimit(request, "import", hourlyLimit("RATE_LIMIT_IMPORT_PER_HOUR", 20));
  if (!verdict.allowed) return rateLimitResponse(verdict);

  const workspace = await resolveWorkspace();
  const body = (await request.json().catch(() => ({}))) as { sql?: string; dialect?: string; name?: string };
  const sql = typeof body.sql === "string" ? body.sql : "";
  if (sql.trim().length < 8) {
    return Response.json({ error: "Paste a CREATE TABLE script or upload a .sql file first." }, { status: 400 });
  }
  if (sql.length > MAX_SQL_BYTES) {
    return Response.json({ error: "That script is too large to import. Try splitting it." }, { status: 413 });
  }

  if (workspace.projectsThisMonth >= workspace.limits.maxProjectsPerMonth) {
    return Response.json(
      {
        error: `Free plan limit reached (${workspace.limits.maxProjectsPerMonth} databases this month). Upgrade for unlimited builds.`,
        code: "QUOTA",
      },
      { status: 402 },
    );
  }

  // The dialect is optional: the parser detects it from the script itself, and
  // an explicit choice still wins when the user picked "auto".
  const requested = DIALECTS.includes(body.dialect as Dialect) ? (body.dialect as Dialect) : undefined;
  const parsed = parseSqlToSchema(sql, {
    maxTables: workspace.limits.maxTables,
    ...(requested ? { dialect: requested } : {}),
  });

  if (!parsed.schema) {
    return Response.json(
      {
        error: "No CREATE TABLE statements were found in that script.",
        warnings: parsed.warnings,
      },
      { status: 422 },
    );
  }

  const schema = parsed.schema;
  const id = randomUUID();
  const now = new Date();
  const name = body.name?.trim().slice(0, 120) || schema.name;

  await db.insert(projects).values({
    id,
    workspaceId: workspace.id,
    name,
    prompt: `Imported from an existing SQL script (${parsed.tables} tables).`,
    dialect: schema.dialect,
    engine: schema.source,
    tableCount: schema.tables.length,
    schema: { ...schema, name },
    createdAt: now,
    updatedAt: now,
  });

  // The imported schema is itself revision one, so the history panel opens on
  // something real and the first rollback target exists from the start.
  await db.insert(revisions).values({
    projectId: id,
    instruction: "Imported SQL script",
    summary: `Read ${parsed.tables} table${parsed.tables === 1 ? "" : "s"} and ${parsed.columns} column${
      parsed.columns === 1 ? "" : "s"
    } from the pasted script.`,
    snapshot: { ...schema, name },
    createdAt: now,
  });

  return Response.json(
    {
      id,
      schema: { ...schema, name },
      tables: parsed.tables,
      columns: parsed.columns,
      warnings: parsed.warnings,
      plan: workspace.plan,
      usage: { used: workspace.projectsThisMonth + 1, limit: workspace.limits.maxProjectsPerMonth },
    },
    { headers: rateLimitHeaders(verdict) },
  );
}
