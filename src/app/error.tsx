"use client";

import { useEffect } from "react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Without this the failure is invisible server-side, and the digest here is
    // the only handle that lines up with the Vercel logs.
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-dvh items-center justify-center px-5 pb-[calc(4rem+env(safe-area-inset-bottom,0px))] pt-[calc(4rem+env(safe-area-inset-top,0px))]">
      <div className="glass fade-up w-full max-w-md rounded-3xl p-7 text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-rose-500/10 text-2xl">
          ⚠️
        </div>
        <h1 className="text-xl font-bold text-slate-900">Something broke on our side</h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">
          Your work is safe. This did not save anything, so try again — if it keeps happening the
          database may be briefly unreachable.
        </p>
        {error.digest && (
          <p className="mt-3 break-words font-mono text-xs text-slate-400">ref {error.digest}</p>
        )}
        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
          <button type="button" onClick={reset} className="btn-primary rounded-xl px-5 py-3 text-sm font-bold text-white">
            Try again
          </button>
          <a
            href="/projects"
            className="rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition active:bg-slate-100"
          >
            My databases
          </a>
        </div>
      </div>
    </div>
  );
}
