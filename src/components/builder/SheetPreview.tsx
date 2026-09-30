"use client";

import { useMemo, useState } from "react";
import type { DbSchema } from "@/lib/types";

type SheetValue = string | number | boolean | null;
export type SheetData = Record<string, Record<string, SheetValue>[]>;

interface Props {
  schema: DbSchema;
  data: SheetData | null;
  loading: boolean;
}

function renderValue(value: SheetValue) {
  if (value === null || value === undefined) {
    return <span className="italic text-slate-500">NULL</span>;
  }
  if (typeof value === "boolean") {
    return (
      <span className={value ? "font-semibold text-emerald-700" : "font-semibold text-rose-700"}>
        {value ? "true" : "false"}
      </span>
    );
  }
  if (typeof value === "number") return <span className="font-semibold text-amber-700">{value}</span>;
  return <span className="text-slate-900">{value}</span>;
}

export default function SheetPreview({ schema, data, loading }: Props) {
  const tableNames = useMemo(() => schema.tables.map((table) => table.name), [schema]);
  const [picked, setPicked] = useState<string | null>(null);
  // Long values are truncated to keep the grid readable, but `title` is a
  // hover-only affordance and there is no hover on a phone - so a tapped cell
  // shows its full value here instead.
  const [expanded, setExpanded] = useState<string | null>(null);
  const active = picked && tableNames.includes(picked) ? picked : (tableNames[0] ?? "");
  const setActive = setPicked;

  const table = schema.tables.find((item) => item.name === active);
  const rows = data?.[active] ?? [];

  return (
    <div className="glass overflow-hidden rounded-2xl">
      <div className="scroll-thin scroll-x-touch flex gap-1.5 overflow-x-auto border-b border-slate-200 px-2 py-2">
        {tableNames.map((name) => (
          <button
            key={name}
            type="button"
            onClick={() => {
              setActive(name);
              setExpanded(null);
            }}
            aria-pressed={active === name}
            className={`min-h-11 shrink-0 whitespace-nowrap rounded-lg px-3 py-2 font-mono text-sm font-semibold transition ${
              active === name
                ? "bg-brand-600 text-white"
                : "text-slate-700 transition active:bg-slate-200"
            }`}
          >
            {name}
            <span className={`ml-1.5 text-xs ${active === name ? "text-brand-100" : "text-slate-500"}`}>
              {data?.[name]?.length ?? "—"}
            </span>
          </button>
        ))}
      </div>

      {loading || !table ? (
        <div className="space-y-2 p-4">
          {Array.from({ length: 8 }).map((_, index) => (
            <div key={index} className="shimmer h-6 rounded" />
          ))}
        </div>
      ) : (
        <div className="scroll-thin max-h-[62vh] max-h-[62dvh] overflow-auto">
          {/*
            `w-full` alone would let the browser squeeze every column to fit,
            producing unreadable clipped cells. min-w-max makes the table take
            its natural width so the container scrolls horizontally instead.
          */}
          <table className="w-full min-w-max border-collapse text-left text-sm">
            {/* Sticky header and sticky first column each create a stacking
                context, so their z-indexes have to ascend: the corner cell must
                outrank the header row, which must outrank the body. */}
            <thead className="sticky top-0 z-30">
              <tr className="bg-slate-100">
                <th className="sticky left-0 z-40 w-12 border-b border-r border-slate-300 bg-slate-100 px-2 py-2.5 text-center text-xs font-bold text-slate-600">
                  #
                </th>
                {table.columns.map((column) => (
                  <th
                    key={column.name}
                    className="whitespace-nowrap border-b border-r border-slate-300 bg-slate-100 px-3 py-2.5 font-mono text-sm font-bold text-slate-900"
                  >
                    <span className="flex items-center gap-1.5">
                      {column.primaryKey || column.type === "id" ? "🔑" : column.references ? "🔗" : ""}
                      {column.name}
                      <span className="rounded bg-white px-1.5 py-0.5 text-xs font-medium uppercase text-slate-600">
                        {column.type}
                      </span>
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={rowIndex} className="odd:bg-slate-50/70">
                  <td className="sticky left-0 z-20 border-b border-r border-slate-300 bg-white px-2 py-2.5 text-center text-xs text-slate-500">
                    {rowIndex + 1}
                  </td>
                  {table.columns.map((column) => {
                    const cellKey = `${rowIndex}:${column.name}`;
                    const isOpen = expanded === cellKey;
                    return (
                      <td
                        key={column.name}
                        onClick={() => setExpanded(isOpen ? null : cellKey)}
                        className={`touch-manipulation max-w-[16rem] border-b border-r border-slate-200 px-3 py-2.5 font-mono text-sm ${
                          isOpen ? "whitespace-pre-wrap break-words bg-brand-50" : "truncate whitespace-nowrap"
                        }`}
                      >
                        {renderValue(row[column.name] ?? null)}
                      </td>
                    );
                  })}
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={table.columns.length + 1} className="px-4 py-10 text-center text-slate-500">
                    No sample rows yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      <div className="border-t border-slate-200 px-4 py-3 text-sm text-slate-600">
        This is exactly how the rows land in your SQL client after importing{" "}
        <span className="font-mono">sample_data.sql</span>. Tap a cell to see a
        long value in full.
      </div>
    </div>
  );
}
