"use client";

import { useEffect } from "react";
import { applyUpdate, dismissUpdate, startUpdateCycle, useAppUpdate } from "@/lib/client/appUpdate";

export default function UpdatePrompt() {
  const { state, deferred } = useAppUpdate();

  useEffect(() => {
    // Idempotent, and started here too so the prompt still works if it ever
    // gets mounted without the registration component alongside it.
    startUpdateCycle();
  }, []);

  if (state === "idle" || deferred) return null;

  const applying = state === "applying";

  return (
    // `bottom-0` is load-bearing for the same reason as on the install prompt:
    // `fixed inset-x-0` alone leaves `top`/`bottom` as auto, so the card would
    // be laid out below the entire page. `.update-prompt-safe` then lifts it to
    // the top rung of the stack on narrow screens.
    <div className="update-prompt-safe pointer-events-none fixed inset-x-0 bottom-0 z-[70] flex justify-center px-3 pt-2">
      <div
        role="status"
        aria-live="polite"
        className="fade-up glass pointer-events-auto w-full max-w-md rounded-2xl p-3.5 shadow-2xl"
      >
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-base font-extrabold text-slate-900">
              {applying ? "Updating…" : "New version ready"}
            </p>
            <p className="mt-0.5 text-sm leading-snug text-slate-600">
              {applying
                ? "Reloading DBW AI with the latest changes."
                : "DBW AI has shipped changes since this app was installed. Reload to get them."}
            </p>
          </div>
          {!applying && (
            <button
              type="button"
              onClick={dismissUpdate}
              aria-label="Dismiss update prompt"
              className="-mr-2 -mt-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-500 transition active:bg-slate-100"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={applyUpdate}
            disabled={applying}
            className="btn-primary min-h-11 flex-1 rounded-xl px-4 py-3 text-base font-bold text-white disabled:opacity-60"
          >
            {applying ? "Reloading…" : "Reload now"}
          </button>
          {!applying && (
            <button
              type="button"
              onClick={dismissUpdate}
              className="min-h-11 rounded-xl border border-slate-300 px-4 py-3 text-base font-semibold text-slate-700 transition active:bg-slate-100"
            >
              Not now
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
