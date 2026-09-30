"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import SiteFooter from "@/components/SiteFooter";
import SiteHeader from "@/components/SiteHeader";
import { apiFetch, type SessionInfo } from "@/lib/client/api";
import type { Plan } from "@/lib/types";

const PLANS: {
  key: Plan;
  name: string;
  price: string;
  cadence: string;
  tagline: string;
  highlight?: string;
  features: string[];
}[] = [
  {
    key: "free",
    name: "Free",
    price: "$0",
    cadence: "forever",
    tagline: "Perfect for testing an idea or a school project.",
    features: [
      "3 databases per month",
      "Up to 5 tables each",
      "MySQL / Postgres / SQLite / Supabase export",
      "database.sql + sample_data.sql download",
      "Excel-style live preview",
    ],
  },
  {
    key: "monthly",
    name: "Monthly Pro",
    price: "$12",
    cadence: "per month",
    tagline: "For freelancers shipping client systems every week.",
    highlight: "Most popular",
    features: [
      "Unlimited databases",
      "Up to 50 tables per database",
      "ER diagram PNG + SVG export",
      "Voice input (Whisper) & one-click fixes",
      "Full database.zip bundle with README",
      "Change history on every schema",
    ],
  },
  {
    key: "yearly",
    name: "Yearly Pro",
    price: "$115",
    cadence: "per year · save 20%",
    tagline: "Everything in Monthly, plus team + API superpowers.",
    highlight: "Best value",
    features: [
      "Everything in Monthly Pro",
      "API access for your own apps",
      "Team sharing & project handover",
      "Priority schema generation queue",
      "2 months free vs monthly billing",
    ],
  },
];

export default function PricingPage() {
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [busy, setBusy] = useState<Plan | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<SessionInfo>("/api/session").then(setSession).catch(() => undefined);
  }, []);

  const choose = async (plan: Plan) => {
    setBusy(plan);
    setMessage(null);
    try {
      await apiFetch("/api/session", { method: "POST", body: JSON.stringify({ plan }) });
      const refreshed = await apiFetch<SessionInfo>("/api/session");
      setSession(refreshed);
      setMessage(
        plan === "free"
          ? "Switched back to the Free plan."
          : `🎉 ${plan === "monthly" ? "Monthly" : "Yearly"} Pro activated on this workspace — 50 tables unlocked.`,
      );
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "Could not change plan, try again.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="min-h-dvh">
      <SiteHeader />
      <main className="mx-auto max-w-7xl px-4 py-12 sm:px-6">
        <div className="text-center">
          <span className="inline-flex rounded-full border border-brand-400/30 bg-brand-500/10 px-3.5 py-1.5 text-xs font-semibold text-brand-400">
            Simple pricing · cancel anytime
          </span>
          <h1 className="mt-4 text-4xl font-black text-slate-900 sm:text-5xl">
            Pay for <span className="text-gradient">shipping</span>, not for trying.
          </h1>
          <p className="mx-auto mt-3 max-w-2xl text-sm text-slate-500 sm:text-base">
            Start free with 3 databases a month. When the work gets serious, unlock 50-table schemas, voice input,
            ER diagrams and API access.
          </p>
          {session && (
            <p className="mt-3 text-xs text-slate-500">
              Current plan on this device: <span className="font-semibold text-slate-800">{session.limits.label}</span>{" "}
              · {session.projectsThisMonth}/{session.limits.maxProjectsPerMonth} builds used this month
            </p>
          )}
        </div>

        <div className="mt-10 grid gap-5 lg:grid-cols-3">
          {PLANS.map((plan) => {
            const active = session?.plan === plan.key;
            const featured = plan.key === "monthly";
            return (
              <div
                key={plan.key}
                className={`relative flex flex-col rounded-3xl p-6 ${
                  featured ? "glass ring-2 ring-brand-400/50" : "glass-soft"
                }`}
              >
                {plan.highlight && (
                  <span className="absolute -top-3 left-6 rounded-full bg-gradient-to-r from-brand-500 to-aqua-400 px-3 py-1.5 text-xs font-bold uppercase tracking-wide text-white">
                    {plan.highlight}
                  </span>
                )}
                <h2 className="text-lg font-extrabold text-slate-900">{plan.name}</h2>
                <p className="mt-1 text-xs text-slate-500">{plan.tagline}</p>
                <div className="mt-5 flex items-end gap-2">
                  <span className="text-4xl font-black text-slate-900">{plan.price}</span>
                  <span className="pb-1.5 text-xs text-slate-500">{plan.cadence}</span>
                </div>
                <ul className="mt-5 flex-1 space-y-2.5">
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-2 text-sm text-slate-700">
                      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-brand-500/15 text-xs font-bold text-brand-600">
                        ✓
                      </span>
                      {feature}
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  onClick={() => void choose(plan.key)}
                  disabled={busy !== null || active || (plan.key !== "free" && session?.upgradesEnabled === false)}
                  className={`mt-6 rounded-xl px-5 py-3 text-sm font-bold transition ${
                    active
                      ? "cursor-default border border-emerald-500/40 bg-emerald-500/10 text-emerald-700"
                      : featured
                        ? "btn-primary text-white"
                        : "border border-slate-300 text-slate-900 hover:bg-slate-100"
                  }`}
                >
                  {active ? "✓ Current plan" : busy === plan.key ? "Activating…" : plan.key === "free" ? "Use Free" : `Get ${plan.name}`}
                </button>
              </div>
            );
          })}
        </div>

        {session?.upgradesEnabled === false && (
          <p className="mx-auto mt-6 max-w-xl rounded-xl border border-slate-200 bg-white/[0.03] px-4 py-3 text-center text-xs text-slate-500">
            Self-serve upgrades are switched off on this deployment. You are on the Free plan — keep building, or ask
            the operator to enable <span className="font-mono">ALLOW_PLAN_UPGRADES</span>.
          </p>
        )}

        {message && (
          <div className="mx-auto mt-6 max-w-xl rounded-xl border border-brand-400/30 bg-brand-500/10 px-4 py-3 text-center text-sm text-slate-900">
            {message}{" "}
            <Link href="/#build" className="font-semibold underline underline-offset-2">
              Build something →
            </Link>
          </div>
        )}

        <div className="glass mt-12 rounded-3xl p-6 sm:p-8">
          <h2 className="text-xl font-extrabold text-slate-900">Questions people ask</h2>
          <div className="mt-5 grid gap-5 md:grid-cols-2">
            {[
              {
                q: "Will the SQL really open in phpMyAdmin?",
                a: "Yes. Files are plain, commented SQL with tables created in dependency order, so imports never fail on foreign keys.",
              },
              {
                q: "Can I change the database after generating?",
                a: "Type or say “add payment table” and the AI patches the same schema — your existing tables and data stay untouched.",
              },
              {
                q: "Do you support Krio or pidgin voice notes?",
                a: "Record your voice note and Whisper transcribes it to English before the architect model designs the schema.",
              },
              {
                q: "What happens to my databases?",
                a: "Every build is saved to your workspace so you can reopen, refine and re-export in another dialect any time.",
              },
            ].map((item) => (
              <div key={item.q}>
                <h3 className="text-sm font-bold text-slate-900">{item.q}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-slate-500">{item.a}</p>
              </div>
            ))}
          </div>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
