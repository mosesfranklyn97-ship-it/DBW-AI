"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import SiteFooter from "@/components/SiteFooter";
import SiteHeader from "@/components/SiteHeader";
import { apiFetch, type SessionInfo } from "@/lib/client/api";
import type { Plan } from "@/lib/types";

const PLAN_ORDER: Plan[] = ["free", "monthly", "yearly"];

const PLAN_DETAIL: Record<Plan, { name: string; price: string; cadence: string; blurb: string }> = {
  free: { name: "Free", price: "$0", cadence: "forever", blurb: "3 databases a month, up to 5 tables each." },
  monthly: { name: "Monthly Pro", price: "$12", cadence: "per month", blurb: "Unlimited databases, up to 50 tables." },
  yearly: { name: "Yearly Pro", price: "$115", cadence: "per year", blurb: "Everything in Monthly, billed yearly." },
};

export default function BillingPage() {
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [busy, setBusy] = useState<Plan | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    apiFetch<SessionInfo>("/api/session")
      .then((value) => {
        if (active) setSession(value);
      })
      .catch(() => {
        if (active) setError("Could not load your plan. Refresh to try again.");
      });
    return () => {
      active = false;
    };
  }, []);

  const changePlan = useCallback(
    async (plan: Plan) => {
      if (busy) return;
      setBusy(plan);
      setError(null);
      setMessage(null);
      try {
        await apiFetch<{ ok: boolean; plan: Plan }>("/api/session", {
          method: "POST",
          body: JSON.stringify({ plan }),
        });
        setMessage(`You are now on ${PLAN_DETAIL[plan].name}.`);
        setSession(await apiFetch<SessionInfo>("/api/session"));
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Could not change plan.");
      } finally {
        setBusy(null);
      }
    },
    [busy],
  );

  const used = session?.projectsThisMonth ?? 0;
  const allowance = session?.limits.maxProjectsPerMonth ?? 0;
  const percent = allowance > 0 ? Math.min(100, Math.round((used / allowance) * 100)) : 0;

  return (
    <div className="min-h-dvh">
      <SiteHeader />
      <main className="mx-auto max-w-4xl px-4 py-12 sm:px-6">
        <h1 className="text-3xl font-black text-slate-900 sm:text-4xl">Billing</h1>
        <p className="mt-2 text-sm text-slate-600">
          Your current plan, what you have used this month, and how to switch.
        </p>

        <section className="glass mt-8 rounded-2xl p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.15em] text-slate-500">Current plan</p>
              <p className="mt-1 text-2xl font-black text-slate-900">
                {session ? PLAN_DETAIL[session.plan].name : "Loading…"}
              </p>
              <p className="mt-1 text-sm text-slate-600">
                {session ? PLAN_DETAIL[session.plan].blurb : "Fetching your account."}
              </p>
            </div>
            <Link
              href="/pricing"
              className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              Compare plans
            </Link>
          </div>

          <div className="mt-6">
            <div className="flex items-baseline justify-between text-sm">
              <span className="font-semibold text-slate-900">Databases this month</span>
              <span className="text-slate-600">
                {used} / {allowance || "∞"}
              </span>
            </div>
            <div
              className="mt-2 h-2.5 overflow-hidden rounded-full bg-slate-200"
              role="progressbar"
              aria-valuenow={percent}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Monthly database usage"
            >
              <div
                className={`h-full rounded-full transition-all ${percent >= 100 ? "bg-rose-500" : "bg-brand-600"}`}
                style={{ width: `${Math.max(percent, used > 0 ? 4 : 0)}%` }}
              />
            </div>
            <p className="mt-2 text-xs text-slate-600">
              {session ? `Table limit per database: ${session.limits.maxTables}.` : null}
            </p>
          </div>
        </section>

        {!session?.upgradesEnabled && (
          <div className="mt-5 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
            <p className="font-bold">Self-serve upgrades are switched off</p>
            <p className="mt-1">
              This deployment does not process payments. An operator has to enable plan changes by setting{" "}
              <code className="rounded bg-amber-100 px-1 py-0.5 font-mono text-xs">ALLOW_PLAN_UPGRADES=true</code>,
              optionally limited to specific accounts with{" "}
              <code className="rounded bg-amber-100 px-1 py-0.5 font-mono text-xs">ALLOWED_PRICE_EMAILS</code>.
            </p>
          </div>
        )}

        <h2 className="mt-8 text-lg font-extrabold text-slate-900">Change plan</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          {PLAN_ORDER.map((plan) => {
            const detail = PLAN_DETAIL[plan];
            const active = session?.plan === plan;
            return (
              <div
                key={plan}
                className={`flex flex-col rounded-2xl border p-4 ${
                  active ? "border-brand-400 bg-brand-50" : "border-slate-200 bg-white"
                }`}
              >
                <p className="text-sm font-extrabold text-slate-900">{detail.name}</p>
                <p className="mt-1 text-2xl font-black text-slate-900">
                  {detail.price}
                  <span className="ml-1 text-xs font-medium text-slate-600">{detail.cadence}</span>
                </p>
                <button
                  type="button"
                  onClick={() => void changePlan(plan)}
                  disabled={active || busy !== null}
                  className={`mt-4 rounded-xl px-4 py-2 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-50 ${
                    active
                      ? "border border-brand-300 bg-white text-brand-700"
                      : "btn-primary text-white"
                  }`}
                >
                  {active ? "Current plan" : busy === plan ? "Switching…" : `Switch to ${detail.name}`}
                </button>
              </div>
            );
          })}
        </div>

        <p aria-live="polite" className="mt-4 text-sm font-semibold text-emerald-700">
          {message}
        </p>
        {error && (
          <p className="mt-2 rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</p>
        )}

        <section className="mt-8 rounded-2xl border border-slate-200 bg-slate-50 p-5">
          <h2 className="text-base font-extrabold text-slate-900">Invoices</h2>
          <p className="mt-1 text-sm text-slate-600">
            There are no invoices because no payment provider is connected. Plan changes here take effect immediately
            and are not charged. Connect Stripe or Paystack in <code className="font-mono text-xs">/api/session</code>{" "}
            before selling to real customers.
          </p>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
