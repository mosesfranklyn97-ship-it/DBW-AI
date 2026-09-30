"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { exportUrl, fetchExport } from "@/lib/client/api";
import type { DbSchema } from "@/lib/types";

/**
 * A real SQLite engine running in the page. sql.js is ~640 KB of WebAssembly,
 * so it is only ever fetched when this tab is opened, and the database lives
 * entirely in memory: nothing a user types here reaches the server.
 */

type SqlDatabase = import("sql.js").Database;
type SqlJsStatic = Awaited<ReturnType<typeof import("sql.js").default>>;

interface ResultSet {
  columns: string[];
  rows: (string | number | null)[][];
  affected: number;
  truncated: boolean;
  ms: number;
}

const MAX_ROWS = 200;
const MAX_CELL = 200;

const SNIPPETS = [
  { label: "Every table", sql: "SELECT name, type FROM sqlite_master WHERE type IN ('table','view') ORDER BY name;" },
  { label: "Row counts", sql: "SELECT 'patients' AS t, COUNT(*) AS rows FROM patients;" },
  { label: "Left join", sql: "SELECT * FROM patients p LEFT JOIN appointments a ON a.patient_id = p.id LIMIT 20;" },
  { label: "Schema", sql: "SELECT sql FROM sqlite_master WHERE type = 'table';" },
];

function cell(value: unknown): string | number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (value instanceof Uint8Array) return `<${value.length} bytes>`;
  const text = String(value);
  return text.length > MAX_CELL ? `${text.slice(0, MAX_CELL)}…` : text;
}

