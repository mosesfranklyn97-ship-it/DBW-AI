"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import ConfirmSheet from "@/components/ConfirmSheet";
import SiteFooter from "@/components/SiteFooter";
import SiteHeader from "@/components/SiteHeader";
import { apiFetch } from "@/lib/client/api";
import { DIALECT_META, type Dialect, type Plan } from "@/lib/types";

interface ProjectItem {
  id: string;
  name: string;
  prompt: string;
  dialect: Dialect;
  tableCount: number;
  engine: string;
  createdAt: string;
  updatedAt: string;
}

export default function ProjectsPage() {
  const [projects, setProjects] = useState<ProjectItem[] | null>(null);
  const [plan, setPlan] = useState<Plan>("free");
  const [usage, setUsage] = useState({ used: 0, limit: 3 });
  const [error, setError] = useState<string | null>(null);
  const [doomed, setDoomed] = useState<ProjectItem | null>(null);

  const load = () => {
    apiFetch<{ projects: ProjectItem[]; plan: Plan; usage: { used: number; limit: number } }>("/api/projects")
      .then((payload) => {
        setProjects(payload.projects);
        setPlan(payload.plan);
        setUsage(payload.usage);
      })
      .catch(() => setProjects([]));
  };

  useEffect(load, []);

  const remove = async (id: string) => {
    setError(null);
    try {
      await apiFetch(`/api/projects/${id}`, { method: "DELETE" });
    } catch (caught) {
      // Swallowing this just reloaded the list with the project still there,
      // so a failed delete looked like it had worked.
      setError(caught instanceof Error ? caught.message : "Could not delete that database");
      return;
    }
    load();
  };

  return (
    <div className="min-h-dvh">
      <SiteHeader />
      <main className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-3xl font-black text-slate-900">My databases</h1>
            <p className="mt-1 text-sm text-slate-500">
              {usage.used}/{usage.limit} builds this month on the{" "}
              <span className="font-semibold text-slate-800">{plan}</span> plan.
            </p>
          </div>
          <Link href="/#build" className="btn-primary rounded-xl px-5 py-3 text-sm font-bold text-white">
            + New database
          </Link>
        </div>

        {error && (
          <div className="mt-4 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-700">
            {error}
          </div>
        )}

        {projects === null && (
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }).map((_, index) => (
              <div key={index} className="shimmer h-40 rounded-2xl" />
            ))}
          </div>
        )}

        {projects?.length === 0 && (
          <div className="glass mt-8 rounded-3xl p-10 text-center">
            <span className="text-4xl">🗂️</span>
            <h2 className="mt-4 text-xl font-bold text-slate-900">No databases yet</h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-slate-500">
              Describe your idea once — “hotel with guests, rooms and bookings” — and DBW AI will design the full
              schema, seed data and diagram in seconds.
            </p>
            <Link href="/#build" className="btn-primary mt-6 inline-flex rounded-xl px-5 py-3 text-sm font-bold text-white">
              Build my first database
            </Link>
          </div>
        )}

        {projects && projects.length > 0 && (
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((project) => (
              <div key={project.id} className="glass fade-up flex flex-col rounded-2xl p-5">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="min-w-0 break-words text-base font-bold text-slate-900">{project.name}</h3>
                  <span className="shrink-0 rounded-md bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700">
                    {DIALECT_META[project.dialect]?.emoji} {DIALECT_META[project.dialect]?.label ?? project.dialect}
                  </span>
                </div>
                <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-slate-600">“{project.prompt}”</p>
                <div className="mt-3 flex gap-3 text-sm text-slate-500">
                  <span>🧱 {project.tableCount} tables</span>
                  <span>🕒 {new Date(project.updatedAt).toLocaleDateString()}</span>
                </div>
                <div className="mt-4 flex gap-2">
                  <Link
                    href={`/builder/${project.id}`}
                    className="btn-primary min-h-11 flex-1 rounded-lg px-3 py-2.5 text-center text-sm font-bold text-white"
                  >
                    Open builder
                  </Link>
                  <button
                    type="button"
                    onClick={() => setDoomed(project)}
                    aria-label={`Delete ${project.name}`}
                    className="min-h-11 rounded-lg border border-rose-300 bg-white px-4 py-2.5 text-sm font-semibold text-rose-700 transition active:bg-rose-50"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <ConfirmSheet
          request={
            doomed
              ? {
                  title: `Delete “${doomed.name}”?`,
                  body: `This permanently removes the database, its ${doomed.tableCount} table${
                    doomed.tableCount === 1 ? "" : "s"
                  } and all change history. This cannot be undone.`,
                  confirmLabel: "Delete database",
                }
              : null
          }
          onCancel={() => setDoomed(null)}
          onConfirm={() => {
            // Close first: the sheet disables its confirm button while the
            // request is in flight, so leaving it open on a failed delete
            // strands the user behind a dead button with the error hidden
            // behind the scrim.
            const target = doomed;
            setDoomed(null);
            if (target) void remove(target.id);
          }}
        />
      </main>
      <SiteFooter />
    </div>
  );
}
