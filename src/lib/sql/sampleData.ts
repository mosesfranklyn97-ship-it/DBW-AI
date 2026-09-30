import { faker } from "@faker-js/faker";
import type { DbColumn, DbSchema, DbTable, Dialect } from "@/lib/types";
import { quoteIdent, sqlString } from "@/lib/sql/generate";
import { singularize } from "@/lib/nlp/engine";

export type SheetValue = string | number | boolean | null;
export type SheetRow = Record<string, SheetValue>;
export type SheetData = Record<string, SheetRow[]>;

const LOCAL_FIRST_NAMES = [
  "Aminata",
  "Mohamed",
  "Fatmata",
  "Ibrahim",
  "Isatu",
  "Abu",
  "Mariama",
  "Sahr",
  "Kadiatu",
  "Alusine",
  "Chidinma",
  "Kwame",
  "Amara",
  "Zainab",
  "Tunde",
  "Grace",
];
const LOCAL_LAST_NAMES = [
  "Kamara",
  "Sesay",
  "Bangura",
  "Conteh",
  "Koroma",
  "Turay",
  "Jalloh",
  "Mansaray",
  "Okafor",
  "Mensah",
  "Dumbuya",
  "Fofanah",
];

function hashSeed(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash % 100000);
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function formatDateTime(date: Date): string {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(
    date.getUTCHours(),
  )}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
}

