"use client";

import { useSyncExternalStore } from "react";

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

const DISPLAY_QUERIES = ["(display-mode: standalone)", "(display-mode: fullscreen)", "(display-mode: minimal-ui)"];

function subscribeDisplayMode(onChange: () => void) {
  const lists = DISPLAY_QUERIES.map((query) => window.matchMedia(query));
  for (const list of lists) list.addEventListener("change", onChange);
  return () => {
    for (const list of lists) list.removeEventListener("change", onChange);
  };
}

function readDisplayMode(): string {
  const nav = navigator as Navigator & { standalone?: boolean };
  if (nav.standalone === true) return "standalone";
  for (const query of DISPLAY_QUERIES) {
    if (window.matchMedia(query).matches) return query.slice(15, -1);
  }
  return "browser";
}

export function useDisplayMode(): string {
  return useSyncExternalStore(subscribeDisplayMode, readDisplayMode, () => "browser");
}

function subscribeLocation(onChange: () => void) {
  window.addEventListener("popstate", onChange);
  window.addEventListener("hashchange", onChange);
  return () => {
    window.removeEventListener("popstate", onChange);
    window.removeEventListener("hashchange", onChange);
  };
}

export function useSearchParam(name: string): string | null {
  return useSyncExternalStore(
    subscribeLocation,
    () => new URLSearchParams(window.location.search).get(name),
    () => null,
  );
}

/**
 * True while the on-screen keyboard is open.
 *
 * `visualViewport` is the only signal that stays correct when the browser UI
 * animates: `innerHeight` lags during the transition, and the layout viewport
 * never shrinks at all. A `fixed bottom-0` bar therefore rides up and ends up
 * sitting directly on top of the caret in whichever field is lowest on screen.
 */
function subscribeViewport(onChange: () => void) {
  const viewport = window.visualViewport;
  if (!viewport) return () => {};
  viewport.addEventListener("resize", onChange);
  viewport.addEventListener("scroll", onChange);
  return () => {
    viewport.removeEventListener("resize", onChange);
    viewport.removeEventListener("scroll", onChange);
  };
}

// 120px of shrink is well clear of browser-chrome collapse and pinch-zoom, both
// of which also move the visual viewport without a keyboard being involved.
const KEYBOARD_THRESHOLD_PX = 120;

function readKeyboardOpen(): boolean {
  const viewport = window.visualViewport;
  if (!viewport) return false;
  return window.innerHeight - viewport.height - viewport.offsetTop > KEYBOARD_THRESHOLD_PX;
}

export function useKeyboardOpen(): boolean {
  return useSyncExternalStore(subscribeViewport, readKeyboardOpen, () => false);
}

/**
 * Append dictated speech to whatever is already in a field, without clobbering
 * it and without gluing words together when the existing text ends mid-sentence.
 *
 * Both the hero composer and the builder's refine box need this, and they need
 * it identically: a caller that assigns the transcript instead of appending
 * silently deletes whatever the user had already typed.
 */
export function joinTranscript(base: string, spoken: string): string {
  const head = base.trim();
  const tail = spoken.trim();
  if (!head) return tail;
  if (!tail) return head;
  const needsSpace = !/[\s([{\u2018\u201c/-]$/.test(head) && !/^[.,!?;:)\]}\u2019\u201d]/.test(tail);
  return `${head}${needsSpace ? " " : ""}${tail}`;
}
