"use client";

import HCaptcha from "@hcaptcha/react-hcaptcha";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/client/api";
import { captchaConfigured, captchaSiteKey } from "@/lib/client/captcha";

/**
 * Creates and revokes read-only share links.
 *
 * The raw token is only ever returned by the create call, so it is shown here
 * and then held in component state. Once the dialog closes it is gone: the
 * server keeps only a hash, which is what makes a database dump useless to
 * anyone who steals it. That means "copy it now" is not a nicety, it is the
 * only chance the owner gets.
 */

interface ShareSummary {
  id: string;
  createdAt: string;
  revokedAt: string | null;
  viewCount: number;
  lastViewedAt: string | null;
}

interface Props {
  projectId: string;
  onClose: () => void;
}

function when(iso: string | null): string {
  if (!iso) return "never";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "never" : date.toLocaleDateString();
}

export default function ShareDialog({ projectId, onClose }: Props) {
  const [shares, setShares] = useState<ShareSummary[] | null>(null);
  const [freshUrl, setFreshUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const captcha = useRef<HCaptcha>(null);

  // Refreshing the list is secondary: a link was created or revoked
  // successfully either way, so a failure here must not be reported as if the
  // write itself had failed.
  const refresh = useCallback(async () => {
    try {
      const result = await apiFetch<{ shares: ShareSummary[] }>(`/api/projects/${projectId}/share`);
      setShares(result.shares);
    } catch {
      // Leave the list as it was; the caller already reported its own outcome.
    }
  }, [projectId]);

  useEffect(() => {
    let cancelled = false;
    apiFetch<{ shares: ShareSummary[] }>(`/api/projects/${projectId}/share`)
      .then((result) => {
        if (!cancelled) setShares(result.shares);
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        setError(caught instanceof Error ? caught.message : "Share links could not be read.");
        setShares([]);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  /**
   * hCaptcha tokens are single-use, so a link that has just been created spends
   * the one that created it: clear the widget and the token together, or the
   * next create is rejected for reusing a solve that was already spent.
   */
  const clearCaptcha = useCallback(() => {
    setCaptchaToken(null);
    captcha.current?.resetCaptcha();
  }, []);

  const create = async () => {
    if (busy) return;
    if (captchaConfigured() && !captchaToken) {
      setError("Complete the verification challenge first, then create the link.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await apiFetch<{ share: { url: string } }>(`/api/projects/${projectId}/share`, {
        method: "POST",
        body: JSON.stringify({ captchaToken }),
      });
      setFreshUrl(result.share.url);
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "A link could not be created.");
    } finally {
      clearCaptcha();
      setBusy(false);
    }
  };

  const revokeAll = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await apiFetch<{ revoked: number }>(`/api/projects/${projectId}/share`, { method: "DELETE" });
      setFreshUrl(null);
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Links could not be turned off.");
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!freshUrl) return;
    try {
      await navigator.clipboard.writeText(freshUrl);
      setCopied(true);
    } catch {
      setError("Your browser blocked the clipboard. Select the link and copy it manually.");
    }
  };

  const live = shares?.filter((share) => !share.revokedAt) ?? [];

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Share this project"
    >
      <div className="glass max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-t-3xl p-5 sm:rounded-3xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Share read-only</h2>
            <p className="mt-1 text-sm text-slate-600">
              Anyone with the link can view the schema and download the SQL. They cannot edit it, and they
              never see your project history.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="min-h-11 min-w-11 rounded-xl border border-slate-300 bg-white text-lg leading-none text-slate-500"
          >
            ×
          </button>
        </div>

        {error && (
          <p className="mt-3 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-700">
            {error}
          </p>
        )}

        {freshUrl && (
          <div className="mt-4 rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-3">
            <p className="text-xs font-bold uppercase tracking-wide text-emerald-800">
              Copy it now — it is never shown again
            </p>
            <p className="mt-1.5 break-all font-mono text-xs text-emerald-900">{freshUrl}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void copy()}
                className="min-h-11 rounded-xl bg-emerald-600 px-3 py-2 text-sm font-bold text-white"
              >
                {copied ? "Copied" : "Copy link"}
              </button>
              <button
                type="button"
                onClick={() => setFreshUrl(null)}
                className="min-h-11 rounded-xl border border-emerald-600/40 bg-white px-3 py-2 text-sm font-semibold text-emerald-800"
              >
                Hide
              </button>
            </div>
          </div>
        )}

        {captchaConfigured() && (
          <div className="mt-4">
            <HCaptcha
              ref={captcha}
              sitekey={captchaSiteKey()}
              onVerify={setCaptchaToken}
              // A token past its life is rejected server-side as "invalid", which
              // reads as the user failing a check they actually passed.
              onExpire={() => setCaptchaToken(null)}
            />
          </div>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void create()}
            disabled={busy}
            className="btn-primary min-h-11 rounded-xl px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50"
          >
            {busy ? "Working…" : "Create link"}
          </button>
          {live.length > 0 && (
            <button
              type="button"
              onClick={() => void revokeAll()}
              disabled={busy}
              className="min-h-11 rounded-xl border border-rose-300 bg-white px-4 py-2.5 text-sm font-semibold text-rose-700 disabled:opacity-50"
            >
              Turn off {live.length} link{live.length === 1 ? "" : "s"}
            </button>
          )}
        </div>

        {shares === null ? (
          <p className="mt-4 text-sm text-slate-500">Loading links…</p>
        ) : shares.length === 0 ? (
          <p className="mt-4 text-sm text-slate-600">No links yet.</p>
        ) : (
          <ul className="mt-4 space-y-2">
            {shares.map((share) => (
              <li
                key={share.id}
                className={`rounded-xl border px-3 py-2.5 text-xs ${
                  share.revokedAt
                    ? "border-slate-200 bg-slate-50 text-slate-500"
                    : "border-slate-300 bg-white text-slate-700"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono">{share.id}</span>
                  <span className="font-bold uppercase tracking-wide">
                    {share.revokedAt ? "off" : "live"}
                  </span>
                </div>
                <p className="mt-1">
                  created {when(share.createdAt)} · {share.viewCount} view
                  {share.viewCount === 1 ? "" : "s"} · last {when(share.lastViewedAt)}
                </p>
              </li>
            ))}
          </ul>
        )}

        <p className="mt-4 text-xs leading-relaxed text-slate-500">
          Only a hash of each link is stored, so it cannot be recovered or re-sent. Turning links off
          makes every one of them stop working immediately.
        </p>
      </div>
    </div>
  );
}
