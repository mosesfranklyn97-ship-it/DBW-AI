import { generateDiagramSVG, generateReadme } from "@/lib/diagram";
import { generateDDL } from "@/lib/sql/generate";
import { generateInsertSQL, generateSampleRows } from "@/lib/sql/sampleData";
import { enforceRateLimit, hourlyLimit, rateLimitHeaders, rateLimitResponse } from "@/lib/server/rateLimit";
import { resolveShareToken, type SharedProject } from "@/lib/server/shareLinks";
import { DIALECT_META, DIALECTS, type Dialect } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Public read-only access to a shared project.
 *
 * There is no `resolveWorkspace()` here on purpose: a share link works for
 * anyone who holds the token, including signed-out visitors, so it must never
 * depend on the caller's workspace cookie. Everything it can return is
 * read-only and derived from the snapshot the owner chose to share.
 */
export async function GET(request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;

  // Tokens carry 256 bits of entropy, so this limit is not about guessing. It
  // is about not letting one leaked link be used to hammer the database.
  const verdict = await enforceRateLimit(request, "share-read", hourlyLimit("RATE_LIMIT_SHARE_VIEW_PER_HOUR", 120));
  if (!verdict.allowed) return rateLimitResponse(verdict);

  const lookup = await resolveShareToken(decodeURIComponent(token));
  if (lookup.status === "not-found") {
    return Response.json({ error: "This share link is not valid." }, { status: 404 });
  }
  if (lookup.status === "revoked") {
    return Response.json({ error: "This share link was turned off by its owner." }, { status: 410 });
  }

  const project = lookup.project;
  const url = new URL(request.url);
  const type = url.searchParams.get("type") ?? "view";
  const dialect = (DIALECTS.includes(url.searchParams.get("dialect") as Dialect)
    ? (url.searchParams.get("dialect") as Dialect)
    : project.dialect) as Dialect;
  const schema: SharedProject["schema"] = { ...project.schema, dialect };

  const text = (body: string, contentType: string, fileName: string) =>
    new Response(body, {
      headers: {
        "Content-Type": contentType,
        // A shared schema is snapshot-shaped: once the owner edits the project
        // the link must keep serving what was reviewed, not a moving target.
        "Cache-Control": "private, max-age=60",
        "Content-Disposition": `inline; filename="${fileName}"`,
        "X-Robots-Tag": "noindex, nofollow",
        ...rateLimitHeaders(verdict),
      },
    });

  switch (type) {
    case "schema":
      return text(generateDDL(schema, dialect), "text/plain; charset=utf-8", "schema.sql");
    case "data":
      return text(
        generateInsertSQL(schema, dialect, generateSampleRows(schema, 20)),
        "text/plain; charset=utf-8",
        "sample_data.sql",
      );
    case "diagram":
      return text(generateDiagramSVG(schema), "image/svg+xml; charset=utf-8", "diagram.svg");
    case "readme":
      return text(generateReadme(schema, DIALECT_META[dialect].file), "text/markdown; charset=utf-8", "README.md");
    case "json":
      return Response.json({ project, schema }, { headers: rateLimitHeaders(verdict) });
    default:
      return Response.json(
        {
          project: {
            name: project.name,
            description: project.description,
            dialect: project.dialect,
            updatedAt: project.updatedAt,
            sharedAt: project.sharedAt,
          },
          schema,
        },
        { headers: { ...rateLimitHeaders(verdict), "X-Robots-Tag": "noindex, nofollow" } },
      );
  }
}
