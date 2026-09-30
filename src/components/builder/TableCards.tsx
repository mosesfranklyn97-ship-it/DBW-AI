"use client";

import { useState } from "react";
import ConfirmSheet, { type ConfirmRequest } from "@/components/ConfirmSheet";
import { inferColumn, tableNameFor } from "@/lib/nlp/engine";
import { useMediaQuery } from "@/lib/client/media";
import { LOGICAL_TYPES, type DbSchema, type DbTable, type LogicalType } from "@/lib/types";

interface Props {
  schema: DbSchema;
  maxTables: number;
  onChange: (schema: DbSchema) => void;
}

const TYPE_COLORS: Partial<Record<LogicalType, string>> = {
  id: "bg-amber-100 text-amber-800",
  fk: "bg-sky-100 text-sky-800",
  enum: "bg-fuchsia-100 text-fuchsia-800",
  money: "bg-emerald-100 text-emerald-800",
  datetime: "bg-violet-100 text-violet-800",
  date: "bg-violet-100 text-violet-800",
  bool: "bg-rose-100 text-rose-800",
};

/**
 * Removes foreign keys that point at a table or column which no longer exists.
 *
 * Without this, deleting a table leaves sibling `REFERENCES <gone>` clauses in
 * the generated DDL. Postgres and SQLite then fail the whole import on the
 * constraint, and MySQL fails when the FK checks are re-enabled - so one
 * mis-tap produces a database.sql that cannot be loaded at all.
 */
function dropDanglingKeys(tables: DbTable[]): DbTable[] {
  const tableNames = new Set(tables.map((table) => table.name));
  return tables.map((table) => {
    const columns = table.columns.map((column) => {
      if (!column.references) return column;
      const target = tableNames.has(column.references.table);
      if (!target) return { ...column, type: "int" as LogicalType, references: undefined };
      return column;
    });
    return { ...table, columns };
  });
}

/** Same as above but also for a specific column that was removed. */
function dropKeysToColumn(tables: DbTable[], tableName: string, columnName: string): DbTable[] {
  return tables.map((table) => ({
    ...table,
    columns: table.columns.map((column) =>
      column.references?.table === tableName && column.references.column === columnName
        ? { ...column, type: "int" as LogicalType, references: undefined }
        : column,
    ),
  }));
}

function countIncomingKeys(tables: DbTable[], name: string): number {
  return tables.reduce(
    (total, table) =>
      total + table.columns.filter((column) => column.references?.table === name).length,
    0,
  );
}

