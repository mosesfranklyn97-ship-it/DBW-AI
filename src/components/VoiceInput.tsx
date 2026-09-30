"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import {
  MIC_AUDIO_CONSTRAINTS,
  MIC_MESSAGES as ERROR_TEXT,
  classifyMicError,
  getMicState,
  requestMicrophoneAccess,
  type MicError,
  type MicState,
} from "@/lib/client/microphone";

interface SpeechRecognitionAlternativeLike {
  transcript: string;
}
interface SpeechRecognitionResultLike {
  0: SpeechRecognitionAlternativeLike;
  isFinal: boolean;
  length: number;
}
interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: { length: number; [index: number]: SpeechRecognitionResultLike };
}
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

interface Props {
  onTranscript: (text: string, isFinal: boolean) => void;
  whisperEnabled: boolean;
  /** Set from Settings to use the browser recogniser even when Whisper exists. */
  forceBrowser?: boolean;
  size?: "lg" | "sm" | "xs";
  /**
   * Renders a bare control for a parent to place itself, so the button can sit
   * in a corner of a textarea. The parent must be `relative`; the floating
   * hint resolves against it because this variant emits no wrapper box.
   */
  embedded?: boolean;
}

export interface VoiceInputHandle {
  /** Turns the mic off, e.g. when the user taps Generate instead. */
  stop: () => void;
}

