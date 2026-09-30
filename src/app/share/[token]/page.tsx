import { notFound } from "next/navigation";
import type { Metadata } from "next";
import SiteFooter from "@/components/SiteFooter";
import SiteHeader from "@/components/SiteHeader";
import { resolveShareToken } from "@/lib/server/shareLinks";
import { DIALECT_META, LOGICAL_TYPES, type LogicalType } from "@/lib/types";

export const dynamic = "force-dynamic";

const TYPE_BADGE: Partial<Record<LogicalType, string>> = {
  id: "bg-amber-100 text-amber-800",
  fk: "bg-sky-100 text-sky-800",
  enum: "bg-fuchsia-100 text-fuchsia-800",
  money: "bg-emerald-100 text-emerald-800",
  datetime: "bg-violet-100 text-violet-800",
  date: "bg-violet-100 text-violet-800",
  bool: "bg-rose-100 text-rose-800",
};

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const { token } = await params;
  const lookup = await resolveShareToken(decodeURIComponent(token));
  if (lookup.status !== "ok") return { title: "Shared schema" };
  return {
    title: `${lookup.project.name} · shared schema`,
    description: lookup.project.description || "A read-only database schema.",
    // A share link is addressed by capability, so it must never be indexed.
    robots: { index: false, follow: false },
  };
}

export default async function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const lookup = await resolveShareToken(decodeURIComponent(token));

  if (lookup.status !== "ok") {
    if (lookup.status === "revoked") {
      return (
        <div className="min-h-dvh">
          <SiteHeader />
          <main className="mx-auto w-full max-w-3xl px-4 py-20 text-center">
            <h1 className="text-2xl font-semibold">This link was turned off</h1>
            <p className="mt-3 text-slate-600">
              The owner revoked this share link, so it no longer shows anything.
            </p>
          </main>
          <SiteFooter />
        </div>
      );
    }
    notFound();
  }

  const project = lookup.project;
  const schema = project.schema;
  const meta = DIALECT_META[project.dialect];
  const downloadBase = `${encodeURIComponent(token)}`;
  const links: { type: string; label: string; file: string }[] = [
    { type: "schema", label: "Schema SQL", file: "schema.sql" },
    { type: "data", label: "Sample data", file: "sample_data.sql" },
    { type: "readme", label: "README", file: "README.md" },
    { type: "diagram", label: "Diagram", file: "diagram.svg" },
  ];

  return (
    <div className="min-h-dvh">
      <SiteHeader />
      <main className="mx-auto w-full max-w-4xl px-4 py-10">
        <div className="rounded-3xl border border-slate-200 bg-white/80 p-6 shadow-sm">
          <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-slate-600">
            <span className="rounded-full bg-slate-900 px-2.5 py-1 text-white">Read-only</span>
            <span className="rounded-full bg-slate-100 px-2.5 py-1">
              {meta.emoji} {meta.label}
            </span>
            <span className="rounded-full bg-slate-100 px-2.5 py-1">
              {schema.tables.length} {schema.tables.length === 1 ? "table" : "tables"}
            </span>
          </div>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight">{project.name}</h1>
          {project.description ? (
            <p className="mt-2 text-slate-600">{project.description}</p>
          ) : null}
          <p className="mt-4 text-xs text-slate-500">
            Shared {new Date(project.sharedAt).toLocaleDateString()} · schema last edited{" "}
            {new Date(project.updatedAt).toLocaleDateString()}
          </p>

          <div className="mt-6 flex flex-wrap gap-2">
            {links.map((link) => (
              <a
                key={link.type}
                href={`/api/share/${downloadBase}?type=${link.type}`}
                className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-medium transition hover:bg-slate-50"
              >
                ↓ {link.label}
              </a>
            ))}
          </div>
        </div>

        <div className="mt-8 space-y-5">
          {schema.tables.map((table) => (
            <section key={table.name} className="rounded-3xl border border-slate-200 bg-white/70 p-5">
              <h2 className="font-mono text-lg font-semibold text-slate-900">{table.name}</h2>
              {table.description ? (
                <p className="mt-1 text-sm text-slate-600">{table.description}</p>
              ) : null}
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[34rem] border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                      <th className="py-2 pr-3 font-medium">Column</th>
                      <th className="py-2 pr-3 font-medium">Type</th>
                      <th className="py-2 pr-3 font-medium">Null</th>
                      <th className="py-2 pr-3 font-medium">Key</th>
                      <th className="py-2 font-medium">References</th>
                    </tr>
                  </thead>
                  <tbody className="font-mono text-[13px]">
                    {table.columns.map((column) => {
                      const badge = TYPE_BADGE[column.type as LogicalType];
                      const shownType =
                        column.length && (column.type === "string" || column.type === "slug")
                          ? `${column.type}(${column.length})`
                          : column.type;
                      return (
                        <tr key={column.name} className="border-b border-slate-100 last:border-0">
                          <td className="py-1.5 pr-3 text-slate-900">{column.name}</td>
                          <td className="py-1.5 pr-3">
                            <span
                              className={`rounded-md px-1.5 py-0.5 text-xs ${badge ?? "bg-slate-100 text-slate-700"}`}
                            >
                              {shownType}
                            </span>
                          </td>
                          <td className="py-1.5 pr-3 text-slate-600">
                            {column.nullable ? "yes" : "no"}
                          </td>
                          <td className="py-1.5 pr-3 text-slate-600">
                            {column.primaryKey ? "PK" : column.unique ? "UQ" : ""}
                          </td>
                          <td className="py-1.5 text-slate-500">
                            {column.references
                              ? `${column.references.table}.${column.references.column}`
                              : ""}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
        </div>

        <p className="mt-8 text-xs leading-relaxed text-slate-500">
          This is a read-only view of a shared schema. Types are shown in logical form and
          rendered to {meta.label} in the downloads above. {LOGICAL_TYPES.length} logical types
          are available.
        </p>
      </main>
      <SiteFooter />
    </div>
  );
}
