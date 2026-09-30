"use client";

import { useEffect, useRef, useState } from "react";
import SchemaDiffView from "@/components/builder/SchemaDiffView";
import { apiFetch } from "@/lib/client/api";
import type { SchemaDiff } from "@/lib/schema/diff";
import type { DbSchema } from "@/lib/types";

/**
 * Review a proposed schema change before it is written.
 *
 * The candidate comes back from the server as a signed handle, and applying it
 * replays that handle rather than asking the model again. A second call could
 * return a different schema, which would make the diff on screen a lie; this
 * way the thing that was reviewed is the thing that lands.
 */

export interface RefinePreview {
  schema: DbSchema;
  diff: SchemaDiff;
  summary: string;
  engine: "ai" | "engine";
  aiAvailable: boolean;
  noChange: boolean;
  previewToken: string;
}

interface Props {
  projectId: string;
  instruction: string;
  onApplied: (schema: DbSchema, summary: string, engine: "ai" | "engine") => void;
  onDiscard: () => void;
}

export default function RefinePreviewDialog({ projectId, instruction, onApplied, onDiscard }: Props) {
  const [state, setState] = useState<
    { status: "loading" } | { status: "ready"; preview: RefinePreview } | { status: "error"; message: string }
  >({ status: "loading" });
  const [applying, setApplying] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const preview = await apiFetch<RefinePreview>(`/api/projects/${projectId}/refine`, {
          method: "POST",
          body: JSON.stringify({ instruction, mode: "preview" }),
        });
        if (!cancelled) setState({ status: "ready", preview });
      } catch (caught) {
        if (!cancelled) {
          setState({
            status: "error",
            message: caught instanceof Error ? caught.message : "That change could not be prepared.",
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [instruction, projectId]);

  // Move focus to the least destructive control so a stray Enter cannot apply.
  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onDiscard();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDiscard]);

  const apply = async () => {
    if (state.status !== "ready" || applying) return;
    setApplying(true);
    try {
      const result = await apiFetch<{ schema: DbSchema; summary: string; engine: "ai" | "engine" }>(
        `/api/projects/${projectId}/refine`,
        {
          method: "POST",
          body: JSON.stringify({
            instruction,
            mode: "apply",
            previewToken: state.preview.previewToken,
          }),
        },
      );
      onApplied(result.schema, result.summary, result.engine);
    } catch (caught) {
      setState({
        status: "error",
        message: caught instanceof Error ? caught.message : "That change could not be applied.",
      });
      setApplying(false);
    }
  };

  const preview = state.status === "ready" ? state.preview : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Review schema change"
    >
      <div className="glass max-h-[90dvh] w-full max-w-xl overflow-y-auto rounded-t-3xl p-5 sm:rounded-3xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Review before applying</h2>
            <p className="mt-1 text-sm text-slate-600">Nothing is saved until you apply it.</p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onDiscard}
            aria-label="Discard this change"
            className="min-h-11 min-w-11 rounded-xl border border-slate-300 bg-white text-lg leading-none text-slate-500"
          >
            ×
          </button>
        </div>

        <div className="mt-3 rounded-xl border border-slate-200 bg-white/70 px-3 py-2">
          <p className="text-xs font-bold uppercase tracking-wide text-slate-500">You asked for</p>
          <p className="mt-0.5 text-sm text-slate-800">{instruction}</p>
        </div>

        {state.status === "loading" && (
          <p className="mt-4 text-sm text-slate-500">Working out what would change…</p>
        )}

        {state.status === "error" && (
          <p className="mt-4 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-700">
            {state.message}
          </p>
        )}

        {preview && (
          <>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <span
                className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                  preview.engine === "ai"
                    ? "bg-emerald-100 text-emerald-800"
                    : "bg-amber-100 text-amber-800"
                }`}
              >
                {preview.engine === "ai" ? "LLM architect" : "ZeroBox engine"}
              </span>
              {!preview.aiAvailable && (
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600">
                  no AI key configured
                </span>
              )}
            </div>

            <p className="mt-2 text-sm text-slate-700">{preview.summary}</p>

            {preview.engine === "engine" && preview.aiAvailable && (
              <p className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-800">
                The model could not produce this, so the keyword engine matched it instead. Check the
                diff before applying.
              </p>
            )}

            <div className="mt-4">
              <SchemaDiffView
                diff={preview.diff}
                emptyMessage={
                  preview.noChange
                    ? undefined
                    : "No tables move, but the name or description does."
                }
              />
            </div>

            <div className="mt-5 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void apply()}
                disabled={applying || preview.noChange}
                className="btn-primary min-h-11 flex-1 rounded-xl px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50"
              >
                {applying ? "Applying…" : "Apply change"}
              </button>
              <button
                type="button"
                onClick={onDiscard}
                disabled={applying}
                className="min-h-11 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700"
              >
                Discard
              </button>
            </div>
            <p className="mt-2 text-xs text-slate-500">
              Applying records a version, so this can be rolled back.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
