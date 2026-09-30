"use client";

export type MicError = "denied" | "no-device" | "insecure" | "unsupported" | "busy" | "failed";
export type MicState = "granted" | "denied" | "prompt" | "unsupported" | "insecure" | "unknown";

export const MIC_MESSAGES: Record<MicError, string> = {
  denied: "Microphone blocked. Allow mic access for this site in your browser, then try again.",
  "no-device": "No microphone found on this device.",
  insecure: "Microphone needs a secure page. Open the site on localhost or over HTTPS, then try again.",
  unsupported: "This browser cannot record audio. Type your idea instead.",
  busy: "The microphone is busy in another app. Close it and try again.",
  failed: "Could not start the microphone. Tap to retry.",
};

export function isMicSupported(): boolean {
  return typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia);
}

/** True on localhost and HTTPS; the only contexts allowed to open a mic. */
export function isSecureForMic(): boolean {
  return typeof window !== "undefined" && window.isSecureContext;
}

/**
 * Current permission state, when the browser will tell us. Not all browsers
 * expose the "microphone" descriptor, hence the "unknown" fallback.
 */
/**
 * The browser's answer is cached for the life of the page. Without this, every
 * single press calls getUserMedia again just to re-ask a question the browser
 * has already answered, which re-opens the hardware each time and re-raises the
 * prompt on browsers that ask again after a dismissal.
 */
let cachedGrant: "granted" | "denied" | null = null;

/** Only meaningful for tests; a real page reload starts from browser truth. */
export function resetMicCache(): void {
  cachedGrant = null;
}

export async function getMicState(): Promise<MicState> {
  if (!isMicSupported()) return "unsupported";
  if (!isSecureForMic()) return "insecure";
  try {
    const status = await navigator.permissions?.query({ name: "microphone" as PermissionName });
    if (status) {
      const onChange = () => undefined;
      status.onchange = onChange;
      const state = status.state as MicState;
      // "prompt" is not a decision, so it must not be cached as one.
      if (state === "granted" || state === "denied") cachedGrant = state;
      return state;
    }
  } catch {
    // Firefox and Safari do not support querying the microphone.
  }
  // Those browsers still hand us an answer the first time we ask.
  return cachedGrant ?? "unknown";
}

export function classifyMicError(error: unknown): MicError {
  if (typeof window !== "undefined" && !window.isSecureContext) return "insecure";
  const name = error instanceof DOMException ? error.name : "";
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (name === "NotAllowedError" || name === "PermissionDeniedError" || name === "SecurityError" || message.includes("permission")) {
    return "denied";
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError" || message.includes("not found")) return "no-device";
  if (name === "NotReadableError" || name === "AbortError" || message.includes("busy")) return "busy";
  return "failed";
}

export type MicResult =
  | { ok: true; /** A live stream the caller should keep, when one was opened here. */
      stream: MediaStream | null }
  | { ok: false; error: MicError };

/**
 * Constraints shared by the permission probe and the real recorder.
 *
 * Echo cancellation and noise suppression are the two that matter for accuracy:
 * both are applied by the browser *before* the audio ever reaches the encoder,
 * so they improve what the transcription model hears rather than tidying up the
 * text afterwards. The probe has to ask for exactly the same set, because a
 * browser is free to grant a different configuration for a different request and
 * the two would then disagree about what the device can do.
 */
export const MIC_AUDIO_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  // Whisper is trained on single-channel audio; a second channel is discarded
  // rather than used, and asking for mono lets the browser downmix properly.
  channelCount: 1,
};

/**
 * Ask the browser for microphone access. Returns a live stream when this call
 * was the one that opened the hardware, so the caller records from that stream
 * instead of asking again. Re-opening a second time is not merely wasteful: on
 * several mobile browsers the first `getUserMedia` still holds the device for a
 * moment after its tracks are stopped, and the immediate second call fails with
 * `NotReadableError` even though permission was granted.
 */
export async function requestMicrophoneAccess(): Promise<MicResult> {
  if (typeof window === "undefined") return { ok: false, error: "unsupported" };
  if (!isSecureForMic()) return { ok: false, error: "insecure" };
  if (!isMicSupported()) return { ok: false, error: "unsupported" };
  if (cachedGrant === "granted") return { ok: true, stream: null };
  // Re-asking after a refusal is what makes browsers escalate to a hard block,
  // so a settled "no" is honoured instead of re-prompting.
  if (cachedGrant === "denied") return { ok: false, error: "denied" };
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: MIC_AUDIO_CONSTRAINTS });
    cachedGrant = "granted";
    return { ok: true, stream };
  } catch (error) {
    const kind = classifyMicError(error);
    // Only a refusal is final. "busy" and "no-device" are transient and must be
    // allowed to prompt again once the underlying problem is sorted out.
    if (kind === "denied") cachedGrant = "denied";
    return { ok: false, error: kind };
  }
}
