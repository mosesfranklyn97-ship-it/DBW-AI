"use client";

import { useCallback, useEffect, useState } from "react";
import { LogoMark } from "@/components/Brand";
import { useDisplayMode, useSearchParam } from "@/lib/client/media";

const DISMISS_KEY = "dbw-install-dismissed";
const SHORTCUT_KEY = "dbw-install-shortcut-dismissed";

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

function isIos(): boolean {
  const ua = navigator.userAgent;
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  return /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
}

function isAndroid(): boolean {
  return /Android/i.test(navigator.userAgent);
}

function isTouchDevice(): boolean {
  return (
    /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) ||
    (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.platform))
  );
}

export default function InstallPrompt() {
  const [deferred, setDeferred] = useState<InstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);
  const [showIosSteps, setShowIosSteps] = useState(false);

  const displayMode = useDisplayMode();
  const installed = displayMode !== "browser";
  const isShortcut = useSearchParam("source") === "shortcut";

  useEffect(() => {
    if (installed) return;
    if (!isTouchDevice()) return;

    const dismissKey = isShortcut ? SHORTCUT_KEY : DISMISS_KEY;
    if (localStorage.getItem(dismissKey) === "1") return;

    let timer = 0;
    const reveal = (withSteps: boolean, delay: number) => {
      timer = window.setTimeout(() => {
        if (withSteps) setShowIosSteps(true);
        setVisible(true);
      }, delay);
    };

    if (isIos()) {
      reveal(true, 700);
      return () => window.clearTimeout(timer);
    }

    const onPrompt = (event: Event) => {
      event.preventDefault();
      setDeferred(event as InstallPromptEvent);
      reveal(false, 0);
    };

    const onInstalled = () => setVisible(false);

    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);

    if (isAndroid() && !("onbeforeinstallprompt" in window)) {
      reveal(true, 2500);
    }

    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, [installed, isShortcut]);

  const dismiss = useCallback(() => {
    setVisible(false);
    localStorage.setItem(isShortcut ? SHORTCUT_KEY : DISMISS_KEY, "1");
  }, [isShortcut]);

  const install = useCallback(async () => {
    if (!deferred) {
      setShowIosSteps(true);
      return;
    }
    await deferred.prompt();
    const choice = await deferred.userChoice;
    if (choice.outcome === "accepted") setVisible(false);
    else dismiss();
  }, [deferred, dismiss]);

  if (installed || !visible) return null;

  return (
    // `bottom-0` is load-bearing: `fixed inset-x-0` alone leaves `top`/`bottom`
    // as auto, so the panel was laid out at its static position - i.e. below the
    // entire page - and the install prompt was effectively invisible.
    // `safe-bottom` was also doubling the home-indicator inset, since
    // `.install-prompt-safe` already offsets by it, floating this card ~168px
    // off the bottom of every screen.
    <div className="install-prompt-safe pointer-events-none fixed inset-x-0 bottom-0 z-50 flex justify-center px-3 pt-2">
      <div className="fade-up glass pointer-events-auto w-full max-w-md rounded-2xl p-3.5 shadow-2xl">
        <div className="flex items-start gap-3">
          <LogoMark size={40} />
          <div className="min-w-0 flex-1">
            <p className="text-base font-extrabold text-slate-900">Install DBW AI</p>
            <p className="mt-0.5 text-sm leading-snug text-slate-600">
              Full screen, offline shell, faster loads — like a real app.
            </p>
          </div>
          <button
            type="button"
            onClick={dismiss}
            aria-label="Dismiss install prompt"
            className="-mr-2 -mt-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-500 transition active:bg-slate-100"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {showIosSteps && (
          <ol className="mt-3 space-y-1.5 rounded-xl bg-slate-100 p-3 text-sm leading-snug text-slate-700">
            <li>
              <span className="font-bold text-slate-900">1.</span> Tap{" "}
              <span className="inline-flex translate-y-0.5 items-center rounded bg-slate-100 px-1 py-0.5">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 3v12M8 11l4 4 4-4M5 21h14" />
                </svg>
              </span>{" "}
              Share in Safari
            </li>
            <li>
              <span className="font-bold text-slate-900">2.</span> Choose{" "}
              <span className="font-semibold text-brand-600">Add to Home Screen</span>
            </li>
            <li>
              <span className="font-bold text-slate-900">3.</span> Tap{" "}
              <span className="font-semibold text-slate-900">Add</span> — DBW AI opens like any other app
            </li>
          </ol>
        )}

        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={() => void install()}
            className="btn-primary min-h-11 flex-1 rounded-xl px-4 py-3 text-base font-bold text-white"
          >
            {deferred ? "Install app" : "How to install"}
          </button>
          <button
            type="button"
            onClick={dismiss}
            className="min-h-11 rounded-xl border border-slate-300 px-4 py-3 text-base font-semibold text-slate-700 transition active:bg-slate-100"
          >
            Not now
          </button>
        </div>
      </div>
    </div>
  );
}
