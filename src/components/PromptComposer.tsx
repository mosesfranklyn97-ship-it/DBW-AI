"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import DialectPicker from "@/components/DialectPicker";
import VoiceInput, { type VoiceInputHandle } from "@/components/VoiceInput";
import { apiFetch, type SessionInfo } from "@/lib/client/api";
import { joinTranscript } from "@/lib/client/media";
import {
  getPreferenceServerSnapshot,
  getPreferenceSnapshot,
  subscribeToPreferences,
} from "@/lib/client/preferences";
import type { DbSchema } from "@/lib/types";

const EXAMPLES = [
  "Build me a hospital system with patients, doctors, appointments",
  "I want e-commerce with users, products, orders. Orders link to users",
  "School system with students, teachers, classes and grades",
  "Mobile money app: customers, accounts, transactions, loans",
  "Hotel booking — guests, rooms, bookings and payments",
  "Delivery business with drivers, vehicles, trips and customers",
];

export default function PromptComposer() {
  const router = useRouter();
  // The saved default dialect/voice mode come from the preferences store, so
  // the settings page and this box can never disagree.
  const storedPreferences = useSyncExternalStore(
    subscribeToPreferences,
    getPreferenceSnapshot,
    getPreferenceServerSnapshot,
  );
  const [prompt, setPrompt] = useState("");
  const [dialectOverride, setDialectOverride] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [quota, setQuota] = useState(false);
  const [session, setSession] = useState<SessionInfo | null>(null);
  const dialect = (dialectOverride ?? storedPreferences.defaultDialect) as DbSchema["dialect"];
  // Guards against a double submit while the POST is in flight, which is what
  // previously kept `loading` stuck on forever.
  const inFlight = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  // Prompt text as of the moment dictation began, so interim results can be
  // re-rendered without either duplicating or erasing earlier speech.
  const voiceBaseRef = useRef<string | null>(null);
  const lastVoiceValueRef = useRef<string>("");
  const promptRef = useRef("");
  const voiceRef = useRef<VoiceInputHandle>(null);

  useEffect(() => {
    let active = true;
    apiFetch<SessionInfo>("/api/session")
      .then((value) => {
        if (active) setSession(value);
      })
      .catch(() => {
        if (active) setSession(null);
      });
    return () => {
      active = false;
    };
  }, []);

  const updatePrompt = useCallback((value: string) => {
    promptRef.current = value;
    setPrompt(value);
  }, []);

  const handleTranscript = useCallback(
    (text: string) => {
      if (voiceBaseRef.current === null) {
        voiceBaseRef.current = promptRef.current;
      }
      const merged = joinTranscript(voiceBaseRef.current, text);
      lastVoiceValueRef.current = merged;
      updatePrompt(merged);
      // Keep the caret after the inserted speech so typing can continue there.
      const field = textareaRef.current;
      if (field) {
        field.focus();
        const end = field.value.length;
        field.setSelectionRange(end, end);
      }
    },
    [updatePrompt],
  );

  const handleManualEdit = useCallback(
    (value: string) => {
      // A keystroke that does not match the last dictated value means the user
      // took over, so the next dictation session starts from the new text.
      if (value !== lastVoiceValueRef.current) voiceBaseRef.current = null;
      updatePrompt(value);
    },
    [updatePrompt],
  );

  const generate = useCallback(async () => {
    if (inFlight.current) return;
    // Generating is the other way a hold ends: the finger is on the mic, not
    // this button, so release it explicitly or it keeps recording in the
    // background while the request is already in flight.
    voiceRef.current?.stop();
    if (prompt.trim().length < 4) {
      setError("Tell me a little more about the database you want.");
      return;
    }
    inFlight.current = true;
    setLoading(true);
    setError(null);
    setQuota(false);
    try {
      const result = await apiFetch<{ id: string; schema: DbSchema }>("/api/generate", {
        method: "POST",
        body: JSON.stringify({ prompt, dialect }),
      });
      router.push(`/builder/${result.id}`);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Something went wrong";
      setError(message);
      if (message.toLowerCase().includes("limit")) setQuota(true);
    } finally {
      // Reset even on success: if the client-side navigation to the builder
      // fails, the button must not stay disabled with no way to retry.
      inFlight.current = false;
      setLoading(false);
    }
  }, [prompt, dialect, router]);

  return (
    <div id="build" className="glass fade-up rounded-3xl p-4 shadow-[0_30px_90px_-40px_rgba(56,89,255,0.8)] sm:p-6">
      <div className="relative">
          <label htmlFor="prompt" className="mb-2 block text-sm font-semibold uppercase tracking-[0.1em] text-slate-600">
            Describe your database
          </label>
          <textarea
            id="prompt"
            ref={textareaRef}
            value={prompt}
            onChange={(event) => handleManualEdit(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") void generate();
            }}
            rows={4}
            enterKeyHint="enter"
            autoCapitalize="sentences"
            placeholder={'e.g. "Build me a hospital system with patients, doctors, appointments. Appointments link to patients and doctors."'}
            /* Padding is spelled per-side rather than as p-4 plus overrides, so
               the reserved corner for the mic cannot lose a source-order race. */
            className="w-full resize-none rounded-2xl border border-slate-300 bg-white pt-4 pb-14 pl-4 pr-16 text-base leading-relaxed text-slate-900 placeholder:text-slate-500 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/25"
          />
          <VoiceInput
            ref={voiceRef}
            embedded
            size="xs"
            onTranscript={handleTranscript}
            whisperEnabled={
              storedPreferences.voiceMode === "whisper" ||
              (storedPreferences.voiceMode === "auto" && Boolean(session?.ai.whisper))
            }
            forceBrowser={storedPreferences.voiceMode === "browser"}
          />
      </div>

      <div className="mt-4">
        <p className="mb-2 text-sm font-semibold uppercase tracking-[0.1em] text-slate-600">How you want it?</p>
        <DialectPicker value={dialect} onChange={setDialectOverride} />
      </div>

      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <button
          type="button"
          onClick={generate}
          disabled={loading}
          className="btn-primary flex w-full items-center justify-center gap-2 rounded-2xl px-6 py-3.5 text-base font-bold text-white sm:w-auto"
        >
          {loading ? (
            <>
              <svg className="animate-spin" width="18" height="18" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="9" stroke="rgba(255,255,255,0.35)" strokeWidth="3" />
                <path d="M21 12a9 9 0 0 0-9-9" stroke="white" strokeWidth="3" strokeLinecap="round" />
              </svg>
              Architecting your database…
            </>
          ) : (
            <>⚡ Generate my database</>
          )}
        </button>
        <p className="text-xs text-slate-500">
          {session ? (
            <>
              <span className="font-semibold text-slate-800">{session.limits.label}</span> · {session.projectsThisMonth}/
              {session.limits.maxProjectsPerMonth} databases this month · up to {session.limits.maxTables} tables
            </>
          ) : (
            "Free plan · 3 databases / month"
          )}
        </p>
      </div>

      {error && (
        <div className="mt-3 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-700">
          {error}{" "}
          {quota && (
            <Link href="/pricing" className="font-semibold underline underline-offset-2">
              See plans →
            </Link>
          )}
        </div>
      )}

      <div className="mt-5 border-t border-slate-200 pt-4">
        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.15em] text-slate-500">Try one of these</p>
        <div className="flex flex-wrap gap-2">
          {EXAMPLES.map((example) => (
            <button
              key={example}
              type="button"
              onClick={() => {
                voiceBaseRef.current = null;
                updatePrompt(example);
              }}
              className="min-h-11 rounded-full border border-slate-200 bg-slate-100 px-3.5 py-1.5 text-xs font-medium text-slate-700 transition hover:border-brand-400 hover:bg-brand-50 hover:text-brand-700"
            >
              {example}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
