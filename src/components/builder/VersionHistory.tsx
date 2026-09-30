"use client";

import { useCallback, useState } from "react";
import SchemaDiffView from "@/components/builder/SchemaDiffView";
import { apiFetch, type ProjectHistoryEntry } from "@/lib/client/api";
import { diffSchemas, type SchemaDiff } from "@/lib/schema/diff";
import type { DbSchema } from "@/lib/types";

export type VersionRow = ProjectHistoryEntry;

interface Props {
  projectId: string;
  history: VersionRow[];
  schema: DbSchema;
  onRestored: (schema: DbSchema, message: string) => void;
}

interface LoadedVersion {
  id: number;
  instruction: string;
  summary: string;
  createdAt: string;
  snapshot: DbSchema | null;
  diff: SchemaDiff | null;
}

function when(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function VersionHistory({ projectId, history, schema, onRestored }: Props) {
  const [selected, setSelected] = useState<LoadedVersion | null>(null);
  const [loading, setLoading] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A version that has been restored away is closed explicitly in `restore`,
  // and a refine that lands while the panel is open simply recomputes the diff
  // against the new schema, which is the answer the user wants anyway.

  const open = useCallback(
    async (row: VersionRow) => {
      setError(null);
      if (!row.hasSnapshot) {
        setError("This version was saved before snapshots existed, so it cannot be compared or restored.");
        return;
      }
      setLoading(true);
      try {
        setSelected(
          await apiFetch<LoadedVersion>(`/api/projects/${projectId}/revisions/${row.id}`),
        );
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "That version could not be read.");
      } finally {
        setLoading(false);
      }
    },
    [projectId],
  );

  const restore = useCallback(async () => {
    if (!selected || restoring) return;
    setRestoring(true);
    setError(null);
    try {
      const result = await apiFetch<{ schema: DbSchema; summary: string; revision: VersionRow }>(
        `/api/projects/${projectId}/rollback`,
        { method: "POST", body: JSON.stringify({ revisionId: selected.id }) },
      );
      onRestored(result.schema, result.summary);
      setSelected(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That version could not be restored.");
    } finally {
      setRestoring(false);
    }
  }, [projectId, onRestored, restoring, selected]);

  if (history.length === 0) {
    return (
      <div className="glass rounded-2xl p-5">
        <h3 className="text-base font-bold text-slate-900">Version history</h3>
        <p className="mt-2 text-sm text-slate-600">
          Nothing yet. Every refine, every builder edit and every import is saved here, and any of them can be
          restored.
        </p>
      </div>
    );
  }

  // Recomputed locally so the preview survives a refetch and needs no network
  // round trip just to draw a comparison.
  const liveDiff = selected?.snapshot ? diffSchemas(selected.snapshot, schema) : null;
  const diff = liveDiff ?? selected?.diff ?? null;

  return (
    <div className="glass rounded-2xl p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-base font-bold text-slate-900">Version history</h3>
        <span className="text-xs text-slate-500">
          {history.length} version{history.length === 1 ? "" : "s"}
        </span>
      </div>

      <ol className="mt-3 space-y-2">
        {[...history].reverse().map((row) => {
          const active = selected?.id === row.id;
          return (
            <li key={row.id}>
              <button
                type="button"
                onClick={() => (active ? setSelected(null) : void open(row))}
                aria-pressed={active}
                className={`w-full rounded-xl border px-3 py-2.5 text-left transition ${
                  active
                    ? "border-brand-400 bg-brand-50"
                    : "border-slate-200 bg-white hover:border-brand-300"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="min-w-0 text-sm font-semibold text-slate-900">{row.instruction}</span>
                  <span className="shrink-0 font-mono text-[11px] text-slate-400">#{row.id}</span>
                </div>
                <p className="mt-0.5 text-xs leading-snug text-slate-600">{row.summary}</p>
                <p className="mt-1 text-[11px] text-slate-400">
                  {when(row.createdAt)}
                  {row.tables !== null ? ` · ${row.tables} tables · ${row.columns} columns` : ""}
                  {row.isCurrent ? " · current" : ""}
                </p>
              </button>
            </li>
          );
        })}
      </ol>

      {loading && <p className="mt-3 text-sm text-slate-500">Reading that version…</p>}

      {error && (
        <p className="mt-3 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-700">
          {error}
        </p>
      )}

      {selected && diff && (
        <div className="mt-4 border-t border-slate-200 pt-4">
          <p className="text-sm font-semibold text-slate-900">
            Rolling back to #{selected.id} would {diff.empty ? "change nothing" : "change this"}:
          </p>

          <div className="mt-3">
            <SchemaDiffView diff={diff} />
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={restore}
              disabled={restoring || diff.empty}
              className="btn-primary min-h-11 rounded-xl px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50"
            >
              {restoring ? "Restoring…" : `Restore version #${selected.id}`}
            </button>
            <button
              type="button"
              onClick={() => setSelected(null)}
              className="min-h-11 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700"
            >
              Close
            </button>
            <p className="text-xs text-slate-500">Restoring adds a new version. Nothing is deleted.</p>
          </div>
        </div>
      )}
    </div>
  );
}
