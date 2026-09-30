import type { DbColumn, DbSchema, DbTable, Dialect } from "@/lib/types";

const RESERVED = new Set([
  "order",
  "orders",
  "group",
  "user",
  "users",
  "table",
  "select",
  "from",
  "where",
  "class",
  "classes",
  "key",
  "index",
  "desc",
  "references",
  "grade",
  "read",
  "level",
]);

export function quoteIdent(name: string, dialect: Dialect): string {
  if (dialect === "mysql") return `\`${name.replace(/`/g, "``")}\``;
  if (RESERVED.has(name.toLowerCase()) || /[^a-z0-9_]/.test(name)) {
    return `"${name.replace(/"/g, '""')}"`;
  }
  return name;
}

/**
 * Renders a string literal for DDL. Escaping backslashes as well as quotes
 * matters because MySQL still treats `\` as an escape character by default,
 * so an unescaped value could otherwise terminate the literal early.
 */
export function sqlString(value: string): string {
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "''")}'`;
}

/**
 * Collapses a value onto a single line. Table and schema names come from user
 * input and the AI, and are emitted as `--` comments; a newline in one would
 * close the comment and turn the rest of the name into executable SQL.
 */
function sqlComment(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function enumTypeName(table: string, column: string): string {
  return `${table}_${column}_enum`;
}

export function sqlTypeFor(column: DbColumn, table: DbTable, dialect: Dialect): string {
  const length = column.length ?? 255;
  switch (column.type) {
    case "id":
      if (dialect === "mysql") return "INT UNSIGNED NOT NULL AUTO_INCREMENT";
      if (dialect === "sqlite") return "INTEGER PRIMARY KEY AUTOINCREMENT";
      if (dialect === "supabase") return "uuid NOT NULL DEFAULT gen_random_uuid()";
      return "SERIAL";
    case "fk":
      if (dialect === "mysql") return "INT UNSIGNED";
      if (dialect === "sqlite") return "INTEGER";
      if (dialect === "supabase") return "uuid";
      return "INTEGER";
    case "uuid":
      if (dialect === "mysql") return "CHAR(36)";
      if (dialect === "sqlite") return "TEXT";
      return "uuid";
    case "string":
    case "slug":
      return dialect === "sqlite" ? "TEXT" : `VARCHAR(${length})`;
    case "email":
      return dialect === "sqlite" ? "TEXT" : `VARCHAR(${column.length ?? 160})`;
    case "phone":
      return dialect === "sqlite" ? "TEXT" : `VARCHAR(${column.length ?? 25})`;
    case "url":
      return dialect === "sqlite" ? "TEXT" : `VARCHAR(${column.length ?? 255})`;
    case "text":
      return dialect === "mysql" ? "TEXT" : "TEXT";
    case "int":
      return dialect === "sqlite" ? "INTEGER" : "INT";
    case "bigint":
      return dialect === "sqlite" ? "INTEGER" : "BIGINT";
    case "decimal":
      return dialect === "sqlite" ? "REAL" : "DECIMAL(10,2)";
    case "money":
      return dialect === "sqlite" ? "REAL" : "DECIMAL(12,2)";
    case "bool":
      if (dialect === "mysql") return "TINYINT(1)";
      if (dialect === "sqlite") return "INTEGER";
      return "BOOLEAN";
    case "date":
      return "DATE";
    case "datetime":
      if (dialect === "mysql") return "DATETIME";
      if (dialect === "sqlite") return "TEXT";
      return "TIMESTAMPTZ";
    case "time":
      return dialect === "sqlite" ? "TEXT" : "TIME";
    case "json":
      if (dialect === "mysql") return "JSON";
      if (dialect === "sqlite") return "TEXT";
      return "JSONB";
    case "enum": {
      const values = column.enumValues ?? ["active", "inactive"];
      const literals = values.map((value) => sqlString(value)).join(", ");
      if (dialect === "mysql") return `ENUM(${literals})`;
      if (dialect === "sqlite") return "TEXT";
      return enumTypeName(table.name, column.name);
    }
    default:
      return dialect === "sqlite" ? "TEXT" : `VARCHAR(${length})`;
  }
}

function defaultClause(column: DbColumn, dialect: Dialect): string {
  if (column.defaultNow) {
    if (dialect === "mysql") return " DEFAULT CURRENT_TIMESTAMP";
    if (dialect === "sqlite") return " DEFAULT CURRENT_TIMESTAMP";
    return " DEFAULT now()";
  }
  if (column.type === "bool") return dialect === "postgres" || dialect === "supabase" ? " DEFAULT true" : " DEFAULT 1";
  if (column.type === "enum" && column.enumValues?.length && /^(status|state)$/.test(column.name)) {
    return ` DEFAULT ${sqlString(column.enumValues[0])}`;
  }
  return "";
}

function columnDefinition(column: DbColumn, table: DbTable, dialect: Dialect): string {
  const parts: string[] = [quoteIdent(column.name, dialect), sqlTypeFor(column, table, dialect)];

  if (column.type === "id") {
    if (dialect === "mysql") {
      // AUTO_INCREMENT already carries NOT NULL; PK is added as a table constraint
    } else if (dialect === "sqlite") {
      return `  ${parts.join(" ")}`;
    } else {
      parts.push("PRIMARY KEY");
    }
  } else {
    if (!column.nullable) parts.push("NOT NULL");
    if (column.unique) parts.push("UNIQUE");
    if (column.type === "enum" && dialect === "sqlite" && column.enumValues?.length) {
      parts.push(
        `CHECK (${quoteIdent(column.name, dialect)} IN (${column.enumValues.map((v) => sqlString(v)).join(", ")}))`,
      );
    }
    const fallback = defaultClause(column, dialect);
    if (fallback) parts.push(fallback.trim());
  }

  return `  ${parts.join(" ")}`;
}

export function generateDDL(schema: DbSchema, dialect: Dialect): string {
  const lines: string[] = [];
  const stamp = new Date().toISOString().replace("T", " ").slice(0, 19);

  lines.push("-- ==========================================================");
  lines.push(`-- ${sqlComment(schema.name)}`);
  lines.push("-- Generated by DBW AI · ZeroBox AI Schema Engine");
  lines.push(`-- Target: ${dialect.toUpperCase()}  |  ${stamp} UTC`);
  if (schema.description) lines.push(`-- Brief: ${sqlComment(schema.description).slice(0, 220)}`);
  lines.push("-- ==========================================================");

  lines.push("");

  if (dialect === "mysql") {
    lines.push("SET FOREIGN_KEY_CHECKS = 0;");
    lines.push("SET NAMES utf8mb4;");
    lines.push("");
  }
  if (dialect === "sqlite") {
    lines.push("PRAGMA foreign_keys = ON;");
    lines.push("");
  }
  if (dialect === "supabase" || dialect === "postgres") {
    lines.push('CREATE EXTENSION IF NOT EXISTS "pgcrypto";');
    lines.push("");
  }

  // drop in reverse dependency order
  const dropOrder = [...schema.tables].reverse();
  for (const table of dropOrder) {
    const suffix = dialect === "postgres" || dialect === "supabase" ? " CASCADE" : "";
    lines.push(`DROP TABLE IF EXISTS ${quoteIdent(table.name, dialect)}${suffix};`);
  }
  lines.push("");

  if (dialect === "postgres" || dialect === "supabase") {
    const enums: string[] = [];
    for (const table of schema.tables) {
      for (const column of table.columns) {
        if (column.type === "enum" && column.enumValues?.length) {
          const typeName = quoteIdent(enumTypeName(table.name, column.name), dialect);
          enums.push(
            `DROP TYPE IF EXISTS ${typeName} CASCADE;\nCREATE TYPE ${typeName} AS ENUM (${column.enumValues
              .map((value) => sqlString(value))
              .join(", ")});`,
          );
        }
      }
    }
    if (enums.length) {
      lines.push("-- Enum types");
      lines.push(enums.join("\n"));
      lines.push("");
    }
  }

  for (const table of schema.tables) {
    if (table.description) lines.push(`-- ${sqlComment(table.description)}`);
    lines.push(`CREATE TABLE ${quoteIdent(table.name, dialect)} (`);

    const definitions = table.columns.map((column) => columnDefinition(column, table, dialect));
    const constraints: string[] = [];

    const pk = table.columns.find((column) => column.type === "id" || column.primaryKey);
    if (pk && dialect === "mysql") {
      constraints.push(`  PRIMARY KEY (${quoteIdent(pk.name, dialect)})`);
    }
    if (pk && dialect === "supabase" && pk.type === "id") {
      // supabase uses uuid default; PRIMARY KEY already appended in columnDefinition
    }

    for (const column of table.columns) {
      if (!column.references) continue;
      const onDelete = (column.references.onDelete ?? "cascade").toUpperCase();
      constraints.push(
        `  CONSTRAINT ${quoteIdent(`fk_${table.name}_${column.name}`, dialect)} FOREIGN KEY (${quoteIdent(
          column.name,
          dialect,
        )}) REFERENCES ${quoteIdent(column.references.table, dialect)} (${quoteIdent(
          column.references.column,
          dialect,
        )}) ON DELETE ${onDelete} ON UPDATE CASCADE`,
      );
    }

    lines.push([...definitions, ...constraints].join(",\n"));
    lines.push(dialect === "mysql" ? ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;" : ");");

    for (const column of table.columns) {
      if (column.references) {
        lines.push(
          `CREATE INDEX ${quoteIdent(`idx_${table.name}_${column.name}`, dialect)} ON ${quoteIdent(
            table.name,
            dialect,
          )} (${quoteIdent(column.name, dialect)});`,
        );
      }
    }
    lines.push("");
  }

  if (dialect === "mysql") {
    lines.push("SET FOREIGN_KEY_CHECKS = 1;");
    lines.push("");
  }

  if (dialect === "supabase") {
    lines.push("-- Row Level Security (Supabase best practice)");
    for (const table of schema.tables) {
      lines.push(`ALTER TABLE ${quoteIdent(table.name, dialect)} ENABLE ROW LEVEL SECURITY;`);
      lines.push(
        `CREATE POLICY "Enable read access for authenticated users" ON ${quoteIdent(
          table.name,
          dialect,
        )} FOR SELECT TO authenticated USING (true);`,
      );
      lines.push(
        `CREATE POLICY "Enable write access for authenticated users" ON ${quoteIdent(
          table.name,
          dialect,
        )} FOR ALL TO authenticated USING (true) WITH CHECK (true);`,
      );
    }
    lines.push("");
  }

  lines.push("-- End of schema");
  return lines.join("\n");
}
