"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";
import DialectPicker from "@/components/DialectPicker";
import { apiFetch } from "@/lib/client/api";
import type { DbSchema, Dialect } from "@/lib/types";

const SAMPLE = `-- MySQL, PostgreSQL or SQLite
CREATE TABLE doctors (
  id SERIAL PRIMARY KEY,
  full_name VARCHAR(120) NOT NULL,
  speciality VARCHAR(80) NOT NULL,
  email VARCHAR(160) UNIQUE
);

CREATE TABLE patients (
  id SERIAL PRIMARY KEY,
  patient_code VARCHAR(30) NOT NULL UNIQUE,
  full_name VARCHAR(120) NOT NULL,
  gender ENUM('male','female','other') NOT NULL DEFAULT 'other',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE appointments (
  id SERIAL PRIMARY KEY,
  patient_id INTEGER NOT NULL,
  doctor_id INTEGER NOT NULL,
  scheduled_at TIMESTAMP NOT NULL,
  status ENUM('scheduled','completed','cancelled') NOT NULL DEFAULT 'scheduled',
  CONSTRAINT fk_appt_patient FOREIGN KEY (patient_id)
    REFERENCES patients (id) ON DELETE CASCADE,
  CONSTRAINT fk_appt_doctor FOREIGN KEY (doctor_id)
    REFERENCES doctors (id) ON DELETE RESTRICT
);`;

interface ImportWarning {
  kind: string;
  message: string;
}

const WARNING_TONE: Record<string, string> = {
  assumed: "border-amber-500/30 bg-amber-500/10 text-amber-800",
  fixed: "border-amber-500/30 bg-amber-500/10 text-amber-800",
  "skipped-clause": "border-slate-300 bg-slate-100 text-slate-600",
  "skipped-statement": "border-slate-300 bg-slate-100 text-slate-600",
};

export default function SqlImporter() {
  const router = useRouter();
  const [sql, setSql] = useState("");
  const [dialect, setDialect] = useState<Dialect | "auto">("auto");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<ImportWarning[]>([]);
  const [dragging, setDragging] = useState(false);
  const inFlight = useRef(false);
  const fileInput = useRef<HTMLInputElement | null>(null);

  const readFile = useCallback(async (file: File) => {
    if (file.size > 1_500_000) {
      setError("That file is larger than 1.5 MB. Try splitting the script.");
      return;
    }
    try {
      setSql(await file.text());
      setError(null);
      if (!name) setName(file.name.replace(/\.sql$/i, ""));
    } catch {
      setError("That file could not be read.");
    }
  }, [name]);

  const runImport = useCallback(async () => {
    if (inFlight.current) return;
    if (sql.trim().length < 8) {
      setError("Paste a CREATE TABLE script or upload a .sql file first.");
      return;
    }
    inFlight.current = true;
    setLoading(true);
    setError(null);
    setWarnings([]);
    try {
      const result = await apiFetch<{ id: string; schema: DbSchema; warnings: ImportWarning[] }>("/api/import", {
        method: "POST",
        body: JSON.stringify({ sql, dialect: dialect === "auto" ? undefined : dialect, name }),
      });
      setWarnings(result.warnings ?? []);
      router.push(`/builder/${result.id}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong");
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, [sql, dialect, name, router]);

  return (
    <div className="glass fade-up rounded-3xl p-4 shadow-[0_30px_90px_-40px_rgba(56,89,255,0.8)] sm:p-6">
      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          const file = event.dataTransfer.files[0];
          if (file) void readFile(file);
        }}
        className={`rounded-2xl border-2 border-dashed p-3 transition ${
          dragging ? "border-brand-400 bg-brand-50" : "border-slate-300"
        }`}
      >
        <label htmlFor="sql" className="mb-2 block text-sm font-semibold uppercase tracking-[0.1em] text-slate-600">
          Your SQL script
        </label>
        <textarea
          id="sql"
          value={sql}
          onChange={(event) => setSql(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") void runImport();
          }}
          rows={12}
          spellCheck={false}
          placeholder={SAMPLE}
          className="scroll-thin w-full resize-y rounded-xl border border-slate-300 bg-slate-900 p-4 font-mono text-[13px] leading-relaxed text-slate-200 placeholder:text-slate-500 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/25"
        />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            ref={fileInput}
            type="file"
            accept=".sql,text/plain,application/sql"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void readFile(file);
              event.target.value = "";
            }}
          />
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            className="min-h-11 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-brand-400 hover:text-brand-700"
          >
            📄 Upload a .sql file
          </button>
          <button
            type="button"
            onClick={() => setSql(SAMPLE)}
            className="min-h-11 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-brand-400 hover:text-brand-700"
          >
            Use the example
          </button>
          <span className="text-xs text-slate-500">or drop the file anywhere in this box</span>
        </div>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <p className="mb-2 text-sm font-semibold uppercase tracking-[0.1em] text-slate-600">Dialect</p>
          <DialectPicker value={dialect} onChange={setDialect} allowAuto />
        </div>
        <div>
          <label htmlFor="import-name" className="mb-2 block text-sm font-semibold uppercase tracking-[0.1em] text-slate-600">
            Project name <span className="font-normal normal-case text-slate-500">(optional)</span>
          </label>
          <input
            id="import-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Taken from the file name"
            className="min-h-11 w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-base text-slate-900 placeholder:text-slate-500 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/25"
          />
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <button
          type="button"
          onClick={runImport}
          disabled={loading}
          className="btn-primary flex w-full items-center justify-center gap-2 rounded-2xl px-6 py-3.5 text-base font-bold text-white sm:w-auto"
        >
          {loading ? (
            <>
              <svg className="animate-spin" width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
                <circle cx="12" cy="12" r="9" stroke="rgba(255,255,255,0.35)" strokeWidth="3" />
                <path d="M21 12a9 9 0 0 0-9-9" stroke="white" strokeWidth="3" strokeLinecap="round" />
              </svg>
              Reading the script…
            </>
          ) : (
            <>🔍 Reverse engineer this schema</>
          )}
        </button>
        <p className="text-xs text-slate-500">Runs in your browser-safe server · nothing is stored as a file</p>
      </div>

      {error && (
        <div className="mt-3 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      )}

      {warnings.length > 0 && (
        <div className="mt-3 space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.15em] text-slate-500">
            What the parser had to assume
          </p>
          {warnings.map((warning) => (
            <p
              key={`${warning.kind}:${warning.message}`}
              className={`rounded-lg border px-3 py-2 text-xs ${WARNING_TONE[warning.kind] ?? WARNING_TONE["skipped-clause"]}`}
            >
              {warning.message}
            </p>
          ))}
        </div>
      )}

      <p className="mt-5 border-t border-slate-200 pt-4 text-xs text-slate-500">
        Only <code className="font-mono">CREATE TABLE</code> is read. Inserts, updates, views, triggers and other
        statements are ignored.{" "}
        <Link href="/projects" className="font-semibold text-brand-600 underline underline-offset-2">
          See your projects →
        </Link>
      </p>
    </div>
  );
}
