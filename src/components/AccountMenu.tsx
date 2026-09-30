"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch, type SessionInfo } from "@/lib/client/api";

const ACCOUNT_LINKS = [
  { href: "/projects", label: "My databases" },
  { href: "/settings", label: "Settings" },
  { href: "/billing", label: "Billing & plan" },
];

function initials(email: string | null): string {
  if (!email) return "?";
  const name = email.split("@")[0].replace(/[._-]+/g, " ").trim();
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

export default function AccountMenu() {
  const pathname = usePathname();
  const router = useRouter();
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [resolved, setResolved] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Record the route the menu was opened on, so navigating (including
  // browser back/forward, which fires no link onClick) closes it implicitly.
  const [openOn, setOpenOn] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const open = openOn === pathname;

  const setOpen = useCallback(
    (value: boolean) => {
      setOpenOn(value ? pathname : null);
    },
    [pathname],
  );

  useEffect(() => {
    let active = true;
    apiFetch<SessionInfo>("/api/session")
      .then((value) => {
        if (active) setSession(value);
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setResolved(true);
      });
    return () => {
      active = false;
    };
  }, []);

  // Dismiss on Escape or an outside click.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        return;
      }
      // role="menu" promises arrow-key navigation; without it keyboard and
      // screen-reader users land on a widget that advertises the interaction
      // but never delivers it.
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      const items = Array.from(
        containerRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [],
      );
      if (items.length === 0) return;
      event.preventDefault();
      const current = items.findIndex((item) => item === document.activeElement);
      const step = event.key === "ArrowDown" ? 1 : -1;
      const next = (current + step + items.length) % items.length;
      items[next].focus();
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open, setOpen]);

  const signOut = useCallback(async () => {
    if (signingOut) return;
    setSigningOut(true);
    setError(null);
    try {
      await apiFetch("/api/auth/signout", { method: "POST" });
      setOpen(false);
      setSession(null);
      router.push("/");
      router.refresh();
    } catch (caught) {
      // apiFetch throws on non-2xx; without this the rejection is unhandled
      // and the button looks inert while the user is still signed in.
      setError(caught instanceof Error ? caught.message : "Could not sign out");
      setSigningOut(false);
    }
  }, [router, setOpen, signingOut]);

  if (!resolved) return <div className="ml-1 h-11 w-11" aria-hidden="true" />;

  if (!session?.authenticated) {
    return (
      <Link
        href="/login"
        className="ml-1 inline-flex min-h-11 items-center rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 transition active:bg-slate-100"
      >
        Sign in
      </Link>
    );
  }

  return (
    <div className="relative ml-1" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
        className="flex min-h-11 items-center gap-2 rounded-xl border border-slate-300 bg-white py-1.5 pl-1.5 pr-2.5 text-sm font-semibold text-slate-800 transition active:bg-slate-100"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-600 text-xs font-bold text-white">
          {initials(session.user?.email ?? null)}
        </span>
        <span className="hidden max-w-[9rem] truncate lg:inline">{session.user?.email}</span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-slate-500">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Account"
          className="fade-up absolute right-0 z-50 mt-2 w-60 max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl"
        >
          <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
            <p className="truncate text-sm font-bold text-slate-900">{session.user?.email}</p>
            <p className="mt-0.5 text-xs text-slate-600">
              {session.limits.label} · {session.projectsThisMonth}/{session.limits.maxProjectsPerMonth} this month
            </p>
          </div>

          <div className="p-1.5">
            {ACCOUNT_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                role="menuitem"
                onClick={() => setOpen(false)}
                className={`block min-h-11 rounded-xl px-3 py-3 text-sm font-medium transition ${
                  pathname === link.href
                    ? "bg-brand-50 text-brand-700"
                    : "text-slate-700 hover:bg-slate-100"
                }`}
              >
                {link.label}
              </Link>
            ))}
          </div>

          <div className="border-t border-slate-200 p-1.5">
            <button
              type="button"
              role="menuitem"
              onClick={() => void signOut()}
              disabled={signingOut}
              className="w-full min-h-11 rounded-xl px-3 py-3 text-left text-sm font-semibold text-rose-600 transition hover:bg-rose-50 disabled:opacity-60"
            >
              {signingOut ? "Signing out…" : "Sign out"}
            </button>
            {error && (
              <p role="alert" className="px-3 pb-2 text-sm font-medium text-rose-700">
                {error}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
