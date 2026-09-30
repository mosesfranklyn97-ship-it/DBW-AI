import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import initSqlJs from "sql.js";

/**
 * Loads the real export endpoint output into a real SQLite engine, which is
 * exactly what SqlPlayground does in the browser. Run with:
 *   npx tsx scripts/check-playground.ts <schema.sql> <data.sql>
 */

const [schemaPath, dataPath] = process.argv.slice(2);
if (!schemaPath || !dataPath) {
  console.error("usage: tsx scripts/check-playground.ts <schema.sql> <data.sql>");
  process.exit(1);
}

const ddl = readFileSync(schemaPath, "utf8");
const seed = readFileSync(dataPath, "utf8");

initSqlJs()
  .then((SQL) => {
    const db = new SQL.Database();
    db.run(ddl);

    // Seed rows are allowed to fail: the playground treats them as a nicety and
    // keeps the tables. This reports what actually happened instead.
    let seeded = 0;
    try {
      db.run(seed);
    } catch (caught) {
      console.log("seed rows rejected:", caught instanceof Error ? caught.message : caught);
    }
    const count = db.exec("SELECT COUNT(*) FROM patients;")[0]?.values[0]?.[0];
    seeded = typeof count === "number" ? count : 0;

    const tables = db
      .exec("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name;")
      .flatMap((result) => result.values.map((row) => row[0] as string));
    console.log("tables:", tables.join(", "));
    console.log("patient rows:", seeded);

    const join = db.exec(
      "SELECT p.full_name, p.gender, COUNT(a.id) AS visits FROM patients p LEFT JOIN appointments a ON a.patient_id = p.id GROUP BY p.id ORDER BY visits DESC LIMIT 5;",
    );
    console.log("join columns:", join[0]?.columns.join(", "));
    for (const row of join[0]?.values ?? []) console.log("  ", row.join(" | "));

    assert.ok(tables.length >= 3, "the exported DDL must create every table");

    // Writes have to work, since the playground advertises them.
    db.run("UPDATE patients SET phone = '+233200000000' WHERE id = 1;");
    const updated = db.exec("SELECT phone FROM patients WHERE id = 1;")[0]?.values[0]?.[0];
    assert.equal(updated, "+233200000000", "an UPDATE must take effect");

    // And a real error must be reported rather than swallowed.
    let message = "";
    try {
      db.exec("SELECT * FROM table_that_does_not_exist;");
    } catch (caught) {
      message = caught instanceof Error ? caught.message : String(caught);
    }
    assert.match(message, /no such table/i);
    console.log("error surfaces as:", message);

    // Reproduces SqlPlayground's own result loop: prepare, read the column
    // names, then step. Stepping once before the loop is the classic way to
    // lose the first row, so the count is asserted rather than eyeballed.
    const statement = db.prepare("SELECT id, full_name FROM patients ORDER BY id LIMIT 5;");
    const columns = statement.getColumnNames();
    const rows: unknown[][] = [];
    while (statement.step()) rows.push(statement.get());
    statement.free();
    assert.deepEqual(columns, ["id", "full_name"], "column names come from the statement");
    assert.equal(rows.length, 5, "the row loop must include the first row");
    const ordered = db.exec("SELECT id FROM patients ORDER BY id LIMIT 5;")[0]?.values ?? [];
    assert.deepEqual(
      rows.map((row) => row[0]),
      ordered.map((row) => row[0]),
      "the first row the loop returns must be the first row of the result",
    );
    console.log("result loop returned:", rows.length, "rows, first =", String(rows[0]?.[1]));

    console.log("\nplayground sandbox: OK");
  })
  .catch((caught: unknown) => {
    console.error(caught);
    process.exit(1);
  });
