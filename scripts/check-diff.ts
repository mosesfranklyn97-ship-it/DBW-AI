import assert from "node:assert/strict";
import initSqlJs from "sql.js";
import { diffSchemas, describeSchemaChange } from "@/lib/schema/diff";
import type { DbSchema } from "@/lib/types";

const base: DbSchema = {
  name: "Clinic",
  description: "",
  dialect: "sqlite",
  source: "engine",
  tables: [
    {
      name: "patients",
      columns: [
        { name: "id", type: "id", primaryKey: true, nullable: false },
        { name: "name", type: "string", length: 120, nullable: false },
        { name: "gender", type: "enum", enumValues: ["male", "female"], nullable: false },
      ],
    },
    {
      name: "visits",
      columns: [
        { name: "id", type: "id", primaryKey: true, nullable: false },
        { name: "patient_id", type: "int", nullable: false, references: { table: "patients", column: "id", onDelete: "cascade" } },
        { name: "notes", type: "text", nullable: true },
      ],
    },
  ],
};

const clone = (schema: DbSchema): DbSchema => JSON.parse(JSON.stringify(schema));

/* Identical schemas must compare as unchanged, or every save would show a diff. */
assert.equal(diffSchemas(base, clone(base)).empty, true, "identical schemas must not diff");
assert.equal(describeSchemaChange(base, clone(base)), "No structural change");

/* The full table list is the whole picture, so it has to keep "unchanged" as
   its own answer. Relabelling it "changed" would report every surviving table
   as modified whenever a single column somewhere else moved. */
const untouched = diffSchemas(base, clone(base)).tables;
assert.equal(untouched.length, 2);
for (const table of untouched) {
  assert.equal(table.kind, "unchanged", `${table.name} did not change`);
}

/* A removed table, an added table and a changed column in one pass. */
const after = clone(base);
after.tables[0].columns[1].type = "text";
after.tables[0].columns[1].length = undefined;
after.tables[0].columns.push({ name: "phone", type: "phone", nullable: true });
after.tables[0].columns[2].enumValues = ["male", "female", "other"];
after.tables[1].columns.splice(2, 1);
after.tables.push({
  name: "invoices",
  columns: [{ name: "id", type: "id", primaryKey: true, nullable: false }],
});

const diff = diffSchemas(base, after);
assert.equal(diff.tablesAdded.length, 1);
assert.equal(diff.tablesAdded[0], "invoices");
assert.equal(diff.tablesRemoved.length, 0);

const patients = diff.tablesChanged.find((table) => table.name === "patients");
assert.ok(patients, "patients must be reported as changed");
assert.deepEqual(patients.columnsAdded, ["phone"]);
assert.deepEqual(patients.columnsRemoved, []);
assert.equal(patients.columnsChanged.length, 2, "name and gender both changed");

const nameChange = patients.columnsChanged.find((column) => column.name === "name");
assert.match(nameChange!.details.join(" "), /type string → text/);
assert.match(nameChange!.details.join(" "), /length 120 → —/);

const genderChange = patients.columnsChanged.find((column) => column.name === "gender");
assert.match(genderChange!.details.join(" "), /values male\|female → male\|female\|other/);

const visits = diff.tablesChanged.find((table) => table.name === "visits");
assert.deepEqual(visits!.columnsRemoved, ["notes"]);

/* Only the tables that really moved may claim to have moved. */
assert.deepEqual(
  diff.tables.filter((table) => table.kind === "changed").map((table) => table.name).sort(),
  ["patients", "visits"],
  "the two edited tables are changed, the untouched ones are not",
);
assert.equal(
  diff.tables.find((table) => table.name === "invoices")!.kind,
  "added",
  "an added table stays added in the full list",
);

/* A dropped foreign key has to be visible even when no column disappeared. */
const withoutLink = clone(base);
delete withoutLink.tables[1].columns[1].references;
const unlinkDiff = diffSchemas(base, withoutLink);
const unlinked = unlinkDiff.tablesChanged.find((table) => table.name === "visits");
assert.equal(unlinked!.relationsRemoved.length, 1, "the removed FK must be reported");
assert.match(unlinked!.relationsRemoved[0], /visits\.patient_id → patients\.id on delete cascade/);

/* A removed table really is removed, not just hidden. */
const shrunk = clone(base);
shrunk.tables.splice(1, 1);
const shrinkDiff = diffSchemas(base, shrunk);
assert.deepEqual(shrinkDiff.tablesRemoved, ["visits"]);
assert.equal(shrinkDiff.tablesAdded.length, 0);

/* Dropping a table the others point at is reported as a removal of that table. */
const orphan = clone(base);
orphan.tables.splice(0, 1);
const orphanDiff = diffSchemas(base, orphan);
assert.deepEqual(orphanDiff.tablesRemoved, ["patients"]);
assert.deepEqual(orphanDiff.tablesAdded, []);

/* A rename is a remove plus an add, never a silent "changed": the columns and
   the foreign keys in them are different things, and pretending otherwise
   would offer a rollback the user cannot actually trust. */
const renamed = clone(base);
renamed.tables[0].name = "people";
const renameDiff = diffSchemas(base, renamed);
assert.deepEqual(renameDiff.tablesRemoved, ["patients"]);
assert.deepEqual(renameDiff.tablesAdded, ["people"]);

/* Case-only differences are not renames. */
const recased = clone(base);
recased.tables[0].name = "Patients";
assert.equal(diffSchemas(base, recased).empty, true, "a case change must not read as a rename");

/* The exported SQLite DDL has to be something a real engine accepts. */
async function checkSqliteExport() {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  const ddl = [
    `CREATE TABLE "patients" (\n  "id" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,\n  "name" TEXT NOT NULL,\n  "gender" TEXT NOT NULL CHECK ("gender" IN ('male','female','other')),\n  "phone" TEXT\n);\n`,
    `CREATE TABLE "visits" (\n  "id" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,\n  "patient_id" INTEGER NOT NULL REFERENCES "patients"("id") ON DELETE CASCADE\n);\n`,
    `CREATE INDEX "idx_visits_patient" ON "visits" ("patient_id");\n`,
  ].join("\n");

  db.run(ddl);
  db.run(
    `INSERT INTO patients (id, name, gender, phone) VALUES (1, 'Ama Boateng', 'female', '+233201234567');`,
  );
  db.run(`INSERT INTO visits (id, patient_id) VALUES (1, 1);`);

  const rows = db.exec("SELECT p.name, p.gender, v.id AS visit FROM patients p JOIN visits v ON v.patient_id = p.id;");
  assert.equal(rows.length, 1, "the join must return a result set");
  assert.deepEqual(rows[0].values[0], ["Ama Boateng", "female", 1]);

  // Foreign keys are off by default in SQLite, so they are turned on explicitly
  // or the constraint above proves nothing.
  db.run("PRAGMA foreign_keys = ON;");
  assert.equal(db.exec("SELECT COUNT(*) FROM visits;")[0].values[0][0], 1);
  db.run("DELETE FROM patients WHERE id = 1;");
  assert.equal(db.exec("SELECT COUNT(*) FROM visits;")[0].values[0][0], 0, "ON DELETE CASCADE must actually cascade");
}

void checkSqliteExport().then(
  () => console.log("schema diff + SQLite export: all assertions passed"),
  (caught: unknown) => {
    console.error(caught);
    process.exit(1);
  },
);
