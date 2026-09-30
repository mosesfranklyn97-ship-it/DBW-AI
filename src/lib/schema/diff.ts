import type { DbColumn, DbSchema, DbTable } from "@/lib/types";

/**
 * A schema is compared as a plain structure, never as generated SQL text. Two
 * schemas that produce identical DDL must compare as unchanged, otherwise every
 * "save" would look like a rewrite and the history panel would fill with noise.
 */

export type ChangeKind = "added" | "removed" | "changed";

export interface ColumnChange {
  name: string;
  kind: ChangeKind;
  /** Human-readable "what moved" lines, already formatted for display. */
  details: string[];
}

export interface TableChange {
  name: string;
  kind: ChangeKind | "unchanged";
  columnsAdded: string[];
  columnsRemoved: string[];
  columnsChanged: ColumnChange[];
  /** The key/foreign-key picture before and after, for the diagram overlay. */
  relationsAdded: string[];
  relationsRemoved: string[];
}

export interface SchemaDiff {
  tablesAdded: string[];
  tablesRemoved: string[];
  tablesChanged: TableChange[];
  /**
   * Every table in the result, in its new order, for rendering both sides.
   * "unchanged" is kept distinct from "changed" here: this list is the full
   * picture, and collapsing the two would report every surviving table as
   * modified even when one column elsewhere moved.
   */
  tables: { name: string; kind: ChangeKind | "unchanged" }[];
  empty: boolean;
  counts: { added: number; removed: number; changed: number };
}

const lower = (value: string) => value.toLowerCase();

function byName<T extends { name: string }>(items: T[]): Map<string, T> {
  return new Map(items.map((item) => [lower(item.name), item]));
}

function relationLabel(table: string, column: DbColumn): string {
  const target = column.references;
  if (!target) return `${table}.${column.name}`;
  const rule = target.onDelete ? ` on delete ${target.onDelete}` : "";
  return `${table}.${column.name} → ${target.table}.${target.column}${rule}`;
}

function relationsOf(table: DbTable): Map<string, string> {
  const map = new Map<string, string>();
  for (const column of table.columns) {
    if (!column.references) continue;
    const label = relationLabel(table.name, column);
    map.set(lower(label), label);
  }
  return map;
}

function describeColumn(before: DbColumn, after: DbColumn): string[] {
  const details: string[] = [];

  if (before.type !== after.type) details.push(`type ${before.type} → ${after.type}`);
  if ((before.length ?? null) !== (after.length ?? null)) {
    details.push(`length ${before.length ?? "—"} → ${after.length ?? "—"}`);
  }
  if (Boolean(before.nullable) !== Boolean(after.nullable)) {
    details.push(after.nullable ? "now nullable" : "now required");
  }
  if (Boolean(before.primaryKey) !== Boolean(after.primaryKey)) {
    details.push(after.primaryKey ? "became the primary key" : "no longer the primary key");
  }
  if (Boolean(before.unique) !== Boolean(after.unique)) {
    details.push(after.unique ? "now unique" : "no longer unique");
  }
  if (Boolean(before.defaultNow) !== Boolean(after.defaultNow)) {
    details.push(after.defaultNow ? "defaults to now()" : "no longer defaults to now()");
  }

  const beforeEnum = (before.enumValues ?? []).join("|");
  const afterEnum = (after.enumValues ?? []).join("|");
  if (beforeEnum !== afterEnum) {
    details.push(`values ${beforeEnum || "—"} → ${afterEnum || "—"}`);
  }

  const beforeRef = before.references ? relationLabel("", before) : null;
  const afterRef = after.references ? relationLabel("", after) : null;
  if (beforeRef !== afterRef) {
    details.push(afterRef ? `now points at ${afterRef}` : "foreign key removed");
  }

  return details;
}

