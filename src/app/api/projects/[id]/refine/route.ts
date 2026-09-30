import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { projects, revisions } from "@/db/schema";
import { aiProviderName, refineSchemaWithAI } from "@/lib/ai/provider";
import { applyInstruction } from "@/lib/nlp/engine";
import { diffSchemas, type SchemaDiff } from "@/lib/schema/diff";
import { enforceRateLimit, hourlyLimit, rateLimitHeaders, rateLimitResponse } from "@/lib/server/rateLimit";
import { signToken, verifyToken } from "@/lib/server/sign";
import { resolveWorkspace } from "@/lib/server/workspace";
import type { DbSchema } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** How long a reviewed diff stays applyable. Long enough to read, short enough to expire. */
const PREVIEW_TTL_MS = 10 * 60 * 1000;

type Engine = "ai" | "engine";

interface PreviewToken {
  /** Payload version, so a future change can invalidate old links cleanly. */
  v: 1;
  /** Project id. */
  p: string;
  /** The instruction that produced the candidate, re-checked on apply. */
  i: string;
  /** The exact candidate schema the reviewer saw. */
  s: DbSchema;
  /** Which engine actually produced it. */
  e: Engine;
  /** Human summary. */
  m: string;
}

/**
 * Computes the candidate schema for an instruction.
 *
 * The LLM is tried first and the keyword engine is the fallback. Which one ran
 * is reported back to the caller rather than being folded into `schema.source`,
 * which records where the schema was originally born. Conflating the two is how
 * a keyword-matched edit ends up labelled "LLM architect".
 */
async function propose(
  current: DbSchema,
  instruction: string,
  maxTables: number,
): Promise<{ schema: DbSchema; summary: string; engine: Engine }> {
  const aiSchema = await refineSchemaWithAI(current, instruction, maxTables);
  if (aiSchema && aiSchema.tables.length > 0) {
    const added = aiSchema.tables.filter((table) => !current.tables.some((item) => item.name === table.name));
    const removed = current.tables.filter((table) => !aiSchema.tables.some((item) => item.name === table.name));
    const summary =
      [
        added.length ? `Added ${added.map((table) => `\`${table.name}\``).join(", ")}` : "",
        removed.length ? `Removed ${removed.map((table) => `\`${table.name}\``).join(", ")}` : "",
      ]
        .filter(Boolean)
        .join(" · ") || "Schema updated";
    return {
      // `source` is the schema's origin, so it carries over untouched.
      schema: { ...aiSchema, dialect: current.dialect, source: current.source },
      summary,
      engine: "ai",
    };
  }

  const patched = applyInstruction(current, instruction, maxTables);
  return { schema: patched.schema, summary: patched.summary, engine: "engine" };
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  // A refine costs the same as a generate, so it carries its own cap rather
  // than sharing one, which would let a caller drain the generate budget here.
  // Preview and apply are two calls, so the default is doubled.
  const verdict = await enforceRateLimit(request, "refine", hourlyLimit("RATE_LIMIT_REFINE_PER_HOUR", 40));
  if (!verdict.allowed) return rateLimitResponse(verdict);

  const workspace = await resolveWorkspace();
  const [row] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, id), eq(projects.workspaceId, workspace.id)))
    .limit(1);

  if (!row) return Response.json({ error: "Project not found" }, { status: 404 });

  const body = (await request.json().catch(() => ({}))) as {
    instruction?: string;
    mode?: "preview" | "apply";
    previewToken?: string;
  };
  const instruction = (body.instruction ?? "").trim();
  const maxTables = workspace.limits.maxTables;
  const current = row.schema as DbSchema;
  const aiAvailable = aiProviderName() !== null;

  /** Writes the candidate and records a rollback-capable revision. */
  const commit = async (schema: DbSchema, summary: string, engine: Engine) => {
    await db
      .update(projects)
      .set({
        schema,
        name: schema.name,
        tableCount: schema.tables.length,
        updatedAt: new Date(),
      })
      .where(and(eq(projects.id, id), eq(projects.workspaceId, workspace.id)));

    // The snapshot is what makes this revision a rollback target; the summary
    // alone cannot be turned back into a schema.
    await db.insert(revisions).values({ projectId: id, instruction, summary, snapshot: schema });
    return Response.json(
      { id, schema, summary, engine, aiAvailable, applied: true },
      { headers: rateLimitHeaders(verdict) },
    );
  };

  // Apply a diff that was already reviewed. Nothing is recomputed, so the
  // schema written here is exactly the one the reviewer approved even if the
  // model would have answered differently on a second call.
  if (body.mode === "apply" && body.previewToken) {
    if (instruction.length < 3) {
      return Response.json({ error: "Tell the AI what to change." }, { status: 400 });
    }
    const verified = verifyToken<PreviewToken>(body.previewToken);
    if (!verified.ok) {
      const reason =
        verified.reason === "expired"
          ? "That diff expired. Ask for the change again."
          : "That diff could not be verified. Ask for the change again.";
      return Response.json({ error: reason }, { status: 400 });
    }
    const { p, i, s, e, m } = verified.payload;
    if (p !== id || i !== instruction || !s || !Array.isArray(s.tables)) {
      return Response.json({ error: "That diff does not match this project. Ask again." }, { status: 400 });
    }
    return commit({ ...s, dialect: current.dialect }, m, e);
  }

  if (instruction.length < 3) {
    return Response.json({ error: "Tell the AI what to change." }, { status: 400 });
  }

  let candidate = await propose(current, instruction, maxTables);
  if (candidate.schema.tables.length > maxTables) {
    candidate = {
      ...candidate,
      schema: { ...candidate.schema, tables: candidate.schema.tables.slice(0, maxTables) },
      summary: `${candidate.summary} · trimmed to ${maxTables} tables (plan limit)`,
    };
  }

  const diff: SchemaDiff = diffSchemas(current, candidate.schema);
  // `diffSchemas` compares tables only, so a pure rename looks identical. The
  // project name and description are part of the schema too, and an instruction
  // that only renames is a real change that must still be applyable.
  const noChange =
    diff.empty &&
    candidate.schema.name === current.name &&
    candidate.schema.description === current.description;

  // Preview stops here: the candidate is returned with a signed handle and
  // nothing is written until that handle comes back.
  if (body.mode === "preview") {
    const previewToken = signToken<PreviewToken>(
      { v: 1, p: id, i: instruction, s: candidate.schema, e: candidate.engine, m: candidate.summary },
      PREVIEW_TTL_MS,
    );
    return Response.json(
      {
        id,
        preview: true,
        applied: false,
        schema: candidate.schema,
        diff,
        summary: candidate.summary,
        engine: candidate.engine,
        aiAvailable,
        noChange,
        previewToken,
      },
      { headers: rateLimitHeaders(verdict) },
    );
  }

  return commit(candidate.schema, candidate.summary, candidate.engine);
}