export default function TableCards({ schema, maxTables, onChange }: Props) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const [newTable, setNewTable] = useState("");
  const [newColumn, setNewColumn] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<ConfirmRequest | null>(null);
  const [applyDelete, setApplyDelete] = useState<(() => void) | null>(null);
  const touch = useMediaQuery("(hover: none)");

  const update = (tables: DbTable[]) => onChange({ ...schema, tables: dropDanglingKeys(tables) });

  const reorder = (from: number, to: number) => {
    if (from === to) return;
    if (to < 0 || to >= schema.tables.length) return;
    const tables = [...schema.tables];
    const [moved] = tables.splice(from, 1);
    tables.splice(to, 0, moved);
    update(tables);
  };

  const addTable = () => {
    const name = tableNameFor(newTable);
    if (!name || schema.tables.some((table) => table.name === name)) return;
    if (schema.tables.length >= maxTables) return;
    update([
      ...schema.tables,
      {
        name,
        description: "Custom table",
        columns: [
          { name: "id", type: "id", primaryKey: true },
          { name: "name", type: "string", length: 150 },
          { name: "created_at", type: "datetime", defaultNow: true },
        ],
      },
    ]);
    setNewTable("");
  };

  const addColumn = (tableName: string) => {
    const raw = (newColumn[tableName] ?? "").trim();
    if (!raw) return;
    const tables = schema.tables.map((table) => {
      if (table.name !== tableName) return table;
      const column = inferColumn(raw, schema.tables.map((item) => item.name));
      if (table.columns.some((item) => item.name === column.name)) return table;
      return { ...table, columns: [...table.columns, column] };
    });
    update(tables);
    setNewColumn((state) => ({ ...state, [tableName]: "" }));
  };

  /**
   * Renaming a table also renames the key its "add column" box is stored under,
   * otherwise a half-typed column name is silently dropped on rename.
   */
  const renameTable = (index: number, raw: string) => {
    const current = schema.tables[index];
    const next = raw.replace(/[^a-zA-Z0-9_]/g, "_").toLowerCase();
    if (!next || next === current.name) return;
    if (schema.tables.some((table) => table.name === next)) return;

    const relinked = schema.tables.map((table) => ({
      ...table,
      name: table.name === current.name ? next : table.name,
      columns: table.columns.map((column) =>
        column.references?.table === current.name && column.references.table !== next
          ? { ...column, references: { ...column.references, table: next } }
          : column,
      ),
    }));
    update(relinked);
    setNewColumn((state) => {
      if (!(current.name in state)) return state;
      const { [current.name]: carried, ...rest } = state;
      return next in rest ? rest : { ...rest, [next]: carried };
    });
  };

  /**
   * A renamed column must be followed by every foreign key that points at it,
   * otherwise the export references a column that no longer exists and the
   * import fails on the constraint.
   */
  const renameColumn = (tableIndex: number, columnIndex: number, raw: string) => {
    const table = schema.tables[tableIndex];
    const current = table.columns[columnIndex];
    const next = raw.replace(/[^a-zA-Z0-9_]/g, "_").toLowerCase();
    if (!next || next === current.name) return;
    if (table.columns.some((column) => column.name === next)) return;

    const tables = schema.tables.map((item, itemIndex) => ({
      ...item,
      columns: item.columns.map((column, index) => {
        if (itemIndex === tableIndex && index === columnIndex) return { ...column, name: next };
        if (column.references?.table === table.name && column.references.column === current.name) {
          return { ...column, references: { ...column.references, column: next } };
        }
        return column;
      }),
    }));
    update(tables);
  };

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {schema.tables.map((table, index) => (
        <div
          key={index}
          draggable={!touch}
          onDragStart={() => setDragIndex(index)}
          onDragEnter={() => setOverIndex(index)}
          onDragOver={(event) => event.preventDefault()}
          onDrop={() => {
            if (dragIndex !== null) reorder(dragIndex, index);
            setDragIndex(null);
            setOverIndex(null);
          }}
          onDragEnd={() => {
            setDragIndex(null);
            setOverIndex(null);
          }}
          className={`glass fade-up flex flex-col rounded-2xl transition ${
            overIndex === index && dragIndex !== index ? "ring-2 ring-brand-400/70" : ""
          } ${dragIndex === index ? "opacity-50" : ""}`}
        >
          {/* The name input, column-count badge, reorder pair and delete button
              all compete for one row. Below ~400px that left the table name
              about 8 visible characters, so the controls wrap onto their own
              line instead (flex-wrap + the input's basis) rather than
              dropping reorder or truncate, which are both real regressions. */}
          <div className="flex flex-wrap items-center gap-2 rounded-t-2xl bg-gradient-to-r from-brand-600/60 to-aqua-400/30 px-3 py-2.5">
            {!touch && (
              <span className="cursor-grab text-slate-700/70" title="Drag to reorder">
                ⠿
              </span>
            )}
            <input
              value={table.name}
              aria-label={`Table name, position ${index + 1} of ${schema.tables.length}`}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              onChange={(event) => renameTable(index, event.target.value)}
              className="w-full min-w-0 flex-1 basis-24 bg-transparent font-mono font-bold text-slate-900 outline-none"
            />
            <span className="flex shrink-0 items-center gap-1">
              <span className="rounded-md bg-white/70 px-1.5 py-0.5 text-xs font-semibold text-slate-700">
                {table.columns.length}
              </span>
              {touch && (
                <>
                  <button
                    type="button"
                    aria-label={`Move ${table.name} up`}
                    onClick={() => reorder(index, index - 1)}
                    disabled={index === 0}
                    className="flex h-11 w-11 items-center justify-center rounded-lg text-slate-700 transition active:bg-white/40 disabled:opacity-30"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M18 15l-6-6-6 6" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    aria-label={`Move ${table.name} down`}
                    onClick={() => reorder(index, index + 1)}
                    disabled={index === schema.tables.length - 1}
                    className="flex h-11 w-11 items-center justify-center rounded-lg text-slate-700 transition active:bg-white/40 disabled:opacity-30"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M6 9l6 6 6-6" />
                    </svg>
                  </button>
                </>
              )}
              <button
                type="button"
                title="Delete table"
                aria-label={`Delete ${table.name}`}
                onClick={() => {
                  const incoming = countIncomingKeys(schema.tables, table.name);
                  setPending({
                    title: `Delete ${table.name}?`,
                    body: `This removes the table and its ${table.columns.length} column${
                      table.columns.length === 1 ? "" : "s"
                    }.${
                      incoming > 0
                        ? ` ${incoming} foreign key${incoming === 1 ? "" : "s"} in other tables will also be removed so the export still imports.`
                        : ""
                    } This cannot be undone.`,
                    confirmLabel: "Delete table",
                  });
                  setApplyDelete(() => () =>
                    update(schema.tables.filter((item) => item.name !== table.name)),
                  );
                }}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-rose-600 transition active:bg-rose-100"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </span>
          </div>

          {/* Same reasoning per column: at 320px the name input was left with
              about 9 characters next to a 16px type pill, because the
              unlayered `input, select { font-size: 16px }` rule defeats
              `text-xs` (it exists to stop iOS zoom-on-focus). The pill is kept
              at 16px and given its own line on narrow screens instead. */}
          <ul className="scroll-thin max-h-72 flex-1 divide-y divide-slate-200 overflow-y-auto px-1 py-1">
            {table.columns.map((column, columnIndex) => (
              <li key={columnIndex} className="group flex flex-wrap items-center gap-1.5 px-2 py-1.5">
                <span className="w-3 shrink-0 text-center text-xs">
                  {column.primaryKey || column.type === "id" ? "🔑" : column.references ? "🔗" : ""}
                </span>
                <input
                  value={column.name}
                  aria-label={`Column name in ${table.name}`}
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  onChange={(event) => renameColumn(index, columnIndex, event.target.value)}
                  className="min-w-0 flex-1 basis-24 bg-transparent font-mono text-slate-800 outline-none focus:text-slate-900"
                />
                <select
                  value={column.type}
                  aria-label={`Type of ${column.name} in ${table.name}`}
                  onChange={(event) => {
                    const nextType = event.target.value as LogicalType;
                    update(
                      schema.tables.map((item, itemIndex) =>
                        itemIndex !== index
                          ? item
                          : {
                              ...item,
                              columns: item.columns.map((current, index) =>
                                index === columnIndex
                                  ? {
                                      ...current,
                                      type: nextType,
                                      references: nextType === "fk" ? current.references : undefined,
                                    }
                                  : current,
                              ),
                            },
                      ),
                    );
                  }}
                  className={`type-pill min-h-11 shrink-0 cursor-pointer rounded-lg py-2 pl-2 font-mono text-xs font-semibold uppercase outline-none max-[400px]:basis-full max-[400px]:text-center ${
                    TYPE_COLORS[column.type] ?? "bg-slate-100 text-slate-700"
                  }`}
                >
                  {LOGICAL_TYPES.map((type) => (
                    <option key={type} value={type} className="bg-white text-slate-800">
                      {type}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  title="Remove column"
                  aria-label={`Remove column ${column.name}`}
                  onClick={() => {
                    const table_ = schema.tables[index];
                    setPending({
                      title: `Remove ${column.name}?`,
                      body: `This removes "${column.name}" from ${table_.name}.${
                        column.references
                          ? " Foreign keys pointing at it will also be removed."
                          : ""
                      } This cannot be undone.`,
                      confirmLabel: "Remove column",
                    });
                    setApplyDelete(() => () =>
                      update(
                        dropKeysToColumn(
                          schema.tables.map((item, itemIndex) =>
                            itemIndex !== index
                              ? item
                              : {
                                  ...item,
                                  columns: item.columns.filter(
                                    (_current, current) => current !== columnIndex,
                                  ),
                                },
                          ),
                          table_.name,
                          column.name,
                        ),
                      ),
                    );
                  }}
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-500 transition active:bg-rose-100 active:text-rose-700"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                    <path d="M18 6L6 18M6 6l12 12" />
                  </svg>
                </button>
              </li>
            ))}
          </ul>


          <div className="flex items-center gap-1.5 border-t border-slate-200 px-2 py-2">
            <input
              value={newColumn[table.name] ?? ""}
              onChange={(event) => setNewColumn((state) => ({ ...state, [table.name]: event.target.value }))}
              onKeyDown={(event) => {
                if (event.key === "Enter") addColumn(table.name);
              }}
              placeholder="add column e.g. phone_number"
              enterKeyHint="done"
              aria-label={`New column name for ${table.name}`}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              className="min-w-0 flex-1 rounded-lg bg-slate-100 px-2.5 py-2.5 font-mono text-slate-800 outline-none placeholder:text-slate-500"
            />
            <button
              type="button"
              aria-label={`Add column to ${table.name}`}
              onClick={() => addColumn(table.name)}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-brand-100 text-lg font-bold text-brand-700 transition active:bg-brand-200"
            >
              +
            </button>
          </div>
        </div>
      ))}

      <div className="glass-soft flex flex-col items-center justify-center gap-3 rounded-2xl border-dashed p-6 text-center">
        <span className="text-2xl">➕</span>
        <p className="text-sm text-slate-600">
          {schema.tables.length}/{maxTables} tables used
        </p>
        <div className="flex w-full gap-1.5">
          <input
            value={newTable}
            onChange={(event) => setNewTable(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") addTable();
            }}
            placeholder="new table name"
            aria-label="New table name"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="done"
            className="min-w-0 flex-1 rounded-lg bg-white px-2.5 py-2.5 font-mono text-slate-800 outline-none placeholder:text-slate-500"
          />
          <button
            type="button"
            onClick={addTable}
            disabled={schema.tables.length >= maxTables}
            className="btn-primary min-h-11 shrink-0 rounded-lg px-4 text-sm font-bold text-white"
          >
            Add
          </button>
        </div>
      </div>

      <ConfirmSheet
        request={pending}
        onCancel={() => {
          setPending(null);
          setApplyDelete(null);
        }}
        onConfirm={() => {
          applyDelete?.();
          setPending(null);
          setApplyDelete(null);
        }}
      />
    </div>
  );
}
