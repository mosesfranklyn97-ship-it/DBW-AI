import Link from "next/link";
import SqlImporter from "@/components/SqlImporter";
import SiteFooter from "@/components/SiteFooter";
import SiteHeader from "@/components/SiteHeader";

export const metadata = {
  title: "Reverse engineer existing SQL · DBW AI",
  description:
    "Paste a CREATE TABLE script or drop a .sql dump. DBW AI reads the tables, keys, enums and foreign keys you already have and turns them into an editable schema, seed data and an ER diagram.",
};

export default function ImportPage() {
  return (
    <div className="min-h-dvh">
      <SiteHeader />

      <main>
        <section className="relative overflow-hidden">
          <div className="grid-overlay pointer-events-none absolute inset-0" />
          <div className="relative mx-auto max-w-5xl px-4 pb-12 pt-12 sm:px-6 sm:pt-16">
            <div className="text-center">
              <span className="inline-flex items-center gap-2 rounded-full border border-brand-400/30 bg-brand-500/10 px-3.5 py-1.5 text-xs font-semibold text-brand-400">
                Reverse engineer
              </span>
              <h1 className="mt-5 text-3xl font-black leading-[1.1] tracking-tight text-slate-900 sm:text-5xl">
                Already have SQL? <span className="text-gradient">Read it into a schema.</span>
              </h1>
              <p className="mx-auto mt-4 max-w-2xl text-base leading-relaxed text-slate-700">
                Paste a <code className="font-mono text-sm">CREATE TABLE</code> script or drop in a{" "}
                <code className="font-mono text-sm">.sql</code> dump. DBW AI pulls out your tables, data types,
                primary keys, enums and foreign keys, then lets you preview, query and export the whole thing.
              </p>
            </div>

            <div className="mt-8">
              <SqlImporter />
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-5xl px-4 pb-16 sm:px-6">
          <div className="glass-soft rounded-2xl p-5">
            <h2 className="text-base font-bold text-slate-900">What it understands</h2>
            <ul className="mt-3 grid gap-2 text-sm text-slate-600 sm:grid-cols-2">
              {[
                "MySQL, PostgreSQL, SQLite and Supabase dumps",
                "Backtick, double-quoted and bracket-quoted names",
                "Schema-qualified tables such as public.users",
                "ENUM types, including CREATE TYPE in Postgres",
                "Named, inline and unnamed primary keys",
                "Composite and multi-column foreign keys",
                "Comments, engine options and charset clauses",
                "Anything that is not a table is skipped, never fatal",
              ].map((item) => (
                <li key={item} className="flex items-start gap-2">
                  <span className="mt-0.5 text-brand-500">✓</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>

          <p className="mt-6 text-center text-sm text-slate-500">
            Rather start from words?{" "}
            <Link href="/#build" className="font-semibold text-brand-600 underline underline-offset-2">
              Describe your database instead →
            </Link>
          </p>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