function formatDate(date: Date): string {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

function personName(): string {
  return `${faker.helpers.arrayElement(LOCAL_FIRST_NAMES)} ${faker.helpers.arrayElement(LOCAL_LAST_NAMES)}`;
}

function englishSentence(tableName: string): string {
  if (/product|menu|item|crop|service|book/.test(tableName)) return faker.commerce.productDescription();
  return faker.helpers.arrayElement([
    `${faker.company.catchPhrase()}.`,
    `Follow up scheduled with ${personName()} before the end of the week.`,
    `Reviewed by ${personName()} and approved for the next stage.`,
    `Notes captured during the ${faker.helpers.arrayElement(["morning", "afternoon", "evening"])} session.`,
    `${faker.company.buzzPhrase()} — no outstanding issues reported.`,
  ]);
}

function valueForColumn(
  column: DbColumn,
  table: DbTable,
  index: number,
  dialect: Dialect,
): SheetValue {
  const name = column.name;

  if (column.type === "id") {
    return dialect === "supabase" ? faker.string.uuid() : index + 1;
  }
  if (column.type === "enum" && column.enumValues?.length) {
    return faker.helpers.arrayElement(column.enumValues);
  }

  switch (true) {
    case /^(full_name|contact_person|leader|manager|paid_by|owner|author|emergency_contact)$/.test(name):
      return personName();
    case /^name$/.test(name) &&
      /(user|customer|patient|doctor|nurse|student|teacher|parent|member|guest|employee|driver|agent|trainer|staff|person|author|contact|lead|barber|worker)/.test(
        `${table.name} ${name}`,
      ):
      return personName();
    case /first_name/.test(name):
      return faker.helpers.arrayElement(LOCAL_FIRST_NAMES);
    case /last_name|surname/.test(name):
      return faker.helpers.arrayElement(LOCAL_LAST_NAMES);
    case /(^title$|subject_title)/.test(name):
      return faker.helpers.arrayElement([
        faker.commerce.productName(),
        faker.company.catchPhrase(),
        faker.lorem.words({ min: 2, max: 5 }),
      ]);
    case /^name$/.test(name):
      if (/product|item|menu|crop/.test(table.name)) return faker.commerce.productName();
      if (/categor|department|ministr|team|subject|class/.test(table.name)) {
        return faker.helpers.arrayElement([
          "Operations",
          "Finance",
          "Science",
          "Logistics",
          "Marketing",
          "Support",
          "Research",
          "Outreach",
        ]);
      }
      if (/compan|supplier|farm|branch|warehouse/.test(table.name)) return faker.company.name();
      return faker.commerce.productName();
    default:
      break;
  }

  switch (column.type) {
    case "email":
      return faker.internet.email({ provider: "example.com" }).toLowerCase();
    case "phone":
      return `+232 ${faker.string.numeric(2)} ${faker.string.numeric(6)}`;
    case "url":
      if (/image|photo|avatar|cover/.test(name)) return `https://cdn.example.com/${faker.string.alphanumeric(8)}.jpg`;
      return faker.internet.url();
    case "slug":
      return faker.helpers.slugify(faker.commerce.productName()).toLowerCase();
    case "text":
      return englishSentence(table.name);
    case "money":
      return Number(faker.commerce.price({ min: 10, max: 5000, dec: 2 }));
    case "decimal":
      if (/rating/.test(name)) return Number(faker.number.float({ min: 1, max: 5, fractionDigits: 1 }));
      return Number(faker.number.float({ min: 1, max: 500, fractionDigits: 2 }));
    case "int":
      if (/age/.test(name)) return faker.number.int({ min: 5, max: 78 });
      if (/(quantity|qty|stock|capacity|copies|beds|count|points|size)/.test(name)) {
        return faker.number.int({ min: 1, max: 250 });
      }
      if (/year/.test(name)) return faker.number.int({ min: 1990, max: 2025 });
      if (/rating|score/.test(name)) return faker.number.int({ min: 1, max: 5 });
      if (/(minutes|duration)/.test(name)) return faker.helpers.arrayElement([15, 30, 45, 60, 90]);
      if (/floor|level/.test(name)) return faker.number.int({ min: 1, max: 12 });
      return faker.number.int({ min: 1, max: 100 });
    case "bigint":
      return faker.number.int({ min: 10000, max: 9999999 });
    case "bool":
      return faker.datatype.boolean();
    case "date":
      return formatDate(faker.date.between({ from: "2023-01-01", to: "2026-06-30" }));
    case "datetime":
      return formatDateTime(faker.date.between({ from: "2024-06-01", to: "2026-06-30" }));
    case "time":
      return `${pad(faker.number.int({ min: 7, max: 20 }))}:${faker.helpers.arrayElement(["00", "15", "30", "45"])}:00`;
    case "json":
      return JSON.stringify({ source: faker.helpers.arrayElement(["web", "mobile", "api"]) });
    case "uuid":
      return faker.string.uuid();
    default:
      break;
  }

  // string fallbacks driven by column name
  if (/password/.test(name)) return `$2y$10$${faker.string.alphanumeric(22)}`;
  if (/(code|number|reference|sku|isbn|plate|license)/.test(name)) {
    return `${singularize(table.name).slice(0, 3).toUpperCase()}-${faker.string.alphanumeric(6).toUpperCase()}`;
  }
  if (/address/.test(name)) return faker.location.streetAddress();
  if (/city|town/.test(name)) {
    return faker.helpers.arrayElement(["Freetown", "Bo", "Kenema", "Makeni", "Accra", "Lagos", "Nairobi"]);
  }
  if (/country|nationality/.test(name)) return faker.location.country();
  if (/currency/.test(name)) return faker.helpers.arrayElement(["SLE", "USD", "GHS", "NGN", "EUR"]);
  if (/(location|venue|pickup|dropoff|route)/.test(name)) return faker.location.streetAddress();
  if (/(specialization|specialty|position|job_title|occupation|industry)/.test(name)) {
    return faker.person.jobTitle();
  }
  if (/(term|period|semester)/.test(name)) {
    return faker.helpers.arrayElement(["Term 1 2025", "Term 2 2025", "Term 3 2025", "2026 Q1"]);
  }
  if (/(shift|meeting_day|day)/.test(name)) {
    return faker.helpers.arrayElement(["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]);
  }
  if (/(room|table_number)/.test(name)) return `${faker.string.alpha({ casing: "upper", length: 1 })}${faker.number.int({ min: 100, max: 499 })}`;
  if (/blood_group/.test(name)) return faker.helpers.arrayElement(["A+", "A-", "B+", "O+", "O-", "AB+"]);
  if (/(make|brand)/.test(name)) return faker.vehicle.manufacturer();
  if (/model/.test(name)) return faker.vehicle.model();
  if (/(description|summary|excerpt|note|remark|instruction|reason|diagnosis|treatment|comment|body|bio)/.test(name)) {
    return englishSentence(table.name);
  }
  if (/(letter_grade|grade)/.test(name)) return faker.helpers.arrayElement(["A", "B", "C", "D"]);
  if (/(variety|quality)/.test(name)) return faker.helpers.arrayElement(["Grade A", "Standard", "Premium"]);
  if (/(mime|file_name)/.test(name)) return `${faker.lorem.slug(2)}.pdf`;
  if (/key/.test(name)) return faker.lorem.slug(2).replace(/-/g, "_");
  if (/value/.test(name)) return faker.lorem.words(2);
  if (/action/.test(name)) return faker.helpers.arrayElement(["created", "updated", "deleted", "login"]);
  if (/ip_address/.test(name)) return faker.internet.ipv4();
  if (/entity/.test(name)) return faker.helpers.arrayElement(["users", "orders", "products"]);
  if (/courier/.test(name)) return faker.helpers.arrayElement(["DHL Express", "Leone Logistics", "SwiftRide"]);
  if (/source/.test(name)) return faker.helpers.arrayElement(["website", "referral", "ads", "walk_in"]);

  return faker.commerce.productName();
}

export function generateSampleRows(schema: DbSchema, rowsPerTable = 20): SheetData {
  faker.seed(hashSeed(`${schema.name}:${schema.tables.map((table) => table.name).join(",")}`));
  const data: SheetData = {};

  // Pass one fills in every value except the foreign keys. The keys themselves
  // are assigned in declaration order, and a child table is very often declared
  // before its parent, so at this point a parent table's ids do not all exist
  // yet. Filling in foreign keys here is what produced ids such as 84 and 23
  // against a 20-row parent, which made the whole script fail to import.
  for (const table of schema.tables) {
    const rows: SheetRow[] = [];
    const count = /^(categor|department|room_type|subject|ministr|team|tag|setting|warehouse|branch)/.test(table.name)
      ? Math.min(rowsPerTable, 8)
      : rowsPerTable;

    for (let index = 0; index < count; index += 1) {
      const row: SheetRow = {};
      for (const column of table.columns) {
        row[column.name] = column.references ? null : valueForColumn(column, table, index, schema.dialect);
      }
      rows.push(row);
    }
    data[table.name] = rows;
  }

  // Pass two links the children to the parents, now that every table has its
  // own keys regardless of the order the tables were declared in.
  const parentIds: Record<string, SheetValue[]> = {};
  for (const table of schema.tables) {
    const pk = table.columns.find((column) => column.primaryKey || column.type === "id");
    const rows = data[table.name] ?? [];
    parentIds[table.name] = pk ? rows.map((row) => row[pk.name]) : [];
  }

  for (const table of schema.tables) {
    const rows = data[table.name] ?? [];
    for (const column of table.columns) {
      if (!column.references) continue;
      const pool = parentIds[column.references.table] ?? [];
      for (const row of rows) {
        row[column.name] = pool.length > 0 ? faker.helpers.arrayElement(pool) : null;
      }
    }
  }

  return data;
}

function literal(value: SheetValue, column: DbColumn, dialect: Dialect): string {
  if (value === null || value === undefined) return "NULL";
  if (column.type === "bool") {
    const boolValue = Boolean(value);
    if (dialect === "postgres" || dialect === "supabase") return boolValue ? "TRUE" : "FALSE";
    return boolValue ? "1" : "0";
  }
  if (typeof value === "number") return String(value);
  return sqlString(String(value));
}

/**
 * Parents before children.
 *
 * The tables are stored in the order the user described them, which is regularly
 * the reverse of a valid insert order — an `appointments` table is often
 * mentioned before the `patients` it points at. Inserting in that order fails
 * on the first foreign key, so the order is resolved by dependency rather than
 * trusted. A cycle cannot be topologically sorted and would fail either way, so
 * it is broken at the point it is detected instead of looping forever.
 */
function orderTablesForInsert(schema: DbSchema): DbTable[] {
  const remaining = new Map(schema.tables.map((table) => [table.name, table]));
  const ordered: DbTable[] = [];
  const placed = new Set<string>();

  while (remaining.size > 0) {
    const ready = [...remaining.values()].filter((table) =>
      table.columns.every(
        (column) => !column.references || placed.has(column.references.table) || !remaining.has(column.references.table),
      ),
    );

    // Nothing is ready, so the remainder is part of a reference cycle. Every
    // table that was not placed is emitted now, in the order it was declared.
    const batch = ready.length > 0 ? ready : [...remaining.values()];
    for (const table of batch) {
      ordered.push(table);
      placed.add(table.name);
      remaining.delete(table.name);
    }
  }

  return ordered;
}

export function generateInsertSQL(schema: DbSchema, dialect: Dialect, data: SheetData): string {
  const lines: string[] = [];
  lines.push("-- ==========================================================");
  lines.push(`-- Sample data for ${schema.name.replace(/\s+/g, " ").trim()}`);
  lines.push(`-- Generated by DBW AI · safe to run right after database.sql`);
  lines.push(`-- Target: ${dialect.toUpperCase()}`);
  lines.push("-- ==========================================================");
  lines.push("");

  if (dialect === "mysql") lines.push("SET FOREIGN_KEY_CHECKS = 0;", "");
  if (dialect === "sqlite") lines.push("BEGIN TRANSACTION;", "");

  for (const table of orderTablesForInsert(schema)) {
    const rows = data[table.name] ?? [];
    if (rows.length === 0) continue;

    // Skip auto-increment ids so the database assigns them (except Supabase uuids)
    const columns = table.columns.filter((column) => !(column.type === "id" && dialect !== "supabase"));
    const columnList = columns.map((column) => quoteIdent(column.name, dialect)).join(", ");

    lines.push(`-- ${rows.length} rows for ${table.name}`);
    lines.push(`INSERT INTO ${quoteIdent(table.name, dialect)} (${columnList}) VALUES`);
    const values = rows.map(
      (row) => `  (${columns.map((column) => literal(row[column.name] ?? null, column, dialect)).join(", ")})`,
    );
    lines.push(`${values.join(",\n")};`);
    lines.push("");
  }

  if (dialect === "mysql") lines.push("SET FOREIGN_KEY_CHECKS = 1;", "");
  if (dialect === "sqlite") lines.push("COMMIT;", "");

  lines.push("-- End of sample data");
  return lines.join("\n");
}
