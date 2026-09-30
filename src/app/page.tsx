import Link from "next/link";
import PromptComposer from "@/components/PromptComposer";
import SiteFooter from "@/components/SiteFooter";
import SiteHeader from "@/components/SiteHeader";

const STEPS = [
  {
    step: "01",
    title: "Talk or type",
    body: "Tap the mic and describe it in English or Krio, or paste a paragraph. No technical words needed.",
    icon: "🎙️",
  },
  {
    step: "02",
    title: "AI brain designs it",
    body: "A senior-architect model turns your words into normalised tables, data types, primary keys and foreign keys.",
    icon: "🧠",
  },
  {
    step: "03",
    title: "Preview & download",
    body: "See the Excel-style sheet, tweak anything, then export database.sql, sample_data.sql and diagram.png.",
    icon: "⬇️",
  },
];

const FEATURES = [
  {
    title: "Voice to DB",
    body: "Record a voice note — Whisper transcribes it (with on-device speech as a fallback) and the schema builds itself.",
    icon: "🗣️",
  },
  {
    title: "Style selector",
    body: "MySQL, PostgreSQL, SQLite or Supabase. Same schema, correct syntax, enums, indexes and RLS policies.",
    icon: "🎛️",
  },
  {
    title: "Live Excel preview",
    body: "See every table like a spreadsheet with realistic seed rows before you download a single file.",
    icon: "📊",
  },
  {
    title: "One-click fix",
    body: '"Add payment table" or "add phone to patients" — the AI patches the same database instead of starting over.',
    icon: "🪄",
  },
  {
    title: "ER diagram",
    body: "Auto-laid-out entity relationship diagram with keys and links, downloadable as PNG and SVG.",
    icon: "🕸️",
  },
  {
    title: "Real sample data",
    body: "20 believable rows per table, foreign keys respelted, so you can test queries the moment you import.",
    icon: "🌱",
  },
];

const SQL_SAMPLE = `CREATE TABLE patients (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  patient_code VARCHAR(30) NOT NULL UNIQUE,
  full_name VARCHAR(120) NOT NULL,
  date_of_birth DATE NOT NULL,
  gender ENUM('male','female','other') NOT NULL,
  phone VARCHAR(25) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE appointments (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  patient_id INT UNSIGNED NOT NULL,
  doctor_id INT UNSIGNED NOT NULL,
  scheduled_at DATETIME NOT NULL,
  status ENUM('scheduled','completed','cancelled') NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT fk_appointments_patient_id
    FOREIGN KEY (patient_id) REFERENCES patients (id) ON DELETE CASCADE,
  CONSTRAINT fk_appointments_doctor_id
    FOREIGN KEY (doctor_id) REFERENCES doctors (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`;

