"use client";

import type { DbSchema, Dialect, Plan } from "@/lib/types";

export async function apiFetch<T>(input: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData)) headers.set("Content-Type", "application/json");

  const response = await fetch(input, { ...init, headers, cache: "no-store" });
  const contentType = response.headers.get("content-type") ?? "";

  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    if (contentType.includes("application/json")) {
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      if (payload?.error) message = payload.error;
    }
    throw new Error(message);
  }

  if (contentType.includes("application/json")) return (await response.json()) as T;
  return (await response.text()) as unknown as T;
}

export function exportUrl(id: string, type: string, dialect: Dialect, extra: Record<string, string> = {}) {
  const params = new URLSearchParams({ type, dialect, ...extra });
  return `/api/projects/${id}/export?${params.toString()}`;
}

export async function fetchExport(
  id: string,
  type: string,
  dialect: Dialect,
  extra: Record<string, string> = {},
): Promise<string> {
  return apiFetch<string>(exportUrl(id, type, dialect, extra));
}

export interface SessionInfo {
  workspaceId: string;
  plan: Plan;
  authenticated: boolean;
  user: { id: string; email: string | null } | null;
  projectsThisMonth: number;
  limits: { maxTables: number; maxProjectsPerMonth: number; label: string };
  auth: { provider: string | null };
  ai: { brain: string; llm: boolean; whisper: boolean };
  upgradesEnabled: boolean;
}

export interface ProjectHistoryEntry {
  id: number;
  instruction: string;
  summary: string;
  createdAt: string;
  /** False for revisions recorded before snapshots existed, which cannot be restored. */
  hasSnapshot: boolean;
  tables: number | null;
  columns: number | null;
  isCurrent?: boolean;
}

export interface ProjectDetail {
  id: string;
  name: string;
  prompt: string;
  dialect: Dialect;
  schema: DbSchema;
  plan: Plan;
  limits: { maxTables: number; maxProjectsPerMonth: number; label: string };
  history: ProjectHistoryEntry[];
}

export function downloadBlob(content: BlobPart, fileName: string, mime: string) {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export async function svgToPngBlob(svg: string, scale = 2): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      const widthMatch = svg.match(/width="(\d+)"/);
      const heightMatch = svg.match(/height="(\d+)"/);
      const width = Number(widthMatch?.[1] ?? 1200);
      const height = Number(heightMatch?.[1] ?? 800);
      const image = new Image();
      const blobUrl = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));

      image.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = width * scale;
        canvas.height = height * scale;
        const context = canvas.getContext("2d");
        if (!context) {
          URL.revokeObjectURL(blobUrl);
          resolve(null);
          return;
        }
        context.fillStyle = "#020617";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(blobUrl);
        canvas.toBlob((blob) => resolve(blob), "image/png");
      };
      image.onerror = () => {
        URL.revokeObjectURL(blobUrl);
        resolve(null);
      };
      image.src = blobUrl;
    } catch {
      resolve(null);
    }
  });
}
