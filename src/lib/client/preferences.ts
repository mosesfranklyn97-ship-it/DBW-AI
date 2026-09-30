"use client";

import type { Dialect } from "@/lib/types";

/**
 * Client-side preferences. These are per-device, not per-account, so they live
 * in localStorage rather than the database — no schema migration required and
 * nothing to leak if the account is deleted.
 */
const KEY = "dbw-preferences";

export type VoiceMode = "auto" | "whisper" | "browser";

export interface Preferences {
  defaultDialect: Dialect;
  voiceMode: VoiceMode;
  sampleRows: number;
  compactTables: boolean;
}

export const DEFAULT_PREFERENCES: Preferences = {
  defaultDialect: "mysql",
  voiceMode: "auto",
  sampleRows: 20,
  compactTables: false,
};

const DIALECTS: Dialect[] = ["mysql", "postgres", "sqlite", "supabase"];
const VOICE_MODES: VoiceMode[] = ["auto", "whisper", "browser"];

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(Math.trunc(value), min), max);
}

/** Tolerant parse: anything unexpected falls back to the default. */
export function normalizePreferences(raw: unknown): Preferences {
  if (typeof raw !== "object" || raw === null) return { ...DEFAULT_PREFERENCES };
  const input = raw as Partial<Preferences>;
  return {
    defaultDialect: DIALECTS.includes(input.defaultDialect as Dialect)
      ? (input.defaultDialect as Dialect)
      : DEFAULT_PREFERENCES.defaultDialect,
    voiceMode: VOICE_MODES.includes(input.voiceMode as VoiceMode)
      ? (input.voiceMode as VoiceMode)
      : DEFAULT_PREFERENCES.voiceMode,
    sampleRows: clamp(Number(input.sampleRows), 3, 50),
    compactTables: typeof input.compactTables === "boolean" ? input.compactTables : false,
  };
}

export function writePreferences(next: Preferences) {
  const safe = normalizePreferences(next);
  try {
    window.localStorage.setItem(KEY, JSON.stringify(safe));
  } catch {
    // Private mode or a full quota: preferences simply stay session-only.
  }
  // Keep the store snapshot and any other open tabs in step with the change.
  cache = safe;
  window.dispatchEvent(new CustomEvent(PREFERENCES_EVENT));
  return safe;
}

export const PREFERENCES_EVENT = "dbw:preferences";

/**
 * `useSyncExternalStore` requires getSnapshot to return a referentially stable
 * value, otherwise React re-renders forever. The parsed object is therefore
 * cached and only recomputed when something actually writes to storage.
 */
let cache: Preferences | null = null;

function readStorage(): Preferences {
  if (typeof window === "undefined") return DEFAULT_PREFERENCES;
  try {
    const stored = window.localStorage.getItem(KEY);
    if (!stored) return DEFAULT_PREFERENCES;
    return normalizePreferences(JSON.parse(stored));
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

export function subscribeToPreferences(onChange: () => void): () => void {
  const handler = () => {
    cache = null;
    onChange();
  };
  window.addEventListener(PREFERENCES_EVENT, handler);
  // Fires for changes made in other tabs.
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener(PREFERENCES_EVENT, handler);
    window.removeEventListener("storage", handler);
  };
}

export function getPreferenceSnapshot(): Preferences {
  cache ??= readStorage();
  return cache;
}

/** Server render and the hydration pass both see the defaults. */
export function getPreferenceServerSnapshot(): Preferences {
  return DEFAULT_PREFERENCES;
}