export default function HomePage() {
  return (
    <div className="min-h-dvh">
      <SiteHeader />

      <main>
        {/* Hero */}
        <section className="relative overflow-hidden">
          <div className="grid-overlay pointer-events-none absolute inset-0" />
          <div className="relative mx-auto max-w-7xl px-4 pb-10 pt-12 sm:px-6 sm:pt-16">
            <div className="grid items-start gap-10 lg:grid-cols-[1.05fr_1fr]">
              <div className="fade-up">
                <span className="inline-flex items-center gap-2 rounded-full border border-brand-400/30 bg-brand-500/10 px-3.5 py-1.5 text-xs font-semibold text-brand-400">
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-mint-400 opacity-75" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-mint-400" />
                  </span>
                  ZeroBox AI Schema engine · live
                </span>

                <h1 className="mt-5 text-4xl font-black leading-[1.05] tracking-tight text-slate-900 sm:text-5xl lg:text-6xl">
                  Talk. And your <span className="text-gradient">database builds itself.</span>
                </h1>

                <p className="mt-5 max-w-xl text-base leading-relaxed text-slate-700 sm:text-lg">
                  Say <em className="text-brand-600">“build me a hospital system with patients, doctors, appointments”</em> —
                  DBW AI writes the full SQL: tables, data types, primary keys, foreign keys, seed rows and an ER
                  diagram. Download and open it in phpMyAdmin or MySQL Workbench exactly how you described it.
                </p>

                <dl className="mt-7 grid max-w-lg grid-cols-3 gap-2 sm:gap-3">
                  {[
                    { value: "8 sec", label: "idea → SQL" },
                    { value: "4", label: "SQL dialects" },
                    { value: "20 rows", label: "seed data / table" },
                  ].map((stat) => (
                    <div key={stat.label} className="glass-soft rounded-2xl px-2 py-2.5 text-center sm:px-3 sm:py-3">
                      <dt className="text-base font-extrabold text-slate-900 sm:text-xl">{stat.value}</dt>
                      <dd className="text-xs uppercase tracking-wide text-slate-500">{stat.label}</dd>
                    </div>
                  ))}
                </dl>
              </div>

              <PromptComposer />
            </div>
          </div>
        </section>

        {/* Steps */}
        <section className="mx-auto max-w-7xl px-4 py-14 sm:px-6">
          <h2 className="text-center text-2xl font-extrabold text-slate-900 sm:text-3xl">How it works</h2>
          <p className="mx-auto mt-2 max-w-xl text-center text-sm text-slate-500">
            Three moves from “I get one idea” to a database file you can import anywhere.
          </p>
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {STEPS.map((item) => (
              <div key={item.step} className="glass group rounded-2xl p-5 transition hover:-translate-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-2xl">{item.icon}</span>
                  <span className="font-mono text-xs font-bold text-brand-400">{item.step}</span>
                </div>
                <h3 className="mt-4 text-lg font-bold text-slate-900">{item.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-500">{item.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Output preview */}
        <section className="mx-auto max-w-7xl px-4 pb-14 sm:px-6">
          <div className="glass overflow-hidden rounded-3xl">
            <div className="grid gap-0 lg:grid-cols-2">
              <div className="border-b border-slate-200 p-6 sm:p-8 lg:border-b-0 lg:border-r">
                <h2 className="text-2xl font-extrabold text-slate-900">What you actually download</h2>
                <p className="mt-3 text-sm leading-relaxed text-slate-500">
                  Clean, commented, import-ready SQL — no placeholders, no “TODO”. Foreign keys and indexes included,
                  ordered so it never fails on import.
                </p>
                <ul className="mt-6 space-y-3">
                  {[
                    { file: "database.sql", detail: "CREATE TABLE + keys + indexes + enums" },
                    { file: "sample_data.sql", detail: "20 realistic rows per table, FK safe" },
                    { file: "diagram.png", detail: "ER diagram of your whole system" },
                    { file: "README.md", detail: "Step-by-step import guide" },
                  ].map((item) => (
                    <li key={item.file} className="flex items-start gap-3">
                      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-brand-500/15 text-xs text-brand-400">
                        ✓
                      </span>
                      <span>
                        <span className="font-mono text-sm font-semibold text-slate-900">{item.file}</span>
                        <span className="block text-xs text-slate-500">{item.detail}</span>
                      </span>
                    </li>
                  ))}
                </ul>
                <Link
                  href="/#build"
                  className="btn-primary mt-7 inline-flex rounded-xl px-5 py-3 text-sm font-bold text-white"
                >
                  Build mine now →
                </Link>
              </div>

              <div className="bg-white/80 p-4 sm:p-6">
                <div className="mb-3 flex items-center gap-2">
                  <span className="h-3 w-3 rounded-full bg-rose-500/80" />
                  <span className="h-3 w-3 rounded-full bg-amber-400/80" />
                  <span className="h-3 w-3 rounded-full bg-emerald-400/80" />
                  <span className="ml-2 font-mono text-xs text-slate-500">hospital_db_mysql.sql</span>
                </div>
                <pre className="scroll-thin max-h-[420px] overflow-auto rounded-xl border border-slate-700 bg-slate-900 p-4 font-mono text-[13px] leading-relaxed text-slate-200 sm:text-sm">
                  {SQL_SAMPLE}
                </pre>
              </div>
            </div>
          </div>
        </section>

        {/* Features */}
        <section className="mx-auto max-w-7xl px-4 pb-16 sm:px-6">
          <h2 className="text-2xl font-extrabold text-slate-900 sm:text-3xl">Everything in the box</h2>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((feature) => (
              <div key={feature.title} className="glass-soft rounded-2xl p-5 transition hover:border-brand-400/40">
                <span className="text-2xl">{feature.icon}</span>
                <h3 className="mt-3 text-base font-bold text-slate-900">{feature.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-slate-500">{feature.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Pricing teaser */}
        <section className="mx-auto max-w-7xl px-4 pb-4 sm:px-6">
          <div className="glass rounded-3xl p-6 text-center sm:p-10">
            <h2 className="text-2xl font-extrabold text-slate-900 sm:text-3xl">Start free. Upgrade when you ship.</h2>
            <p className="mx-auto mt-2 max-w-xl text-sm text-slate-500">
              3 databases a month free, forever. Go Pro for unlimited builds, 50 tables, voice input and ER diagrams —
              or grab the yearly plan and save 20%.
            </p>
            <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
              <Link href="/pricing" className="btn-primary rounded-xl px-6 py-3 text-sm font-bold text-white">
                View pricing
              </Link>
              <Link
                href="/#build"
                className="rounded-xl border border-slate-300 px-6 py-3 text-sm font-semibold text-slate-800 transition hover:bg-slate-100"
              >
                Try it free
              </Link>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