export function diffTable(before: DbTable, after: DbTable): TableChange {
  const beforeColumns = byName(before.columns);
  const afterColumns = byName(after.columns);

  const columnsAdded: string[] = [];
  const columnsRemoved: string[] = [];
  const columnsChanged: ColumnChange[] = [];

  for (const column of after.columns) {
    const previous = beforeColumns.get(lower(column.name));
    if (!previous) {
      columnsAdded.push(column.name);
    } else {
      const details = describeColumn(previous, column);
      if (details.length > 0) columnsChanged.push({ name: column.name, kind: "changed", details });
    }
  }
  for (const column of before.columns) {
    if (!afterColumns.has(lower(column.name))) columnsRemoved.push(column.name);
  }

  const beforeRelations = relationsOf(before);
  const afterRelations = relationsOf(after);
  const relationsAdded = [...afterRelations.entries()]
    .filter(([key]) => !beforeRelations.has(key))
    .map(([, label]) => label);
  const relationsRemoved = [...beforeRelations.entries()]
    .filter(([key]) => !afterRelations.has(key))
    .map(([, label]) => label);

  const kind: TableChange["kind"] =
    columnsAdded.length || columnsRemoved.length || columnsChanged.length || relationsAdded.length || relationsRemoved.length
      ? "changed"
      : "unchanged";

  return { name: after.name, kind, columnsAdded, columnsRemoved, columnsChanged, relationsAdded, relationsRemoved };
}

export function diffSchemas(before: DbSchema, after: DbSchema): SchemaDiff {
  const beforeTables = byName(before.tables);
  const afterTables = byName(after.tables);

  const tablesAdded: string[] = [];
  const tablesRemoved: string[] = [];
  const tablesChanged: TableChange[] = [];
  const tables: { name: string; kind: ChangeKind | "unchanged" }[] = [];

  for (const table of after.tables) {
    const previous = beforeTables.get(lower(table.name));
    if (!previous) {
      tablesAdded.push(table.name);
      tables.push({ name: table.name, kind: "added" });
    } else {
      const change = diffTable(previous, table);
      if (change.kind === "changed") {
        tablesChanged.push(change);
      }
      tables.push({ name: table.name, kind: change.kind });
    }
  }

  for (const table of before.tables) {
    if (!afterTables.has(lower(table.name))) {
      tablesRemoved.push(table.name);
      tables.push({ name: table.name, kind: "removed" });
    }
  }

  return {
    tablesAdded,
    tablesRemoved,
    tablesChanged,
    tables,
    empty: tablesAdded.length === 0 && tablesRemoved.length === 0 && tablesChanged.length === 0,
    counts: {
      added: tablesAdded.length,
      removed: tablesRemoved.length,
      changed: tablesChanged.length,
    },
  };
}

/** One-line summary used for a revision row and for the toast after a save. */
export function describeSchemaChange(before: DbSchema, after: DbSchema): string {
  const diff = diffSchemas(before, after);
  if (diff.empty) return "No structural change";

  const parts: string[] = [];
  if (diff.tablesAdded.length) parts.push(`+${diff.tablesAdded.map((name) => `\`${name}\``).join(", ")}`);
  if (diff.tablesRemoved.length) parts.push(`−${diff.tablesRemoved.map((name) => `\`${name}\``).join(", ")}`);
  for (const table of diff.tablesChanged) {
    const bits: string[] = [];
    if (table.columnsAdded.length) bits.push(`+${table.columnsAdded.length} col`);
    if (table.columnsRemoved.length) bits.push(`−${table.columnsRemoved.length} col`);
    if (table.columnsChanged.length) bits.push(`~${table.columnsChanged.length} col`);
    if (table.relationsAdded.length) bits.push(`+${table.relationsAdded.length} link`);
    if (table.relationsRemoved.length) bits.push(`−${table.relationsRemoved.length} link`);
    parts.push(`\`${table.name}\` ${bits.join(" ")}`);
  }
  return parts.join(" · ");
}
