"use client";

import { useSyncExternalStore } from "react";

/**
 * Ships new builds to devices that already installed the app.
 *
 * A browser only re-fetches `/sw.js` when the page loads, so an installed app
 * that is launched, left in the background for a day and launched again would
 * otherwise never learn that a new build exists. This module keeps a check
 * running for the life of the page - on mount, on every return to the
 * foreground, on reconnect, and on a slow timer - and decides what to do with
 * whatever it finds.
 *
 * The policy is about not stealing work. The builder autosaves on a timer, so
 * reloading a tab the user is looking at can throw away what they were doing.
 * So an update found while the app is backgrounded is applied immediately and
 * the reload is held until they come back, and one found while they are looking
 * at it waits behind a prompt.
 */

/** Background sweep for a tab left open on one screen. */
const POLL_MS = 30 * 60 * 1000;

/**
 * Floor between two network checks. Foreground and reconnect events can fire in
 * bursts - a phone switching between two apps raises both at once - and each
 * `update()` is a request for the whole worker script.
 */
const MIN_CHECK_GAP_MS = 5 * 60 * 1000;

/** If a hand-over never completes, reload anyway rather than sit on a stale app. */
const APPLY_TIMEOUT_MS = 5000;

export type UpdateState = "idle" | "available" | "applying";

export interface UpdateSnapshot {
  state: UpdateState;
  /** Set when the user declines for now, so the prompt stops asking this session. */
  deferred: boolean;
}

const IDLE: UpdateSnapshot = { state: "idle", deferred: false };

let snapshot: UpdateSnapshot = IDLE;
let started = false;
let waiting: ServiceWorker | null = null;
let applyTimer: number | null = null;
let reloadPending = false;
let lastCheck = 0;
/** True from the moment we ask for a hand-over until the reload lands. */
let handedOver = false;

/** Registrations already have listeners attached, keyed so re-checking is free. */
const watched = new WeakSet<ServiceWorkerRegistration>();
const listeners = new Set<() => void>();

function emit(next: Partial<UpdateSnapshot>) {
  const merged = { ...snapshot, ...next };
  if (merged.state === snapshot.state && merged.deferred === snapshot.deferred) return;
  snapshot = merged;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function reload() {
  window.location.reload();
}

function onControllerChange() {
  // The first worker a device ever installs also fires this, as it claims the
  // page it was registered from. There is no older build to move off in that
  // case, so reloading on it would double-load every new visitor for nothing.
  if (!handedOver) return;

  // A new worker just took over, so the document is now older than the worker
  // serving its assets and its chunk URLs are about to stop resolving. Reloading
  // is the fix, but not while someone is looking at it: the builder autosaves
  // on a timer that a reload would cut short.
  if (document.visibilityState === "visible") {
    reload();
    return;
  }
  reloadPending = true;
}

function onVisibilityChange() {
  if (document.visibilityState !== "visible") return;

  // A hand-over that landed while we were hidden takes priority over looking
  // for new work: the page is already running the wrong build.
  if (reloadPending) {
    reloadPending = false;
    reload();
    return;
  }

  void checkForUpdate();
}

function onOnline() {
  void checkForUpdate();
}

function found(worker: ServiceWorker) {
  if (worker.state !== "installed") return;

  // No controller means this is the very first install rather than an update.
  // There is no previous worker to hand over from, so there is nothing to ask
  // about and nothing to wait for.
  if (!navigator.serviceWorker.controller) return;

  // The same worker is re-reported by every check, so this is also the test
  // for "is this the update the user already said not to?". A different worker
  // means a newer build landed on top, and that one gets to ask again.
  const isNewBuild = waiting !== worker;
  waiting = worker;

  // Nobody is waiting on an answer right now, so there is no reason to wait on
  // one. Take the update now; the reload is held until the tab is visible again.
  if (document.visibilityState === "hidden") {
    applyUpdate();
    return;
  }

  emit({ state: "available", deferred: isNewBuild ? false : snapshot.deferred });
}

function watch(reg: ServiceWorkerRegistration) {
  if (watched.has(reg)) return;
  watched.add(reg);

  reg.addEventListener("updatefound", () => {
    const installing = reg.installing;
    if (!installing) return;
    installing.addEventListener("statechange", () => found(installing));
  });

  // A worker can already be waiting when this page loads: the check that
  // installed it ran on an earlier visit, or the user was asked then and said
  // not now. Either way it is an update that has not been applied.
  if (reg.waiting) found(reg.waiting);
}

async function checkForUpdate() {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

  const now = Date.now();
  if (now - lastCheck < MIN_CHECK_GAP_MS) return;
  lastCheck = now;

  try {
    const reg = await navigator.serviceWorker.getRegistration("/");
    if (!reg) return;
    // An older page session may have left a hand-over half-done.
    watch(reg);
    await reg.update();
    if (reg.waiting) found(reg.waiting);
  } catch {
    // Offline, or the request was throttled. The next trigger tries again.
  }
}

/** Starts registration and the update checks. Safe to call from any mount. */
export function startUpdateCycle() {
  if (started || typeof window === "undefined" || !("serviceWorker" in navigator)) return;
  started = true;

  navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);
  document.addEventListener("visibilitychange", onVisibilityChange);
  window.addEventListener("online", onOnline);
  window.setInterval(() => void checkForUpdate(), POLL_MS);

  navigator.serviceWorker
    .register("/sw.js", { scope: "/" })
    .then(watch)
    .catch(() => undefined);
}

/** Hands the waiting worker over and reloads onto it. */
export function applyUpdate() {
  if (!waiting) return;

  handedOver = true;
  emit({ state: "applying" });

  if (applyTimer !== null) window.clearTimeout(applyTimer);
  applyTimer = window.setTimeout(reload, APPLY_TIMEOUT_MS);

  waiting.postMessage({ type: "SKIP_WAITING" });
}

/**
 * Declines the update for the rest of this page session only. Deliberately not
 * persisted: a stored dismissal would leave the waiting worker parked forever,
 * so that device would keep running the old build indefinitely, which is the
 * one outcome this whole cycle exists to prevent. A later launch asks again.
 */
export function dismissUpdate() {
  emit({ deferred: true });
}

export function useAppUpdate(): UpdateSnapshot {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

function getSnapshot() {
  return snapshot;
}

function getServerSnapshot() {
  return IDLE;
}
