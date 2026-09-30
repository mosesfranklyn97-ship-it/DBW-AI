import { randomUUID } from "node:crypto";
import { db } from "@/db";
import { projects, revisions } from "@/db/schema";
import { aiProviderName, generateSchemaWithAI } from "@/lib/ai/provider";
import { buildSchemaFromPrompt } from "@/lib/nlp/engine";
import { enforceRateLimit, hourlyLimit, rateLimitHeaders, rateLimitResponse } from "@/lib/server/rateLimit";
import { resolveWorkspace } from "@/lib/server/workspace";
import { DIALECTS, type Dialect, type DbSchema } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  // Ahead of the workspace quota, which is per-cookie and therefore cleared by
  // simply dropping the cookie. This cap is per-IP, so it is the one that
  // actually bounds how much a single caller can spend.
  const verdict = await enforceRateLimit(request, "generate", hourlyLimit("RATE_LIMIT_GENERATE_PER_HOUR", 30));
  if (!verdict.allowed) return rateLimitResponse(verdict);

  const workspace = await resolveWorkspace();
  const body = (await request.json().catch(() => ({}))) as { prompt?: string; dialect?: string };
  const prompt = (body.prompt ?? "").trim();
  const dialect = (DIALECTS.includes(body.dialect as Dialect) ? body.dialect : "mysql") as Dialect;

  if (prompt.length < 4) {
    return Response.json({ error: "Describe your database in a few more words." }, { status: 400 });
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

  const maxTables = workspace.limits.maxTables;
  const aiAvailable = aiProviderName() !== null;
  let schema: DbSchema | null = aiAvailable ? await generateSchemaWithAI(prompt, dialect, maxTables) : null;

  if (schema && schema.tables.length > maxTables) {
    schema = {
      ...schema,
      tables: schema.tables.slice(0, maxTables),
      notes: [`Trimmed to ${maxTables} tables for the ${workspace.limits.label} plan.`],
    };
  }
  if (!schema) {
    schema = buildSchemaFromPrompt({ prompt, dialect, maxTables });
    // Never let a keyword match pass itself off as a real interpretation.
    const reason = !aiAvailable
      ? "No AI key is configured, so this was matched by keyword instead of being read and understood. Add OPENAI_API_KEY or ANTHROPIC_API_KEY to .env.local for free-form understanding."
      : "The AI provider did not respond, so this was matched by keyword. Try again, or rephrase.";
    schema = { ...schema, notes: [...(schema.notes ?? []), reason] };
  }

  const id = randomUUID();
  const now = new Date();

  await db.insert(projects).values({
    id,
    workspaceId: workspace.id,
    name: schema.name,
    prompt,
    dialect,
    engine: schema.source,
    tableCount: schema.tables.length,
    schema,
    createdAt: now,
    updatedAt: now,
  });

  // The generated schema is revision one. Without it the history panel opens
  // empty and the first refine has nothing to diff against, so the original
  // design could never be restored once anything was changed.
  await db.insert(revisions).values({
    projectId: id,
    instruction: prompt,
    summary: `Generated ${schema.tables.length} table${
      schema.tables.length === 1 ? "" : "s"
    } from your description.`,
    snapshot: schema,
    createdAt: now,
  });

  return Response.json(
    {
      id,
      schema,
      plan: workspace.plan,
      usage: { used: workspace.projectsThisMonth + 1, limit: workspace.limits.maxProjectsPerMonth },
    },
    { headers: rateLimitHeaders(verdict) },
  );
}
