"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import AccountMenu from "@/components/AccountMenu";
import { BrandLockup } from "@/components/Brand";

// Primary destinations only. Settings and billing live in the account menu so
// the top bar stays short instead of growing a flat list of every page.
const LINKS = [
  { href: "/", label: "Home" },
  { href: "/import", label: "Import SQL" },
  { href: "/projects", label: "Databases" },
  { href: "/pricing", label: "Pricing" },
];

export default function SiteHeader() {
  const pathname = usePathname();
  // The menu records the route it was opened on rather than a bare boolean, so
  // any navigation — including browser back/forward, which never fires the
  // links' own onClick — implicitly closes it.
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn === pathname;
  const setOpen = (value: boolean) => setOpenOn(value ? pathname : null);

  const linkClass = (href: string) =>
    `rounded-lg px-3.5 py-2 text-sm font-medium transition ${
      pathname === href ? "bg-brand-50 text-brand-700" : "text-slate-700 hover:bg-slate-100 hover:text-slate-900"
    }`;

  return (
    <header className="safe-top sticky top-0 z-50 border-b border-slate-200 bg-white/85 backdrop-blur-xl">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-2 lg:gap-6">
          <BrandLockup />

          <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
            {LINKS.map((link) => (
              <Link key={link.href} href={link.href} className={linkClass(link.href)}>
                {link.label}
              </Link>
            ))}
          </nav>
        </div>

        <div className="flex items-center gap-2">
          <Link
            href="/#build"
            className="btn-primary hidden rounded-xl px-4 py-2 text-sm font-semibold text-white sm:inline-block"
          >
            Build a database
          </Link>
          <div className="hidden md:block">
            <AccountMenu />
          </div>

          <button
            type="button"
            aria-label="Toggle navigation"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
            className="flex h-11 w-11 items-center justify-center rounded-lg border border-slate-200 bg-white p-2 text-slate-800 md:hidden"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              {open ? <path d="M18 6L6 18M6 6l12 12" /> : <path d="M3 6h18M3 12h18M3 18h18" />}
            </svg>
          </button>
        </div>
      </div>

      {open && (
        <div className="border-t border-slate-200 bg-white px-4 pb-4 pt-2 md:hidden">
          <nav aria-label="Mobile" className="flex flex-col gap-1">
            {LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setOpen(false)}
                className={`min-h-11 rounded-lg px-3 py-3 text-sm font-medium ${
                  pathname === link.href ? "bg-brand-50 text-brand-700" : "text-slate-800 hover:bg-slate-100"
                }`}
              >
                {link.label}
              </Link>
            ))}
            <Link
              href="/#build"
              onClick={() => setOpen(false)}
              className="btn-primary mt-2 rounded-xl px-4 py-2.5 text-center text-sm font-semibold text-white"
            >
              Build a database
            </Link>
            <div className="mt-3 border-t border-slate-200 pt-3 md:hidden">
              <AccountMenu />
            </div>
          </nav>
        </div>
      )}
    </header>
  );
}