const VoiceInput = forwardRef<VoiceInputHandle, Props>(function VoiceInput(
  { onTranscript, whisperEnabled, forceBrowser = false, size = "lg", embedded = false },
  ref,
) {
  const [state, setState] = useState<"idle" | "requesting" | "listening" | "processing">("idle");
  const [status, setStatus] = useState<string>("");
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const statusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Set synchronously so a second tap during the getUserMedia/permission
  // await cannot start a second recorder writing into the same buffer.
  const startingRef = useRef(false);
  // What the user has asked for: mic running or mic off. The browser's own
  // permission dialog outlives the tap that opened it, so every async step
  // re-checks this, or the mic would stay live after a tap meant to stop it.
  const wantedRef = useRef(false);
  // Chrome ends a recognition session on its own after a pause even with
  // `continuous: true`, which silently truncates long dictation. These let us
  // tell a self-inflicted stop (user tapped again) from Chrome's own timeout.
  const wantListeningRef = useRef(false);
  const restartingRef = useRef(false);
  const mountedRef = useRef(true);
  const [micState, setMicState] = useState<MicState>("unknown");
  // Live input level, 0..1. This is the only feedback available while the
  // Whisper path is recording, because that path shows no text until the whole
  // clip has been uploaded and transcribed. Without it a user who is being
  // drowned out by a neighbour still sees a confident "Recording…" and has no
  // way to notice they are producing unusable audio.
  const [level, setLevel] = useState(0);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const meterFrameRef = useRef<number | null>(null);

  const stopLevelMeter = useCallback(() => {
    if (meterFrameRef.current !== null) {
      cancelAnimationFrame(meterFrameRef.current);
      meterFrameRef.current = null;
    }
    void audioCtxRef.current?.close().catch(() => undefined);
    audioCtxRef.current = null;
    if (mountedRef.current) setLevel(0);
  }, []);

  const startLevelMeter = useCallback(
    (stream: MediaStream) => {
      const AudioContextCtor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextCtor) return;
      let ctx: AudioContext;
      try {
        ctx = new AudioContextCtor();
      } catch {
        return;
      }
      audioCtxRef.current = ctx;
      const analyser = ctx.createAnalyser();
      // Small window: the meter has to react fast enough to show a gap between
      // words, and a large one just smooths the peaks away.
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.6;
      try {
        ctx.createMediaStreamSource(stream).connect(analyser);
      } catch {
        return;
      }
      const samples = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        analyser.getByteTimeDomainData(samples);
        let sum = 0;
        for (let i = 0; i < samples.length; i += 1) {
          const centred = (samples[i] - 128) / 128;
          sum += centred * centred;
        }
        const rms = Math.sqrt(sum / samples.length);
        // Speech sits low in a linear scale; the sqrt plus a floor is what makes
        // ordinary talking move the bar instead of hugging the bottom.
        const scaled = Math.min(1, Math.sqrt(rms) * 2.4);
        if (mountedRef.current) setLevel(scaled);
        meterFrameRef.current = requestAnimationFrame(tick);
      };
      meterFrameRef.current = requestAnimationFrame(tick);
    },
    [],
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Read the current permission up front so the button can say whether the mic
  // is ready, still unasked, or blocked before the user taps anything.
  const refreshMicState = useCallback(() => {
    void getMicState().then((next) => {
      if (mountedRef.current) setMicState(next);
    });
  }, []);

  useEffect(() => {
    refreshMicState();
  }, [refreshMicState]);

  const clearStatusTimer = useCallback(() => {
    if (statusTimer.current) {
      clearTimeout(statusTimer.current);
      statusTimer.current = null;
    }
  }, []);

  const setVoiceState = useCallback((next: "idle" | "requesting" | "listening" | "processing") => {
    if (mountedRef.current) setState(next);
  }, []);

  /** Show a transient status without leaving a timer behind after unmount. */
  const flashStatus = useCallback(
    (message: string) => {
      clearStatusTimer();
      if (!mountedRef.current) return;
      setStatus(message);
      statusTimer.current = setTimeout(() => {
        statusTimer.current = null;
        if (mountedRef.current) setStatus("");
      }, 4000);
    },
    [clearStatusTimer],
  );

  const releaseStream = useCallback(() => {
    stopLevelMeter();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, [stopLevelMeter]);

  useEffect(() => {
    return () => {
      wantListeningRef.current = false;
      wantedRef.current = false;
      clearStatusTimer();
      recognitionRef.current?.stop();
      recorderRef.current?.stream.getTracks().forEach((track) => track.stop());
      releaseStream();
    };
  }, [clearStatusTimer, releaseStream]);

  const startBrowserRecognition = useCallback(() => {
    const globalWindow = window as unknown as {
      SpeechRecognition?: SpeechRecognitionCtor;
      webkitSpeechRecognition?: SpeechRecognitionCtor;
    };
    const Ctor = globalWindow.SpeechRecognition ?? globalWindow.webkitSpeechRecognition;
    if (!Ctor) {
      flashStatus(ERROR_TEXT.unsupported);
      wantListeningRef.current = false;
      setVoiceState("idle");
      return;
    }
    const recognition = new Ctor();
    recognition.lang = "en-US";
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.onresult = (event) => {
      // resultIndex marks the first *changed* result, so starting there drops
      // every already-finalised phrase. Both callers replace the whole field
      // with this value, so the full session transcript has to be rebuilt.
      let text = "";
      for (let i = 0; i < event.results.length; i += 1) {
        text += `${event.results[i][0].transcript} `;
      }
      const isFinal = event.results[event.results.length - 1]?.isFinal ?? false;
      onTranscript(text.replace(/\s+/g, " ").trim(), isFinal);
    };
    recognition.onerror = (event) => {
      // "no-speech"/"aborted" fire when Chrome times out on its own; that is
      // not a real failure, so keep listening instead of dropping the session.
      if (event.error === "no-speech" || event.error === "aborted") return;
      wantListeningRef.current = false;
      flashStatus(
        event.error === "not-allowed" || event.error === "service-not-allowed"
          ? ERROR_TEXT.denied
          : event.error === "audio-capture"
            ? ERROR_TEXT["no-device"]
            : ERROR_TEXT.failed,
      );
      setVoiceState("idle");
    };
    recognition.onend = () => {
      if (wantListeningRef.current && !restartingRef.current) {
        // Chrome ended the session on a silence timeout. Restart transparently
        // so long dictation is not cut off; guard against a restart loop.
        restartingRef.current = true;
        try {
          recognition.start();
          if (mountedRef.current) setStatus("Listening… still going");
        } catch {
          wantListeningRef.current = false;
          setVoiceState("idle");
        } finally {
          restartingRef.current = false;
        }
        return;
      }
      wantListeningRef.current = false;
      setVoiceState("idle");
      clearStatusTimer();
      if (mountedRef.current) setStatus("");
    };
    recognitionRef.current = recognition;
    wantListeningRef.current = true;
    recognition.start();
    setVoiceState("listening");
    setStatus("Listening… tap to stop");
  }, [clearStatusTimer, flashStatus, onTranscript, setVoiceState]);

  const startWhisperRecording = useCallback(async (granted: MediaStream | null) => {
    let stream: MediaStream | null = null;
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        flashStatus(ERROR_TEXT.insecure);
        wantListeningRef.current = false;
        setVoiceState("idle");
        return;
      }
      // The permission probe may already have opened the hardware. Reusing that
      // stream avoids a second getUserMedia, which some browsers reject as
      // "device busy" even though the first call was just stopped.
      stream = granted ?? (await navigator.mediaDevices.getUserMedia({ audio: MIC_AUDIO_CONSTRAINTS }));
      // The user may have tapped to stop while this was awaiting, and at that
      // point there is no recorder yet for the stop path to release.
      if (!wantedRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      startLevelMeter(stream);
      const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/aac"];
      const mimeType = candidates.find((type) => MediaRecorder.isTypeSupported?.(type));
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      const recordedType = recorder.mimeType || mimeType || "audio/webm";
      const extension = recordedType.includes("mp4")
        ? "m4a"
        : recordedType.includes("aac")
          ? "aac"
          : "webm";
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = async () => {
        releaseStream();
        setVoiceState("processing");
        setStatus("Transcribing…");
        const blob = new Blob(chunksRef.current, { type: recordedType });
        const form = new FormData();
        form.append("audio", blob, `voice-note.${extension}`);
        try {
          const response = await fetch("/api/transcribe", { method: "POST", body: form });
          const payload = (await response.json()) as { text?: string; error?: string };
          if (payload.text) {
            onTranscript(payload.text.trim(), true);
            if (mountedRef.current) setStatus("");
          } else {
            flashStatus(payload.error ?? "Could not transcribe");
          }
        } catch {
          flashStatus("Transcription failed");
        }
        setVoiceState("idle");
      };
      recorder.start();
      recorderRef.current = recorder;
      wantListeningRef.current = true;
      setVoiceState("listening");
      setStatus("Recording… tap again to stop");
    } catch (error) {
      // The mic was already granted above; without this the track stays live
      // even though the UI reports that recording never started.
      stream?.getTracks().forEach((track) => track.stop());
      if (streamRef.current === stream) streamRef.current = null;
      wantListeningRef.current = false;
      flashStatus(ERROR_TEXT[classifyMicError(error)]);
      setVoiceState("idle");
    }
  }, [flashStatus, onTranscript, releaseStream, setVoiceState, startLevelMeter]);

  const endListening = useCallback(() => {
    wantedRef.current = false;
    wantListeningRef.current = false;
    recognitionRef.current?.stop();
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    if (!recorderRef.current) {
      setVoiceState("idle");
      clearStatusTimer();
      if (mountedRef.current) setStatus("");
    }
  }, [clearStatusTimer, setVoiceState]);

  const beginListening = useCallback(async () => {
    if (state === "processing" || state === "listening" || state === "requesting") return;
    if (startingRef.current) return;
    wantedRef.current = true;
    startingRef.current = true;
    setVoiceState("requesting");
    setStatus("Requesting microphone access…");
    try {
      // Asked from inside the pointerdown gesture: iOS only grants the mic when
      // getUserMedia runs within a trusted event handler.
      const permission = await requestMicrophoneAccess();
      // The user may have allowed or refused in the browser dialog.
      refreshMicState();
      if (!permission.ok) {
        flashStatus(ERROR_TEXT[permission.error]);
        wantedRef.current = false;
        setVoiceState("idle");
        return;
      }
      if (!wantedRef.current) {
        setVoiceState("idle");
        setStatus("");
        return;
      }
      if (whisperEnabled && !forceBrowser) {
        await startWhisperRecording(permission.stream);
        return;
      }
      // The browser recogniser does its own capture, so a stream opened by the
      // probe is of no use to it and has to be released rather than left live.
      permission.stream?.getTracks().forEach((track) => track.stop());
      startBrowserRecognition();
    } finally {
      startingRef.current = false;
    }
  }, [flashStatus, forceBrowser, refreshMicState, setVoiceState, startBrowserRecognition, startWhisperRecording, state, whisperEnabled]);

  /** One tap starts, the next one turns it off. Runs on pointerdown so iOS
   *  still sees a trusted gesture for getUserMedia. */
  const toggleListening = useCallback(() => {
    if (state === "processing") return;
    if (state === "listening" || state === "requesting" || wantedRef.current) {
      endListening();
      return;
    }
    void beginListening();
  }, [beginListening, endListening, state]);

  useImperativeHandle(
    ref,
    () => ({ stop: endListening }),
    [endListening],
  );

  // The phone layout has to survive a 360px screen next to a keyboard, so the
  // embedded size stays small — but never under the 44px touch-target floor,
  // since this is the app's headline control. The glow is scaled with the box
  // or a listening mic floods the whole field.
  const SIZES = {
    lg: { box: "h-16 w-16 sm:h-20 sm:w-20", icon: 28, stop: 26, spin: 24, glow: "shadow-[0_0_38px_-8px_rgba(244,63,94,0.9)]" },
    sm: { box: "h-11 w-11", icon: 20, stop: 18, spin: 22, glow: "shadow-[0_0_24px_-8px_rgba(244,63,94,0.8)]" },
    xs: { box: "h-11 w-11", icon: 20, stop: 16, spin: 22, glow: "shadow-[0_0_20px_-7px_rgba(244,63,94,0.75)]" },
  } as const;
  const dims = SIZES[size];
  // A blocked or unavailable mic should not look like a live button.
  const micBlocked = micState === "denied" || micState === "insecure" || micState === "unsupported";
  const engine = whisperEnabled && !forceBrowser ? "Whisper" : "Browser speech";

  const hint =
    state !== "idle"
      ? status || "Ready"
      : micState === "insecure"
        ? "Microphone needs localhost or HTTPS"
        : micState === "unsupported"
          ? "Voice input not supported here"
          : micState === "denied"
            ? "Microphone blocked — tap to see how to fix"
            : `Tap to speak · ${engine}`;

  const button = (
    <button
      type="button"
      onPointerDown={(event) => {
        if (state === "processing") return;
        // No pointer capture: the button no longer depends on the release
        // arriving, so dragging off it cannot strand the recogniser.
        event.preventDefault();
        toggleListening();
      }}
      onContextMenu={(event) => event.preventDefault()}
      disabled={state === "processing"}
      aria-label={state === "listening" ? "Stop listening" : "Start listening"}
      aria-pressed={state === "listening"}
      aria-busy={state === "processing"}
      title={micBlocked ? ERROR_TEXT[micState === "denied" ? "denied" : (micState as MicError)] : `Tap to speak · ${engine}`}
      className={`relative flex ${dims.box} touch-none select-none items-center justify-center rounded-full text-white transition ${
        embedded ? "absolute bottom-3 right-3 z-10" : ""
      } ${
        state === "listening"
          ? `mic-pulse bg-gradient-to-br from-rose-500 to-red-600 ${dims.glow}`
          : micBlocked
            ? "cursor-not-allowed bg-slate-300 text-slate-600 shadow-none"
            : "btn-primary"
      }`}
    >
      {/*
        Live input level. Rendered before the icon so it sits behind it, and
        omitted entirely unless there is signal, so a muted mic does not look
        like a broken one. This is the only feedback available while recording,
        because the Whisper path shows no text until the clip has been uploaded.
      */}
      {state === "listening" && (
        <>
          <span
            aria-hidden="true"
            className="mic-level pointer-events-none absolute inset-0 rounded-full ring-2 ring-white/60"
            style={{ transform: `scale(${1 + level * 0.22})`, opacity: 0.25 + level * 0.6 }}
          />
          <span
            aria-hidden="true"
            className="mic-level pointer-events-none absolute inset-1 rounded-full"
            style={{ backgroundColor: `rgba(255,255,255,${level * 0.26})` }}
          />
        </>
      )}
      {state === "processing" || state === "requesting" ? (
        <svg className="animate-spin" width={dims.spin} height={dims.spin} viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="9" stroke="rgba(255,255,255,0.3)" strokeWidth="3" />
          <path d="M21 12a9 9 0 0 0-9-9" stroke="white" strokeWidth="3" strokeLinecap="round" />
        </svg>
      ) : state === "listening" ? (
        <svg width={dims.stop} height={dims.stop} viewBox="0 0 24 24" fill="currentColor">
          <rect x="6" y="6" width="12" height="12" rx="2" />
        </svg>
      ) : micBlocked ? (
        <svg width={dims.icon} height={dims.icon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <rect x="9" y="2" width="6" height="12" rx="3" fill="currentColor" stroke="none" />
          <path d="M5 11a7 7 0 0 0 14 0M12 18v4M8 22h8" />
          <path d="M3 3l18 18" stroke="currentColor" strokeWidth="2.2" />
        </svg>
      ) : (
        <svg width={dims.icon} height={dims.icon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <rect x="9" y="2" width="6" height="12" rx="3" fill="currentColor" stroke="none" />
          <path d="M5 11a7 7 0 0 0 14 0M12 18v4M8 22h8" />
        </svg>
      )}
    </button>
  );

  // Embedded has no room for a caption under the button, and an idle caption
  // would sit on top of the user's own text. Show it only when there is
  // something to say: a live status, or a mic that will not work at all.
  if (embedded) {
    const showHint = state !== "idle" || micBlocked;
    return (
      <>
        {button}
        {showHint && (
          <span
            aria-live="polite"
            className={`pointer-events-none absolute bottom-16 right-2 z-10 max-w-[80%] rounded-lg bg-white/85 px-2 py-1 text-right text-xs font-medium backdrop-blur-sm sm:max-w-[60%] ${
              micBlocked && state === "idle" ? "text-amber-700" : "text-brand-600"
            }`}
          >
            {hint}
          </span>
        )}
      </>
    );
  }

  return (
    <div className="flex flex-col items-center gap-2">
      {button}
      <span
        aria-live="polite"
          className={`max-w-[15rem] text-center text-xs font-medium ${
          state === "idle" ? (micBlocked ? "text-amber-700" : "text-slate-500") : "text-brand-600"
        }`}
      >
        {hint}
      </span>
    </div>
  );
});

export default VoiceInput;
