"use client";

import { useEffect, useId, useRef, useState } from "react";

export interface ConfirmRequest {
  title: string;
  /** What exactly is lost. Be specific: "appointments and its 6 columns". */
  body: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}

/**
 * Bottom-sheet confirmation, sized for a thumb.
 *
 * The app previously deleted tables, columns and whole projects on a single
 * tap of a ~20px target with no confirmation and no undo. On touch, a
 * full-width sheet with the destructive action as a separate, deliberately
 * hard-to-hit-by-accident target is the difference between a mis-tap and
 * losing a schema.
 */
export default function ConfirmSheet({
  request,
  onCancel,
  onConfirm,
}: {
  request: ConfirmRequest | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const confirmRef = useRef<HTMLButtonElement | null>(null);
  const titleId = useId();
  const bodyId = useId();

  useEffect(() => {
    if (!request) return;
    cancelRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
        return;
      }
      if (event.key !== "Tab") return;
      // Both buttons have to be in the cycle. Trapping on cancel alone made
      // the confirm button unreachable by keyboard, so the only way to accept
      // was to guess a screen-reader shortcut.
      const focusables = [cancelRef.current, confirmRef.current].filter(Boolean) as HTMLElement[];
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [request, onCancel]);

  if (!request) return null;

  const destructive = request.destructive !== false;

  return (
    <div
      className="fade-in fixed inset-0 z-[80] flex items-end justify-center sm:items-center"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={bodyId}
    >
      <button
        type="button"
        aria-label="Cancel"
        tabIndex={-1}
        onClick={onCancel}
        className="absolute inset-0 cursor-default bg-slate-950/45 backdrop-blur-[2px]"
      />

      {/* `items-end` with no height cap let the tallest copy in the app
          (a foreign-key-aware delete prompt) push the drag handle and title
          off the top of a 375-393px-tall landscape viewport. */}
      <div className="sheet-in safe-bottom relative max-h-[100dvh] w-full max-w-md overflow-y-auto overscroll-contain rounded-t-3xl bg-white p-5 shadow-2xl sm:rounded-3xl sm:p-6">
        <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-slate-300 sm:hidden" aria-hidden="true" />

        <h2 id={titleId} className="text-lg font-extrabold text-slate-900">
          {request.title}
        </h2>
        <p id={bodyId} className="mt-2 text-base leading-relaxed text-slate-600">
          {request.body}
        </p>

        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            className="btn-secondary min-h-11 w-full rounded-xl px-5 py-3 text-base font-semibold text-slate-800 sm:w-auto"
          >
            {request.cancelLabel ?? "Cancel"}
          </button>
          <button
            ref={confirmRef}
            type="button"
            disabled={confirming}
            onClick={() => {
              setConfirming(true);
              onConfirm();
            }}
            className={`min-h-11 w-full rounded-xl px-5 py-3 text-base font-semibold text-white sm:w-auto ${
              destructive ? "btn-danger" : "btn-primary"
            }`}
          >
            {request.confirmLabel ?? "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
}
