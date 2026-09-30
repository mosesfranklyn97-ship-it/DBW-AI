"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import SiteFooter from "@/components/SiteFooter";
import SiteHeader from "@/components/SiteHeader";
import { apiFetch, type SessionInfo } from "@/lib/client/api";
import {
  DEFAULT_PREFERENCES,
  getPreferenceServerSnapshot,
  getPreferenceSnapshot,
  subscribeToPreferences,
  writePreferences,
  type Preferences,
  type VoiceMode,
} from "@/lib/client/preferences";
import { MIC_MESSAGES, getMicState, requestMicrophoneAccess, type MicState } from "@/lib/client/microphone";
import { DIALECTS, DIALECT_META, type Dialect } from "@/lib/types";

function Card({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="glass-soft rounded-2xl p-5 sm:p-6">
      <h2 className="text-base font-extrabold text-slate-900">{title}</h2>
      {description && <p className="mt-1 text-sm text-slate-600">{description}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2 border-t border-slate-200 py-4 first:border-t-0 first:pt-0 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-slate-900">{label}</p>
        {hint && <p className="mt-0.5 text-xs text-slate-600">{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

const VOICE_OPTIONS: { value: VoiceMode; label: string }[] = [
  { value: "auto", label: "Automatic" },
  { value: "whisper", label: "Whisper" },
  { value: "browser", label: "Browser speech" },
];

export default function SettingsPage() {
  // Subscribing to the store keeps this page correct on the server, on first
  // paint, and when another tab changes a preference.
  const prefs = useSyncExternalStore(
    subscribeToPreferences,
    getPreferenceSnapshot,
    getPreferenceServerSnapshot,
  );
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [saved, setSaved] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [micState, setMicState] = useState<MicState>("unknown");
  const [micBusy, setMicBusy] = useState(false);
  // Draft value for the sample-rows field; committed to preferences on blur.
  // Seeded from the live store, not DEFAULT_PREFERENCES - a user who previously
  // saved 25 would otherwise see 10 in the field and silently reset it to 10
  // the first time the field lost focus.
  const [rowsDraft, setRowsDraft] = useState(() => String(prefs.sampleRows));
  const rowsEditing = useRef(false);
  useEffect(() => {
    if (rowsEditing.current) return;
    setRowsDraft(String(prefs.sampleRows));
  }, [prefs.sampleRows]);

  useEffect(() => {
    let active = true;
    apiFetch<SessionInfo>("/api/session")
      .then((value) => {
        if (active) setSession(value);
      })
      .catch(() => {
        if (active) setSession(null);
      });
    void getMicState().then((value) => {
      if (active) setMicState(value);
    });
    return () => {
      active = false;
    };
  }, []);

  /** Raise the browser's microphone prompt without starting a recording. */
  const grantMicrophone = useCallback(async () => {
    if (micBusy) return;
    setMicBusy(true);
    setError(null);
    const result = await requestMicrophoneAccess();
    setMicState(await getMicState());
    if (!result.ok) setError(MIC_MESSAGES[result.error]);
    else setSaved(true);
    setMicBusy(false);
  }, [micBusy]);

  const update = useCallback(<K extends keyof Preferences>(key: K, value: Preferences[K]) => {
    writePreferences({ ...getPreferenceSnapshot(), [key]: value });
    setSaved(true);
  }, []);

  const signOut = useCallback(async () => {
    setSigningOut(true);
    setError(null);
    try {
      await apiFetch<{ ok: boolean }>("/api/auth/signout", { method: "POST" });
      // Signing out has to invalidate what the server already rendered, not just
      // swap the visible route. `replace` alone would leave the signed-in shell
      // in the router cache, so the landing page could still paint from the
      // session that was just destroyed; `refresh` re-runs the server components
      // and re-reads the session cookie that the signout cleared.
      router.replace("/");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not sign out.");
      setSigningOut(false);
    }
  }, [router]);

  const resetAll = useCallback(() => {
    writePreferences({ ...DEFAULT_PREFERENCES });
    setSaved(true);
  }, []);

  const copyWorkspace = useCallback(async () => {
    if (!session?.workspaceId) return;
    try {
      await navigator.clipboard.writeText(session.workspaceId);
      setSaved(true);
    } catch {
      setError("Could not copy — select the ID and copy manually.");
    }
  }, [session]);

  return (
    <div className="min-h-dvh">
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
        <h1 className="text-3xl font-black text-slate-900 sm:text-4xl">Settings</h1>
        <p className="mt-2 text-sm text-slate-600">
          Preferences are saved on this device. Your account and plan live on the server.
        </p>

        {error && (
          <div className="mt-5 rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-800">
            {error}
          </div>
        )}

        <div className="mt-8 space-y-5">
          <Card title="Account" description="Who this device is signed in as.">
            <Row label="Signed in" hint={session?.authenticated ? "Your work is saved to your account." : undefined}>
              {session?.authenticated ? (
                // A long address is wider than a 320px screen; without min-w-0
                // plus truncate it overflowed and was clipped by the page.
                <span className="flex min-w-0 max-w-full items-center gap-2 rounded-full bg-emerald-50 px-3 py-1.5 text-sm font-semibold text-emerald-800">
                  <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" />
                  <span className="min-w-0 truncate">{session.user?.email ?? "Signed in"}</span>
                </span>
              ) : (
                <Link
                  href="/login"
                  className="btn-primary inline-block min-h-11 rounded-xl px-4 py-2.5 text-base font-semibold text-white"
                >
                  Sign in
                </Link>
              )}
            </Row>

            {session?.authenticated && (
              <Row label="Sign out" hint="Ends the session on this browser only.">
                <button
                  type="button"
                  onClick={() => void signOut()}
                  disabled={signingOut}
                  className="min-h-11 rounded-xl border border-slate-300 px-4 py-2.5 text-base font-semibold text-slate-700 transition active:bg-slate-50 disabled:opacity-50"
                >
                  {signingOut ? "Signing out…" : "Sign out"}
                </button>
              </Row>
            )}

            <Row label="Workspace ID" hint="Your databases are grouped under this ID.">
              <button
                type="button"
                onClick={() => void copyWorkspace()}
                disabled={!session}
                className="min-h-11 rounded-xl border border-slate-300 px-4 py-2 font-mono text-xs text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
              >
                {session ? `${session.workspaceId.slice(0, 12)}… · copy` : "Loading…"}
              </button>
            </Row>
          </Card>

          <Card
            title="Schema defaults"
            description="Applied when you start a new database. Existing databases keep their own dialect."
          >
            <Row label="Default SQL dialect" hint="Used by the prompt box and new projects.">
              <select
                value={prefs.defaultDialect}
                aria-label="Default SQL dialect"
                onChange={(event) => update("defaultDialect", event.target.value as Dialect)}
                className="min-h-11 rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-base font-semibold text-slate-800"
              >
                {DIALECTS.map((dialect) => (
                  <option key={dialect} value={dialect}>
                    {DIALECT_META[dialect].emoji} {DIALECT_META[dialect].label}
                  </option>
                ))}
              </select>
            </Row>

            <Row label="Sample rows in exports" hint="Rows generated into sample_data.sql (3–50).">
              {/*
                Kept as a local draft string and committed on blur. Writing the
                clamped number straight back into the value on every keystroke
                made the field impossible to edit: one backspace produced "",
                which clamped to 3 and immediately re-rendered over the caret.
              */}
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                aria-label="Sample rows in exports, between 3 and 50"
                value={rowsDraft}
                onFocus={() => {
                  rowsEditing.current = true;
                }}
                onChange={(event) => setRowsDraft(event.target.value.replace(/[^0-9]/g, "").slice(0, 2))}
                onBlur={() => {
                  rowsEditing.current = false;
                  const parsed = Number(rowsDraft);
                  if (rowsDraft !== "" && Number.isFinite(parsed)) update("sampleRows", parsed);
                  setRowsDraft(String(getPreferenceSnapshot().sampleRows));
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.currentTarget.blur();
                }}
                className="min-h-11 w-28 rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-base font-semibold text-slate-800"
              />
            </Row>
          </Card>

          <Card title="Voice input" description="How the microphone button turns speech into text.">
            <Row
              label="Voice engine"
              hint={
                session?.ai.whisper
                  ? "Whisper is available on this deployment, so it records and transcribes accurately."
                  : "No transcription key is configured, so the browser's own speech recognition is used."
              }
            >
              <div className="flex flex-wrap gap-2">
                {VOICE_OPTIONS.map((option) => {
                  const active = prefs.voiceMode === option.value;
                  const unavailable = option.value === "whisper" && !session?.ai.whisper;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      disabled={unavailable}
                      onClick={() => update("voiceMode", option.value)}
                      className={`min-h-11 rounded-xl px-3.5 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${
                        active
                          ? "bg-brand-600 text-white"
                          : "border border-slate-300 text-slate-700 hover:bg-slate-50"
                      }`}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
            </Row>

            <Row
              label="Microphone access"
              hint="Required for the voice button. The browser asks you the first time."
            >
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
                    micState === "granted"
                      ? "bg-emerald-50 text-emerald-800"
                      : micState === "denied"
                        ? "bg-rose-50 text-rose-700"
                        : micState === "insecure" || micState === "unsupported"
                          ? "bg-amber-50 text-amber-800"
                          : "bg-slate-100 text-slate-700"
                  }`}
                >
                  {micState === "granted"
                    ? "Allowed"
                    : micState === "denied"
                      ? "Blocked"
                      : micState === "insecure"
                        ? "Needs HTTPS"
                        : micState === "unsupported"
                          ? "Not supported"
                          : micState === "prompt"
                            ? "Not asked yet"
                            : "Checking…"}
                </span>
                <button
                  type="button"
                  onClick={() => void grantMicrophone()}
                  disabled={micBusy || micState === "granted" || micState === "insecure" || micState === "unsupported"}
                    className="min-h-11 rounded-xl border border-slate-300 px-3.5 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {micBusy ? "Asking…" : micState === "granted" ? "Allowed" : "Allow microphone"}
                </button>
              </div>
            </Row>
          </Card>

          <Card title="Builder" description="Display options for the schema editor.">
            <Row label="Compact table cards" hint="Fits more tables on screen while you edit.">
              <button
                type="button"
                role="switch"
                aria-checked={prefs.compactTables}
                aria-label="Compact table cards"
                onClick={() => update("compactTables", !prefs.compactTables)}
                className="flex min-h-11 min-w-[3.5rem] items-center rounded-full px-1 transition active:opacity-80"
              >
                <span
                  className={`relative h-7 w-12 rounded-full transition-colors ${
                    prefs.compactTables ? "bg-brand-600" : "bg-slate-300"
                  }`}
                >
                  <span
                    className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ${
                      prefs.compactTables ? "left-6" : "left-1"
                    }`}
                  />
                </span>
              </button>
            </Row>
          </Card>

          <Card title="Reset" description="Put every preference on this device back to its default.">
            <button
              type="button"
              onClick={resetAll}
                  className="min-h-11 rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              Reset all preferences
            </button>
          </Card>
        </div>

        <p aria-live="polite" className="mt-6 h-5 text-center text-xs font-semibold text-emerald-700">
          {saved ? "Saved." : ""}
        </p>
      </main>
      <SiteFooter />
    </div>
  );
}
