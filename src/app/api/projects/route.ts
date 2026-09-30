import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { projects } from "@/db/schema";
import { resolveWorkspace } from "@/lib/server/workspace";

export const dynamic = "force-dynamic";

export async function GET() {
  const workspace = await resolveWorkspace();
  const rows = await db
    .select({
      id: projects.id,
      name: projects.name,
      prompt: projects.prompt,
      dialect: projects.dialect,
      tableCount: projects.tableCount,
      engine: projects.engine,
      createdAt: projects.createdAt,
      updatedAt: projects.updatedAt,
    })
    .from(projects)
    .where(eq(projects.workspaceId, workspace.id))
    .orderBy(desc(projects.updatedAt))
    .limit(60);

  return Response.json({
    projects: rows.map((row) => ({
      ...row,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    })),
    plan: workspace.plan,
    usage: { used: workspace.projectsThisMonth, limit: workspace.limits.maxProjectsPerMonth },
  });
}
