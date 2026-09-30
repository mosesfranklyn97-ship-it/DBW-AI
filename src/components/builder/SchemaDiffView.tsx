"use client";

import type { SchemaDiff } from "@/lib/schema/diff";

/**
 * Renders a `SchemaDiff` as an add/remove/change list.
 *
 * Shared by the refine preview and the version-history rollback panel so a
 * reviewed change and a restored change are always described in the same words.
 */

const TONE = {
  added: "border-emerald-500/40 bg-emerald-500/10 text-emerald-800",
  removed: "border-rose-500/40 bg-rose-500/10 text-rose-800",
  changed: "border-amber-500/40 bg-amber-500/10 text-amber-800",
} as const;

export default function SchemaDiffView({
  diff,
  emptyMessage,
}: {
  diff: SchemaDiff;
  /** Overrides the default wording when an empty diff still means something. */
  emptyMessage?: string;
}) {
  if (diff.empty) {
    return (
      <p className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-600">
        {emptyMessage ?? "Nothing would change. The schema already matches."}
      </p>
    );
  }

  const { counts } = diff;

  return (
    <div className="space-y-3">
      <p className="text-xs font-semibold text-slate-600">
        <span className="text-emerald-700">+{counts.added}</span>{" "}
        <span className="text-rose-700">−{counts.removed}</span>{" "}
        <span className="text-amber-700">~{counts.changed}</span> across{" "}
        {diff.tables.length} {diff.tables.length === 1 ? "table" : "tables"}
      </p>

      {diff.tablesAdded.length > 0 && (
        <DiffGroup tone="added" title={`${diff.tablesAdded.length} table(s) added`}>
          {diff.tablesAdded.map((name) => (
            <li key={name} className="font-mono">
              + {name}
            </li>
          ))}
        </DiffGroup>
      )}

      {diff.tablesRemoved.length > 0 && (
        <DiffGroup tone="removed" title={`${diff.tablesRemoved.length} table(s) removed`}>
          {diff.tablesRemoved.map((name) => (
            <li key={name} className="font-mono">
              − {name}
            </li>
          ))}
        </DiffGroup>
      )}

      {diff.tablesChanged.map((table) => (
        <DiffGroup key={table.name} tone="changed" title={`${table.name} changed`}>
          {table.columnsAdded.map((name) => (
            <li key={`a-${name}`} className="font-mono">
              + {name}
            </li>
          ))}
          {table.columnsRemoved.map((name) => (
            <li key={`r-${name}`} className="font-mono">
              − {name}
            </li>
          ))}
          {table.columnsChanged.map((column) => (
            <li key={`c-${column.name}`} className="font-mono">
              ~ {column.name}: {column.details.join(", ")}
            </li>
          ))}
          {table.relationsAdded.map((label) => (
            <li key={`la-${label}`} className="font-mono">
              + {label}
            </li>
          ))}
          {table.relationsRemoved.map((label) => (
            <li key={`lr-${label}`} className="font-mono">
              − {label}
            </li>
          ))}
        </DiffGroup>
      ))}
    </div>
  );
}

function DiffGroup({
  tone,
  title,
  children,
}: {
  tone: keyof typeof TONE;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`rounded-xl border px-3 py-2 ${TONE[tone]}`}>
      <p className="text-xs font-bold uppercase tracking-wide">{title}</p>
      <ul className="mt-1 space-y-0.5 text-xs">{children}</ul>
    </div>
  );
}
