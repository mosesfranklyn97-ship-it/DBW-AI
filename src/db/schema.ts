import {
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const rateLimits = pgTable("rate_limits", {
  // "<scope>:<ip>:<window start>", so the key itself encodes the window and an
  // expired bucket is simply never read again.
  bucket: text("bucket").primaryKey(),
  count: integer("count").notNull().default(0),
  resetAt: timestamp("reset_at", { withTimezone: true }).notNull(),
});

export const workspaces = pgTable(
  "workspaces",
  {
    id: text("id").primaryKey(),
    // Supabase auth.users.id. Null for visitors who have not signed in.
    userId: text("user_id"),
    plan: text("plan").notNull().default("free"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [uniqueIndex("workspaces_user_idx").on(table.userId)],
);

export const projects = pgTable(
  "projects",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    name: text("name").notNull(),
    prompt: text("prompt").notNull(),
    dialect: text("dialect").notNull().default("mysql"),
    engine: text("engine").notNull().default("engine"),
    tableCount: integer("table_count").notNull().default(0),
    schema: jsonb("schema").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("projects_workspace_idx").on(table.workspaceId),
    // Cascading keeps a workspace from leaving projects behind, which is what
    // made the free-plan usage count drift away from the real project total.
    foreignKey({
      columns: [table.workspaceId],
      foreignColumns: [workspaces.id],
      name: "projects_workspace_fk",
    }).onDelete("cascade"),
  ],
);

export const revisions = pgTable(
  "revisions",
  {
    id: serial("id").primaryKey(),
    projectId: text("project_id").notNull(),
    instruction: text("instruction").notNull(),
    summary: text("summary").notNull(),
    // The full schema as it stood after this revision. This is what makes a
    // rollback possible: the summary alone cannot be turned back into a schema,
    // and the project row only ever holds the newest one.
    snapshot: jsonb("snapshot"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("revisions_project_idx").on(table.projectId),
    foreignKey({
      columns: [table.projectId],
      foreignColumns: [projects.id],
      name: "revisions_project_fk",
    }).onDelete("cascade"),
  ],
);

export const projectShares = pgTable(
  "project_shares",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull(),
    // Only the SHA-256 of the token is stored. A leaked database dump must not
    // hand out working share links, so the raw token is shown once and never
    // written down again.
    tokenHash: text("token_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    // Soft delete: revoking keeps the row so a share link that was already
    // handed out fails loudly instead of quietly resolving to a new project.
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    lastViewedAt: timestamp("last_viewed_at", { withTimezone: true }),
    viewCount: integer("view_count").notNull().default(0),
  },
  (table) => [
    // Non-unique on purpose: a revoked link and a freshly minted one may never
    // collide in practice, but the lookup must not be able to fail on insert.
    index("project_shares_token_idx").on(table.tokenHash),
    index("project_shares_project_idx").on(table.projectId),
    foreignKey({
      columns: [table.projectId],
      foreignColumns: [projects.id],
      name: "project_shares_project_fk",
    }).onDelete("cascade"),
  ],
);

export type WorkspaceRow = typeof workspaces.$inferSelect;
export type ProjectRow = typeof projects.$inferSelect;
export type RevisionRow = typeof revisions.$inferSelect;
export type ProjectShareRow = typeof projectShares.$inferSelect;