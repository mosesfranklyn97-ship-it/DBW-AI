"use client";

import { DIALECTS, DIALECT_META, type Dialect } from "@/lib/types";

interface Props {
  value: Dialect | "auto";
  onChange: (dialect: Dialect | "auto") => void;
  compact?: boolean;
  /** Importing an existing script has no stated dialect, so let the parser pick. */
  allowAuto?: boolean;
}

const AUTO = {
  emoji: "✨",
  label: "Detect it",
  blurb: "Read the script and work out the dialect yourself.",
} as const;

export default function DialectPicker({ value, onChange, compact = false, allowAuto = false }: Props) {
  const options = allowAuto ? [{ key: "auto" as const, ...AUTO }, ...DIALECTS.map((key) => ({ key, ...DIALECT_META[key] }))] : DIALECTS.map((key) => ({ key, ...DIALECT_META[key] }));

  return (
    // The compact picker lives in the builder title bar, where a 2-column grid
    // left ~104px of content per cell at 320px — exactly enough for "PostgreSQL"
    // but not once the active ✓ is added, so only the selected cell wrapped and
    // the 2x2 block went ragged. It drops to one column below 380px instead.
    <div
      className={`grid gap-2 ${
        compact ? "grid-cols-1 min-[380px]:grid-cols-2 sm:grid-cols-4" : "grid-cols-2 lg:grid-cols-4"
      }`}
    >
      {options.map((option) => {
        const { key, emoji, label, blurb } = option;
        const active = value === key;
        return (
          <button
            key={key}
            type="button"
            onClick={() => onChange(key)}
            aria-pressed={active}
            className={`group relative min-h-11 overflow-hidden rounded-xl border px-3 py-3 text-left transition active:scale-[0.99] ${
              active
                ? "border-brand-500 bg-brand-500/15 shadow-[0_0_24px_-10px_rgba(79,70,229,0.9)]"
                : "border-slate-300 bg-white active:bg-slate-100"
            }`}
          >
            <div className="flex min-w-0 items-center gap-2">
              <span className="shrink-0 text-base">{emoji}</span>
              <span
                className={`min-w-0 truncate text-sm font-semibold ${active ? "text-brand-700" : "text-slate-800"}`}
              >
                {label}
              </span>
              {active && <span className="ml-auto shrink-0 text-sm font-bold text-brand-700">✓</span>}
            </div>
            {!compact && <p className="mt-1 text-sm leading-snug text-slate-600">{blurb}</p>}
          </button>
        );
      })}
    </div>
  );
}
