import { transcribeAudio, voiceProviderAvailable } from "@/lib/ai/provider";
import { enforceRateLimit, hourlyLimit, rateLimitResponse } from "@/lib/server/rateLimit";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Whisper bills per second and buffers the whole upload in memory, so an
// unbounded body is both a cost and an availability problem.
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

export async function POST(request: Request) {
  if (!voiceProviderAvailable()) {
    return Response.json(
      {
        error: "Whisper is not configured on this server. Using on-device speech recognition instead.",
        code: "NO_WHISPER",
      },
      { status: 503 },
    );
  }

  // After the availability check, because a 503 costs nothing and should not
  // burn a caller's quota. Before formData(), because buffering the upload is
  // itself the expensive part.
  const verdict = await enforceRateLimit(
    request,
    "transcribe",
    hourlyLimit("RATE_LIMIT_TRANSCRIBE_PER_HOUR", 40),
  );
  if (!verdict.allowed) return rateLimitResponse(verdict);

  const form = await request.formData().catch(() => null);
  const file = form?.get("audio");
  if (!(file instanceof Blob)) {
    return Response.json({ error: "No audio received" }, { status: 400 });
  }
  if (file.size > MAX_AUDIO_BYTES) {
    return Response.json(
      { error: "That recording is too long. Keep voice notes under 25 MB." },
      { status: 413 },
    );
  }
  // Silently empty uploads are the most common failure on this route and OpenAI
  // answers them with a 400 that says nothing useful, so they are caught here.
  if (file.size === 0) {
    return Response.json({ error: "That recording was empty. Tap and hold while you speak." }, { status: 400 });
  }

  // The browser picks the container (webm/opus on Chromium, mp4/aac on Safari),
  // and the extension has to match or the model is fed the wrong demuxer. It
  // comes from the client, so it is re-derived here rather than trusted.
  const type = file.type.toLowerCase();
  const extension = type.includes("mp4")
    ? "m4a"
    : type.includes("aac")
      ? "aac"
      : type.includes("wav")
        ? "wav"
        : type.includes("ogg")
          ? "ogg"
          : type.includes("mpeg") || type.includes("mp3")
            ? "mp3"
            : "webm";

  const text = await transcribeAudio(file, `voice-note.${extension}`);
  if (!text) {
    return Response.json(
      { error: "Could not transcribe that audio. Try again, or type your idea instead." },
      { status: 502 },
    );
  }
  return Response.json({ text });
}
