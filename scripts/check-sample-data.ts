import assert from "node:assert/strict";
import initSqlJs from "sql.js";
import { parseSqlToSchema } from "@/lib/sql/parse";
import { generateInsertSQL, generateSampleRows } from "@/lib/sql/sampleData";
import { DIALECTS, type DbSchema } from "@/lib/types";

/**
 * The seed data is advertised as importable, so every foreign key it writes has
 * to point at a row that the same script creates. This exercises the case that
 * actually used to break: a child table declared before its parent, whose
 * referencing columns are typed by the *referenced* column rather than "fk".
 */

const SCRIPT = `
CREATE TABLE appointments (
  id SERIAL PRIMARY KEY,
  patient_id INTEGER NOT NULL,
  doctor_id INTEGER NOT NULL,
  scheduled_at TIMESTAMP NOT NULL,
  CONSTRAINT fk_appt_pat FOREIGN KEY (patient_id) REFERENCES patients (id) ON DELETE CASCADE,
  CONSTRAINT fk_appt_doc FOREIGN KEY (doctor_id) REFERENCES doctors (id) ON DELETE RESTRICT
);
CREATE TABLE doctors (
  id SERIAL PRIMARY KEY,
  full_name VARCHAR(120) NOT NULL
);
CREATE TABLE patients (
  id SERIAL PRIMARY KEY,
  full_name VARCHAR(120) NOT NULL
);
`;

const parsed = parseSqlToSchema(SCRIPT);
assert.ok(parsed.schema, "the script must parse");
const schema: DbSchema = parsed.schema;

// The child is first in the script, so nothing about the declaration order may
// be allowed to influence the generated rows.
assert.equal(schema.tables[0].name, "appointments");

const data = generateSampleRows(schema, 20);
const patientIds = new Set(data.patients.map((row) => row.id));
const doctorIds = new Set(data.doctors.map((row) => row.id));
assert.equal(patientIds.size, 20, "the parent must have 20 distinct ids");
assert.equal(doctorIds.size, 20);

for (const row of data.appointments) {
  assert.ok(patientIds.has(row.patient_id as number), `patient_id ${row.patient_id} is not a real patient`);
  assert.ok(doctorIds.has(row.doctor_id as number), `doctor_id ${row.doctor_id} is not a real doctor`);
}

// No orphan anywhere, across every referencing column the parser can produce.
for (const table of schema.tables) {
  for (const column of table.columns) {
    if (!column.references) continue;
    const pool = new Set((data[column.references.table] ?? []).map((row) => row.id));
    for (const row of data[table.name]) {
      assert.ok(pool.has(row[column.name] as number), `${table.name}.${column.name} points at a missing row`);
    }
  }
}

// SQLite is the dialect that actually enforces this, so it is the one that
// proves the fix rather than merely asserting it.
void (async () => {
  const SQL = await initSqlJs();
  for (const dialect of DIALECTS) {
    const insertSQL = generateInsertSQL(schema, dialect, data);
    // Identifiers are quoted per dialect, so this only checks the table is there.
    assert.match(insertSQL, /INSERT INTO [`"]?appointments[`"]?/, `${dialect} must emit the child table`);

    if (dialect !== "sqlite") {
      assert.doesNotMatch(insertSQL, /\bNULL\b\s*,\s*\(\d+,/, `${dialect} must not write a null foreign key`);
      continue;
    }

    const db = new SQL.Database();
    // The playground runs exactly this pair: the exported DDL, then the seeds.
    db.run(`
      CREATE TABLE appointments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        patient_id INTEGER NOT NULL,
        doctor_id INTEGER NOT NULL,
        scheduled_at TEXT NOT NULL,
        FOREIGN KEY (patient_id) REFERENCES patients (id) ON DELETE CASCADE,
        FOREIGN KEY (doctor_id) REFERENCES doctors (id) ON DELETE RESTRICT
      );
      CREATE TABLE doctors (id INTEGER PRIMARY KEY AUTOINCREMENT, full_name TEXT NOT NULL);
      CREATE TABLE patients (id INTEGER PRIMARY KEY AUTOINCREMENT, full_name TEXT NOT NULL);
      PRAGMA foreign_keys = ON;
    `);
    // No try/catch: an integrity failure here is the bug this test exists for.
    db.run(insertSQL);

    const seeded = db.exec("SELECT COUNT(*) FROM appointments;")[0]?.values[0]?.[0];
    assert.equal(seeded, 20, "every appointment row must survive the foreign keys");

    const orphans = db.exec(
      "SELECT COUNT(*) FROM appointments a LEFT JOIN patients p ON p.id = a.patient_id WHERE p.id IS NULL;",
    )[0]?.values[0]?.[0];
    assert.equal(orphans, 0, "no appointment may point at a patient that does not exist");

    console.log("sample data foreign keys: all assertions passed");
  }
})().catch((caught: unknown) => {
  console.error(caught);
  process.exit(1);
});
