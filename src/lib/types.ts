export const DIALECTS = ["mysql", "postgres", "sqlite", "supabase"] as const;
export type Dialect = (typeof DIALECTS)[number];

export const DIALECT_META: Record<
  Dialect,
  { label: string; blurb: string; file: string; accent: string; emoji: string }
> = {
  mysql: {
    label: "MySQL",
    blurb: "phpMyAdmin / MySQL Workbench ready",
    file: "database_mysql.sql",
    accent: "from-orange-400 to-amber-500",
    emoji: "🐬",
  },
  postgres: {
    label: "PostgreSQL",
    blurb: "pgAdmin / psql / Neon ready",
    file: "database_postgres.sql",
    accent: "from-sky-400 to-blue-600",
    emoji: "🐘",
  },
  sqlite: {
    label: "SQLite",
    blurb: "Single file, mobile & offline apps",
    file: "database_sqlite.sql",
    accent: "from-emerald-400 to-teal-600",
    emoji: "📦",
  },
  supabase: {
    label: "Supabase",
    blurb: "UUID keys + RLS policies included",
    file: "database_supabase.sql",
    accent: "from-green-400 to-emerald-600",
    emoji: "⚡",
  },
};

export type LogicalType =
  | "id"
  | "uuid"
  | "fk"
  | "string"
  | "text"
  | "email"
  | "phone"
  | "url"
  | "slug"
  | "int"
  | "bigint"
  | "decimal"
  | "money"
  | "bool"
  | "date"
  | "datetime"
  | "time"
  | "json"
  | "enum";

export const LOGICAL_TYPES: LogicalType[] = [
  "id",
  "uuid",
  "fk",
  "string",
  "text",
  "email",
  "phone",
  "url",
  "slug",
  "int",
  "bigint",
  "decimal",
  "money",
  "bool",
  "date",
  "datetime",
  "time",
  "json",
  "enum",
];

export interface ColumnRef {
  table: string;
  column: string;
  onDelete?: "cascade" | "set null" | "restrict";
}

export interface DbColumn {
  name: string;
  type: LogicalType;
  length?: number;
  nullable?: boolean;
  unique?: boolean;
  primaryKey?: boolean;
  defaultNow?: boolean;
  enumValues?: string[];
  references?: ColumnRef;
  note?: string;
}

export interface DbTable {
  name: string;
  description?: string;
  columns: DbColumn[];
}

export interface DbSchema {
  name: string;
  description: string;
  dialect: Dialect;
  tables: DbTable[];
  source: "ai" | "engine";
  notes?: string[];
}

export interface ProjectSummary {
  id: string;
  name: string;
  prompt: string;
  dialect: Dialect;
  tableCount: number;
  createdAt: string;
  updatedAt: string;
}

export type Plan = "free" | "monthly" | "yearly";

export const PLAN_LIMITS: Record<
  Plan,
  { maxTables: number; maxProjectsPerMonth: number; label: string }
> = {
  free: { maxTables: 5, maxProjectsPerMonth: 3, label: "Free" },
  monthly: { maxTables: 50, maxProjectsPerMonth: 1000, label: "Monthly Pro" },
  yearly: { maxTables: 50, maxProjectsPerMonth: 10000, label: "Yearly Pro" },
};