export default function SqlPlayground({ projectId, schema }: { projectId: string; schema: DbSchema }) {
  // Starts as loading because that is the state the mount effect below is about
  // to enter; declaring it here keeps the effect free of a synchronous
  // setState, which is what makes it an effect rather than a render side effect.
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("SELECT name FROM sqlite_master WHERE type = 'table';");
  const [result, setResult] = useState<ResultSet | null>(null);
  const [ranAt, setRanAt] = useState<Date | null>(null);
  const dbRef = useRef<SqlDatabase | null>(null);
  const sqlJsRef = useRef<SqlJsStatic | null>(null);

  const describeFailure = (caught: unknown) =>
    caught instanceof Error ? caught.message : "The sandbox could not start.";

  /**
   * Builds the in-memory database. This touches no React state, which is what
   * makes it safe to call from an effect: the effect decides what the outcome
   * means for the UI, this function only does the work.
   */
  const createDatabase = useCallback(async (): Promise<SqlDatabase> => {
    let sqlJs = sqlJsRef.current;
    if (!sqlJs) {
      const SQL = await import("sql.js");
      sqlJs = await SQL.default({ locateFile: () => "/sql-wasm.wasm" });
      sqlJsRef.current = sqlJs;
    }

    // The engine is in SQLite regardless of the export style the user picked,
    // so the playground always asks for the SQLite rendering.
    const [ddl, seed] = await Promise.all([
      fetchExport(projectId, "schema", "sqlite"),
      fetchExport(projectId, "data", "sqlite"),
    ]);

    const db = new sqlJs.Database();
    db.run(ddl);
    try {
      db.run(seed);
    } catch {
      // Seed rows are a nicety. If one violates a constraint the schema is
      // still perfectly queryable, so the tables are kept and only the rows
      // are skipped.
    }
    return db;
  }, [projectId]);

  const adopt = useCallback((db: SqlDatabase | null) => {
    dbRef.current?.close();
    dbRef.current = db;
  }, []);

  useEffect(() => {
    let cancelled = false;
    createDatabase().then(
      (db) => {
        if (cancelled) {
          db.close();
          return;
        }
        adopt(db);
        setStatus("ready");
      },
      (caught: unknown) => {
        if (cancelled) return;
        setStatus("error");
        setError(describeFailure(caught));
      },
    );
    return () => {
      cancelled = true;
      adopt(null);
    };
  }, [adopt, createDatabase]);

  /** Manual and debounced rebuilds, both driven by a user-visible trigger. */
  const startBuild = useCallback(
    async (force: boolean) => {
      if (dbRef.current && !force) return;
      setStatus("loading");
      setError(null);
      setResult(null);
      try {
        adopt(await createDatabase());
        setStatus("ready");
      } catch (caught) {
        adopt(null);
        setStatus("error");
        setError(describeFailure(caught));
      }
    },
    [adopt, createDatabase],
  );

  // The schema is edited live in the builder, so the in-memory database has to
  // be rebuilt from the new DDL or the playground would answer from a stale
  // version of the very thing the user is changing. The delay is the builder's
  // own autosave debounce, so this only fires once typing has settled.
  useEffect(() => {
    if (status !== "ready") return;
    const timer = setTimeout(() => void startBuild(true), 900);
    return () => clearTimeout(timer);
  }, [schema, startBuild, status]);

  const run = useCallback(() => {
    const db = dbRef.current;
    if (!db) return;
    const started = performance.now();
    try {
      const statement = db.prepare(query);
      const columns: string[] = statement.getColumnNames();
      const rows: (string | number | null)[][] = [];
      let truncated = false;

      // step() is what advances to the next row, so the loop below owns the
      // very first one. Stepping before the loop here would silently drop it.
      while (statement.step()) {
        if (rows.length >= MAX_ROWS) {
          truncated = true;
          break;
        }
        rows.push(statement.get().map(cell));
      }
      statement.free();

      setResult({
        columns,
        rows,
        // sqlite3_changes is only meaningful for a write; for a read it carries
        // whatever the last write left behind, so it is reported as null there.
        affected: /^\s*(insert|update|delete|replace)/i.test(query)
          ? db.getRowsModified()
          : 0,
        truncated,
        ms: Math.round(performance.now() - started),
      });
      setRanAt(new Date());
      setError(null);
    } catch (caught) {
      setResult(null);
      setError(caught instanceof Error ? caught.message : "That query could not run.");
    }
  }, [query]);

  const reset = useCallback(() => {
    setQuery("SELECT name FROM sqlite_master WHERE type = 'table';");
    setResult(null);
    setError(null);
    void startBuild(true);
  }, [startBuild]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-600">
          A real SQLite engine in your browser, holding this schema plus {""}
          {schema.tables.length} table{schema.tables.length === 1 ? "" : "s"} of sample rows. Nothing is uploaded.
        </p>
        <button
          type="button"
          onClick={reset}
          disabled={status === "loading"}
          className="min-h-11 shrink-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:border-brand-400 hover:text-brand-700 disabled:opacity-50"
        >
          {status === "loading" ? "Starting…" : "↻ Rebuild sandbox"}
        </button>
      </div>

      <div className="rounded-2xl border border-slate-700 bg-slate-900 p-3">
        <textarea
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && status === "ready") {
              event.preventDefault();
              run();
            }
          }}
          rows={4}
          spellCheck={false}
          aria-label="SQL query"
          placeholder="SELECT * FROM …"
          className="scroll-thin w-full resize-y rounded-lg bg-transparent p-2 font-mono text-[13px] leading-relaxed text-slate-100 placeholder:text-slate-600 focus:outline-none"
        />
        <div className="mt-1 flex flex-wrap items-center gap-2 border-t border-slate-800 pt-2">
          <button
            type="button"
            onClick={run}
            disabled={status !== "ready"}
            className="btn-primary min-h-11 rounded-lg px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
          >
            ▶ Run query
          </button>
          <span className="text-[11px] text-slate-500">⌘/Ctrl + Enter</span>
          <span className="ml-auto flex flex-wrap gap-1">
            {SNIPPETS.map((snippet) => (
              <button
                key={snippet.label}
                type="button"
                onClick={() => setQuery(snippet.sql)}
                className="min-h-9 rounded-full border border-slate-700 px-2.5 py-1 text-[11px] text-slate-300 transition hover:border-brand-400 hover:text-brand-300"
              >
                {snippet.label}
              </button>
            ))}
          </span>
        </div>
      </div>

      {status === "loading" && (
        <p className="rounded-xl border border-slate-200 bg-slate-100 px-4 py-3 text-sm text-slate-600">
          Loading the SQLite engine and building your tables…
        </p>
      )}

      {status === "error" && (
        <p className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-700">
          {error} — the playground needs WebAssembly, which some corporate networks and older browsers block.
        </p>
      )}

      {error && status === "ready" && (
        <p className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 font-mono text-xs text-rose-700">
          {error}
        </p>
      )}

      {result && (
        <div className="overflow-hidden rounded-2xl border border-slate-200">
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
            <span className="font-semibold text-slate-800">
              {result.rows.length} row{result.rows.length === 1 ? "" : "s"}
            </span>
            {result.truncated && <span className="text-amber-700">showing first {MAX_ROWS}</span>}
            {result.affected > 0 && <span className="text-emerald-700">{result.affected} row(s) changed</span>}
            <span className="ml-auto font-mono">{result.ms} ms</span>
            {ranAt && <span className="font-mono">{ranAt.toLocaleTimeString()}</span>}
          </div>

          {result.columns.length === 0 ? (
            <p className="bg-white px-4 py-3 text-sm text-slate-500">That statement ran and returned no rows.</p>
          ) : (
            <div className="scroll-thin max-h-[420px] overflow-auto">
              <table className="w-full border-collapse text-left text-sm">
                <thead className="sticky top-0 bg-white">
                  <tr>
                    {result.columns.map((column) => (
                      <th
                        key={column}
                        className="whitespace-nowrap border-b border-slate-200 px-3 py-2 font-mono text-xs font-semibold text-slate-700"
                      >
                        {column}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((row, rowIndex) => (
                    <tr key={rowIndex} className="odd:bg-slate-50">
                      {row.map((value, cellIndex) => (
                        <td
                          key={cellIndex}
                          className={`max-w-[320px] truncate px-3 py-1.5 font-mono text-xs ${
                            value === null ? "text-slate-400 italic" : "text-slate-800"
                          }`}
                          title={value === null ? "NULL" : String(value)}
                        >
                          {value === null ? "NULL" : String(value)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {status === "ready" && !result && (
        <p className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
          Run a query to see rows. Writes work too — try{" "}
          <button
            type="button"
            onClick={() => setQuery("UPDATE patients SET notes = 'called' WHERE id = 1;")}
            className="font-mono text-xs font-semibold text-brand-600 underline underline-offset-2"
          >
            UPDATE patients …
          </button>{" "}
          — the sandbox is disposable, so nothing here damages your export.
        </p>
      )}
    </div>
  );
}
