"use client";

import HCaptcha from "@hcaptcha/react-hcaptcha";
import Link from "next/link";
import { Suspense, useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { BrandLockup } from "@/components/Brand";
import { apiFetch } from "@/lib/client/api";
import { captchaConfigured, captchaSiteKey } from "@/lib/client/captcha";

type Mode = "signin" | "signup";

interface ProviderStatus {
  email: { enabled: boolean; requiresConfirmation: boolean };
  google: { enabled: boolean };
}

/** Only same-site absolute paths survive; "//evil.com" and absolute URLs do not. */
function safeNext(raw: string | null): string {
  if (!raw) return "/projects";
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return "/projects";
  return raw;
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  const initialError = params.get("error");

  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [notice, setNotice] = useState<string | null>(initialError);
  const [pending, setPending] = useState(false);
  // Set only after a signup that came back needing confirmation, so the resend
  // control appears exactly when it can still do something.
  const [awaitingConfirmation, setAwaitingConfirmation] = useState(false);
  const [resent, setResent] = useState(false);
  // Null until the server answers. Rendering before that would flash a Google
  // button that may not be configured, so the section stays hidden either way.
  const [providers, setProviders] = useState<ProviderStatus | null>(null);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const captcha = useRef<HCaptcha>(null);

  useEffect(() => {
    let active = true;
    void apiFetch<ProviderStatus>("/api/auth/providers")
      .then((next) => {
        if (active) setProviders(next);
      })
      .catch(() => {
        // Leave null. The email form still works unaided, and a failed probe
        // must not take the whole page down with it.
      });
    return () => {
      active = false;
    };
  }, []);

  const startGoogle = useCallback(async () => {
    setPending(true);
    setNotice(null);
    try {
      const { url } = await apiFetch<{ url: string }>(
        `/api/auth/google?next=${encodeURIComponent(next)}`,
        { method: "POST" },
      );
      window.location.href = url;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not start Google sign-in.");
      setPending(false);
    }
  }, [next]);

  /**
   * hCaptcha tokens are single-use and expire within a couple of minutes, so the
   * widget has to be cleared after every attempt and the stale token dropped
   * with it - otherwise the user types their password again, submits, and is
   * told they are not human.
   */
  const clearCaptcha = useCallback(() => {
    setCaptchaToken(null);
    captcha.current?.resetCaptcha();
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (captchaConfigured() && !captchaToken) {
      setNotice("Complete the verification challenge first, then try again.");
      return;
    }
    setPending(true);
    setNotice(null);
    setResent(false);
    try {
      const result = await apiFetch<{ ok: boolean; confirmed: boolean; error?: string; next?: string }>(
        "/api/auth/password",
        { method: "POST", body: JSON.stringify({ action: mode, email, password, next, captchaToken }) },
      );
      if (!result.confirmed) {
        setNotice(result.error ?? "Check your inbox to confirm your email.");
        setAwaitingConfirmation(true);
        setPending(false);
        return;
      }
      router.push(safeNext(result.next ?? next));
      router.refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Something went wrong.");
      setPending(false);
    } finally {
      clearCaptcha();
    }
  }

  const resendConfirmation = useCallback(async () => {
    if (!email.trim()) return;
    setResent(true);
    try {
      await apiFetch("/api/auth/resend", {
        method: "POST",
        body: JSON.stringify({ email: email.trim() }),
      });
      setNotice("Sent. Check your inbox — and your spam folder.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not send that email.");
    } finally {
      setResent(false);
    }
  }, [email]);

  const inputClass =
    "w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-[15px] text-slate-900 placeholder:text-slate-500 focus:border-brand-400/60 focus:outline-none focus:ring-2 focus:ring-brand-500/25";

  const googleEnabled = providers?.google.enabled === true;
  // GoTrue still sends a confirmation link when autoconfirm is off. Saying
  // "check your inbox" and then never sending anything is worse than saying
  // nothing, so flag it up front rather than after the user commits.
  const confirmationRequired = mode === "signup" && providers?.email.requiresConfirmation === true;

  return (
    <div className="glass fade-up w-full max-w-md rounded-3xl p-6 sm:p-8">
      <div className="mb-6 flex justify-center">
        <BrandLockup />
      </div>

      <h1 className="text-center text-2xl font-bold text-slate-900">
        {mode === "signin" ? "Welcome back" : "Create your account"}
      </h1>
      <p className="mt-2 text-center text-sm text-slate-500">
        Sign in to keep your databases on every device.
      </p>

      {notice && (
        <p className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-800">
          {notice}
        </p>
      )}

      {googleEnabled && (
        <button
          type="button"
          onClick={startGoogle}
          disabled={pending}
          className="mt-6 flex w-full items-center justify-center gap-3 rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 disabled:opacity-50"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.76h3.57c2.08-1.92 3.27-4.74 3.27-8.09Z" />
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.76c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z" />
            <path fill="#FBBC05" d="M5.84 14.11a6.6 6.6 0 0 1 0-4.22V7.05H2.18a11 11 0 0 0 0 9.9l3.66-2.84Z" />
            <path fill="#EA4335" d="M12 4.75c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 1.46 14.97.5 12 .5A11 11 0 0 0 2.18 7.05l3.66 2.84c.87-2.6 3.3-4.14 6.16-4.14Z" />
          </svg>
          Continue with Google
        </button>
      )}

      {googleEnabled && (
        <div className="my-6 flex items-center gap-3 text-xs uppercase tracking-[0.2em] text-slate-500">
          <span className="h-px flex-1 bg-slate-100" />
          or
          <span className="h-px flex-1 bg-slate-100" />
        </div>
      )}

      <form onSubmit={submit} className="flex flex-col gap-3">
        <div>
          <label htmlFor="email" className="mb-2 block text-sm font-semibold uppercase tracking-[0.1em] text-slate-600">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="next"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className={inputClass}
            placeholder="you@example.com"
          />
        </div>
        <div>
          <label htmlFor="password" className="mb-2 block text-sm font-semibold uppercase tracking-[0.1em] text-slate-600">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete={mode === "signin" ? "current-password" : "new-password"}
            enterKeyHint="go"
            required
            minLength={8}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className={inputClass}
            placeholder="At least 8 characters"
          />
        </div>

        {confirmationRequired && !awaitingConfirmation && (
          <p className="rounded-xl border border-sky-300 bg-sky-50 px-4 py-3 text-[13px] leading-relaxed text-sky-900">
            New accounts confirm by email before they can sign in. If nothing arrives, this site is not
            sending them yet —{" "}
            <Link href="/" className="font-semibold underline underline-offset-2">
              keep building without an account
            </Link>{" "}
            in the meantime.
          </p>
        )}

        {awaitingConfirmation && (
          <div className="rounded-xl border border-sky-300 bg-sky-50 px-4 py-3 text-[13px] leading-relaxed text-sky-900">
            <p>
              Almost there — confirm the address from the email we just sent, then come back and sign in.
            </p>
            <button
              type="button"
              onClick={() => void resendConfirmation()}
              disabled={resent}
              className="mt-2 min-h-11 font-semibold text-sky-800 underline underline-offset-2 disabled:opacity-50"
            >
              {resent ? "Sending…" : "Resend the confirmation email"}
            </button>
          </div>
        )}

        {captchaConfigured() && (
          <HCaptcha
            ref={captcha}
            sitekey={captchaSiteKey()}
            onVerify={setCaptchaToken}
            // A token past its life is rejected server-side as "invalid", which
            // reads as the user failing a check they actually passed.
            onExpire={() => setCaptchaToken(null)}
          />
        )}

        <button
          type="submit"
          disabled={pending}
          className="btn-primary mt-2 rounded-2xl px-6 py-3.5 text-base font-bold text-white disabled:opacity-50"
        >
          {pending ? "Working..." : mode === "signin" ? "Sign in" : "Create account"}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-slate-500">
        {mode === "signin" ? "No account yet?" : "Already have an account?"}{" "}
        <button
          type="button"
          onClick={() => {
            setMode(mode === "signin" ? "signup" : "signin");
            setNotice(null);
            setAwaitingConfirmation(false);
            setResent(false);
            // Switching between signing in and signing up is a fresh intent, and
            // a token minted for the previous one is spent anyway.
            clearCaptcha();
          }}
          className="inline-block py-2 font-semibold text-brand-700 hover:text-brand-600"
        >
          {mode === "signin" ? "Create one" : "Sign in"}
        </button>
      </p>

      <p className="mt-2 text-center text-sm text-slate-500">
        <Link href="/" className="inline-block py-2 hover:text-slate-700">
          Keep building without an account
        </Link>
      </p>
    </div>
  );
}

export default function LoginPage() {
  return (
    <main className="safe-top flex min-h-dvh items-start justify-center px-4 pb-[calc(2rem+env(safe-area-inset-bottom,0px))] pt-8 sm:items-center sm:py-10">
      <Suspense
        fallback={
          <div className="glass w-full max-w-md rounded-3xl p-8 text-center text-sm text-slate-500">
            Loading...
          </div>
        }
      >
        <LoginForm />
      </Suspense>
    </main>
  );
}
