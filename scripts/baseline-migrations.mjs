import { readMigrationFiles } from "drizzle-orm/migrator";

/**
 * Generates the SQL to baseline an existing database.
 *
 * This project's tables were created outside the migration runner, so the
 * remote database has the right shape but no history. Running `db:migrate`
 * against it would replay 0000 and fail on `CREATE TABLE "projects"`, because
 * that table already exists.
 *
 * The fix is to record the migrations as already applied without executing
 * them. That is only safe because the live schema matches the migrations
 * exactly, so the marker states a true fact rather than papering over drift.
 *
 * This script only prints SQL. It never connects to anything, so it cannot
 * damage a database. Verify the schema matches, review the output, then run it.
 *
 * Usage: node scripts/baseline-migrations.mjs
 */

const migrations = readMigrationFiles({ migrationsFolder: "./drizzle" });

if (migrations.length === 0) {
  console.error("No migrations found in ./drizzle - nothing to baseline.");
  process.exit(1);
}

const rows = migrations
  .map((m) => `    ('${m.hash}', ${m.folderMillis})`)
  .join(",\n");

// Matches the shape drizzle's own pg dialect creates, so the runner can read it:
// drizzle-orm/pg-core/dialect.js issues CREATE SCHEMA + a table with a
// NOT NULL hash column, and orders by created_at desc limit 1.
const sql = `-- Baseline: the schema already exists, so record the migrations as
-- applied rather than replaying them.
--
-- Verify the live schema matches these migrations before running this.

CREATE SCHEMA IF NOT EXISTS drizzle;

CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
  id SERIAL PRIMARY KEY,
  hash text NOT NULL,
  created_at bigint
);

INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES
${rows};
`;

console.log(sql);
console.log(`-- ${migrations.length} migrations baselined.`);
console.log(
  `-- Newest: ${migrations[migrations.length - 1].folderMillis} ` +
    `(${new Date(migrations[migrations.length - 1].folderMillis).toISOString()})`,
);
