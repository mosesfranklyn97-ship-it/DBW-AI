"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import DialectPicker from "@/components/DialectPicker";
import VoiceInput, { type VoiceInputHandle } from "@/components/VoiceInput";
import DiagramPreview from "@/components/builder/DiagramPreview";
import RefinePreviewDialog from "@/components/builder/RefinePreviewDialog";
import ShareDialog from "@/components/builder/ShareDialog";
import SheetPreview, { type SheetData } from "@/components/builder/SheetPreview";
import SqlPlayground from "@/components/builder/SqlPlayground";
import SqlPreview from "@/components/builder/SqlPreview";
import TableCards from "@/components/builder/TableCards";
import VersionHistory from "@/components/builder/VersionHistory";
import { apiFetch, downloadBlob, exportUrl, svgToPngBlob, type ProjectDetail, type SessionInfo } from "@/lib/client/api";
import { useKeyboardOpen, joinTranscript } from "@/lib/client/media";
import {
  getPreferenceServerSnapshot,
  getPreferenceSnapshot,
  subscribeToPreferences,
} from "@/lib/client/preferences";
import { DIALECT_META, type DbSchema, type Dialect } from "@/lib/types";

const QUICK_FIXES = [
  "Add a payments table",
  "Add audit_logs table",
  "Add phone to users",
  "Add a notifications table",
  "Link orders to users",
];

type Tab = "tables" | "sheet" | "sql" | "query" | "diagram" | "history";

const TABS: { key: Tab; label: string; icon: string }[] = [
  { key: "tables", label: "Builder", icon: "🧱" },
  { key: "sheet", label: "Sheet preview", icon: "📊" },
  { key: "sql", label: "SQL", icon: "🧾" },
  { key: "query", label: "Query", icon: "⚡" },
  { key: "diagram", label: "ER diagram", icon: "🕸️" },
  { key: "history", label: "History", icon: "🕘" },
];

export default function BuilderClient({ projectId }: { projectId: string }) {
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [schema, setSchema] = useState<DbSchema | null>(null);
  const [dialect, setDialect] = useState<Dialect>("mysql");
  const [tab, setTab] = useState<Tab>("tables");
  const [version, setVersion] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [instruction, setInstruction] = useState("");
  // The instruction waiting for review in the diff dialog. Nothing is written
  // to the project until it is applied from there.
  const [pendingRefine, setPendingRefine] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const [rowCount, setRowCount] = useState(20);
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [history, setHistory] = useState<ProjectDetail["history"]>([]);
  const [zipping, setZipping] = useState(false);
  // The bar is `fixed bottom-0`, so an open keyboard slides it up over the
  // caret. Nothing scrolls it out of the way, so it is hidden instead.
  const keyboardOpen = useKeyboardOpen();

  const [schemaSql, setSchemaSql] = useState("");
  const [dataSql, setDataSql] = useState("");
  const [sheet, setSheet] = useState<SheetData | null>(null);
  const [diagram, setDiagram] = useState("");
  const [loadedPreview, setLoadedPreview] = useState("");
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewNonce, setPreviewNonce] = useState(0);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Saves are serialised through a single queue: overlapping PATCHes sent the
  // whole schema, so whichever response landed last silently reverted the
  // newer edit both on screen and in the database.
  const queuedSave = useRef<{ schema: DbSchema; dialect: Dialect } | null>(null);
  const saveInFlight = useRef(false);
  // Read by the debounced editor so it always sends the dialect currently on
  // screen rather than the one captured when the timer was created.
  const dialectRef = useRef<Dialect>("mysql");
  // Both refine boxes stay mounted (one is hidden with `xl:block`/`xl:hidden`),
  // and a ref can only point at the last one to mount. Recording has to be
  // stopped on whichever one the user actually used, so both are tracked.
  const mobileVoiceRef = useRef<VoiceInputHandle>(null);
  const sidebarVoiceRef = useRef<VoiceInputHandle>(null);
  const stopAllVoice = useCallback(() => {
    mobileVoiceRef.current?.stop();
    sidebarVoiceRef.current?.stop();
  }, []);

  // Speech has to be appended to the refine box, not assigned over it. Both
  // boxes share this field, so the transcript is merged against whatever is
  // already there and the user can type a lead-in before dictating.
  const appendInstruction = useCallback((text: string) => {
    setInstruction((current) => joinTranscript(current, text));
  }, []);

  // Same resolution the hero composer uses, so a voice engine chosen in
  // Settings is honoured here too instead of being silently ignored.
  const storedPreferences = useSyncExternalStore(
    subscribeToPreferences,
    getPreferenceSnapshot,
    getPreferenceServerSnapshot,
  );
  const whisperEnabled =
    storedPreferences.voiceMode === "whisper" ||
    (storedPreferences.voiceMode === "auto" && Boolean(session?.ai.whisper));
  const forceBrowser = storedPreferences.voiceMode === "browser";

  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);

  const flash = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => {
      toastTimer.current = null;
      setToast(null);
    }, 3600);
  }, []);

  const applyDialect = useCallback((next: Dialect) => {
    dialectRef.current = next;
    setDialect(next);
  }, []);

  useEffect(() => {
    apiFetch<SessionInfo>("/api/session").then(setSession).catch(() => undefined);
  }, []);

  useEffect(() => {
    let cancelled = false;
    apiFetch<ProjectDetail>(`/api/projects/${projectId}`)
      .then((payload) => {
        if (cancelled) return;
        setDetail(payload);
        setSchema(payload.schema);
        applyDialect(payload.dialect);
        setHistory(payload.history);
      })
      .catch((caught: Error) => {
        if (!cancelled) setError(caught.message);
      });

    return () => {
      cancelled = true;
    };
  }, [projectId, applyDialect]);

  // refresh previews whenever the saved schema/dialect changes
  const previewKey = schema ? `${projectId}|${dialect}|${version}|${rowCount}|${previewNonce}` : "";
  const previewLoading = previewKey !== loadedPreview;
  // Nothing derived from the server may be downloaded until it has actually
  // been fetched successfully for the current schema.
  const exportsReady = !previewLoading && !previewError;

  useEffect(() => {
    if (!schema || !previewKey) return;
    let cancelled = false;

    Promise.all([
      apiFetch<string>(exportUrl(projectId, "schema", dialect)),
      apiFetch<string>(exportUrl(projectId, "data", dialect, { rows: String(rowCount) })),
      apiFetch<{ data: SheetData }>(exportUrl(projectId, "sheet", dialect, { rows: String(rowCount) })),
      apiFetch<string>(exportUrl(projectId, "diagram", dialect)),
    ])
      .then(([ddl, inserts, sheetPayload, svg]) => {
        if (cancelled) return;
        setSchemaSql(ddl);
        setDataSql(inserts);
        setSheet(sheetPayload.data);
        setDiagram(svg);
        setPreviewError(null);
        setLoadedPreview(previewKey);
      })
      .catch((caught: unknown) => {
        // Marking the preview loaded here would unblock the download buttons
        // while they still serve the previous project's SQL or an empty file.
        if (cancelled) return;
        setPreviewError(caught instanceof Error ? caught.message : "Could not build the previews");
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, dialect, version, rowCount, previewNonce, Boolean(schema)]);

  /**
   * Refetches the version list on its own. reload() also rewrites the schema,
   * which would fight the builder's optimistic editing, so a save that is
   * already on screen only needs the history half of that.
   */
  const refreshHistory = useCallback(async () => {
    try {
      const payload = await apiFetch<ProjectDetail>(`/api/projects/${projectId}`);
      setHistory(payload.history);
    } catch {
      // The save itself succeeded, so a stale version list is not worth
      // replacing the builder with an error over.
    }
  }, [projectId]);

  const persist = useCallback(
    async (nextSchema: DbSchema, nextDialect: Dialect) => {
      queuedSave.current = { schema: nextSchema, dialect: nextDialect };
      if (saveInFlight.current) return;

      saveInFlight.current = true;
      setSaving(true);
      try {
        while (queuedSave.current) {
          const job = queuedSave.current;
          queuedSave.current = null;
          const payload = await apiFetch<{ schema: DbSchema }>(`/api/projects/${projectId}`, {
            method: "PATCH",
            body: JSON.stringify({ schema: job.schema, dialect: job.dialect }),
          });
          // A newer edit landed while this request was in flight; its own save
          // is already queued, so applying this response would flicker the
          // builder back to the older schema.
          if (queuedSave.current) continue;
          setSchema(payload.schema);
          setError(null);
          setVersion((value) => value + 1);
        }
        // Every save writes a revision, so the list the History tab renders is
        // stale the moment a debounced save lands.
        void refreshHistory();
      } catch (caught) {
        queuedSave.current = null;
        setError(caught instanceof Error ? caught.message : "Could not save");
      } finally {
        saveInFlight.current = false;
        setSaving(false);
      }
    },
    [projectId, refreshHistory],
  );

  const handleSchemaChange = useCallback(
    (nextSchema: DbSchema) => {
      setSchema(nextSchema);
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        saveTimer.current = null;
        void persist(nextSchema, dialectRef.current);
      }, 900);
    },
    [persist],
  );

  const changeDialect = useCallback(
    (next: Dialect) => {
      applyDialect(next);
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        saveTimer.current = null;
      }
      if (schema) void persist(schema, next);
    },
    [schema, persist, applyDialect],
  );

  /**
   * A rollback and a refine both rewrite the schema from somewhere other than
   * the builder, so the previews and the version list both have to be refetched
   * rather than patched locally.
   */
  const reload = useCallback(async () => {
    try {
      const payload = await apiFetch<ProjectDetail>(`/api/projects/${projectId}`);
      setDetail(payload);
      setSchema(payload.schema);
      applyDialect(payload.dialect);
      setHistory(payload.history);
      setVersion((value) => value + 1);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not reload the project");
    }
  }, [projectId, applyDialect]);

  const handleRestored = useCallback(
    (nextSchema: DbSchema, message: string) => {
      setSchema(nextSchema);
      flash(message);
      void reload();
    },
    [flash, reload],
  );

  // Opens the review dialog. The network round trip and the write both live in
  // the dialog, so this only validates and hands the instruction over.
  const runRefine = useCallback(
    (text: string) => {
      const value = text.trim();
      if (!value || !schema) return;
      // Dictation must end before the dialog takes over, otherwise the mic
      // keeps appending to a box the user can no longer see.
      stopAllVoice();
      setError(null);
      setPendingRefine(value);
    },
    [schema, stopAllVoice],
  );

  const onRefineApplied = useCallback(
    (nextSchema: DbSchema, summary: string, engine: "ai" | "engine") => {
      setSchema(nextSchema);
      setPendingRefine(null);
      setInstruction("");
      // The revision is written server-side with a real id and a full snapshot,
      // so the list is refetched rather than guessed at locally.
      void reload();
      // Which engine actually did the work is stated plainly. A keyword match
      // dressed up as an LLM answer is the failure mode worth being loud about.
      flash(
        engine === "ai"
          ? `✅ ${summary}`
          : `✅ ${summary} · matched by the ZeroBox engine${
              session?.ai.llm ? "" : " (no AI key configured)"
            }`,
      );
    },
    [flash, reload, session?.ai.llm],
  );

  const fileBase = (schema?.name ?? "database").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  const schemaFileName = `${fileBase || "database"}_${dialect}.sql`;

  const downloadText = useCallback(
    (content: string, fileName: string, mime = "text/plain;charset=utf-8") => {
      downloadBlob(content, fileName, mime);
      flash(`⬇️ ${fileName} downloaded`);
    },
    [flash],
  );

  const downloadPng = useCallback(async () => {
    if (!exportsReady) return;
    const blob = await svgToPngBlob(diagram);
    if (!blob) {
      flash("PNG export failed — downloading SVG instead");
      downloadText(diagram, "diagram.svg", "image/svg+xml");
      return;
    }
    downloadBlob(blob, "diagram.png", "image/png");
    flash("⬇️ diagram.png downloaded");
  }, [diagram, downloadText, flash, exportsReady]);

  const downloadZip = useCallback(async () => {
    if (!schema || !exportsReady) return;
    setZipping(true);
    try {
      const { default: JSZip } = await import("jszip");
      const zip = new JSZip();
      const readme = await apiFetch<string>(exportUrl(projectId, "readme", dialect));
      zip.file(schemaFileName, schemaSql);
      zip.file("sample_data.sql", dataSql);
      zip.file("diagram.svg", diagram);
      zip.file("README.md", readme);
      zip.file("schema.json", JSON.stringify(schema, null, 2));
      const png = await svgToPngBlob(diagram);
      if (png) zip.file("diagram.png", png);
      const blob = await zip.generateAsync({ type: "blob" });
      downloadBlob(blob, `${fileBase || "database"}.zip`, "application/zip");
      flash("📦 database.zip downloaded — unzip and import");
    } catch {
      flash("Could not build the zip, try individual files");
    } finally {
      setZipping(false);
    }
  }, [schema, projectId, dialect, schemaFileName, schemaSql, dataSql, diagram, fileBase, flash, exportsReady]);

  if (error && !schema) {
    return (
      <div className="mx-auto max-w-lg px-4 py-24 text-center">
        <p className="text-lg font-bold text-rose-700">{error}</p>
        <Link href="/" className="btn-primary mt-6 inline-flex rounded-xl px-5 py-3 text-sm font-bold text-white">
          Start a new database
        </Link>
      </div>
    );
  }

  if (!schema || !detail) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6">
        <div className="shimmer h-10 w-64 rounded-xl" />
        <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="shimmer h-56 rounded-2xl" />
          ))}
        </div>
      </div>
    );
  }

  const relationCount = schema.tables.reduce(
    (total, table) => total + table.columns.filter((column) => column.references).length,
    0,
  );
  const columnCount = schema.tables.reduce((total, table) => total + table.columns.length, 0);
  const maxTables = detail.limits.maxTables;

  return (
    <div className="mx-auto max-w-[1600px] px-3 pb-28 pt-6 sm:px-6">
      {/* Title bar */}
      <div className="glass flex flex-col gap-4 rounded-2xl p-4 lg:flex-row lg:items-center">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <input
              value={schema.name}
              onChange={(event) => handleSchemaChange({ ...schema, name: event.target.value })}
              className="w-full min-w-0 max-w-md truncate bg-transparent text-xl font-extrabold text-slate-900 outline-none sm:text-2xl"
            />
            <span
              role="status"
              className={`shrink-0 rounded-full px-2 py-1 text-xs font-bold ${
                saving ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"
              }`}
            >
              {saving ? "saving…" : "saved"}
            </span>
          </div>
          <p className="mt-1 line-clamp-1 text-sm text-slate-600">“{detail.prompt}”</p>
          <div className="mt-2 flex flex-wrap gap-3 text-sm text-slate-600">
            <span>🧱 {schema.tables.length}/{maxTables} tables</span>
            <span>🔡 {columnCount} columns</span>
            <span>🔗 {relationCount} relationships</span>
            <span title={detail.schema.source === "ai" ? "This schema was written by a language model." : "This schema was assembled by the built-in keyword engine."}>
              🧠 {detail.schema.source === "ai" ? "LLM architect" : "ZeroBox engine"}
            </span>
            {/* The badge above describes where the schema was born. This one
                reports whether a model is actually reachable right now, which
                is what decides whether the next refine falls back to keywords. */}
            {!session?.ai.llm && (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
                keyword mode · no AI key
              </span>
            )}
          </div>
        </div>
        <div className="flex w-full flex-col gap-3 lg:w-[420px]">
          <button
            type="button"
            onClick={() => setSharing(true)}
            className="min-h-11 self-start rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            🔗 Share read-only
          </button>
          <div>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-[0.1em] text-slate-600">Export style</p>
            <DialectPicker value={dialect} onChange={(next) => changeDialect(next as Dialect)} compact />
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_320px]">
        <div>
          {/* Tabs */}
          <div className="scroll-thin scroll-x-touch mb-3 flex gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-slate-100 p-1">
            {TABS.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => setTab(item.key)}
                className={`min-h-11 shrink-0 whitespace-nowrap rounded-lg px-4 py-2.5 text-sm font-bold transition ${
                  tab === item.key ? "btn-primary text-white" : "text-slate-700 active:bg-white"
                }`}
              >
                <span className="mr-1.5">{item.icon}</span>
                {item.label}
              </button>
            ))}
          </div>

          {tab === "tables" && (
            <TableCards schema={schema} maxTables={maxTables} onChange={handleSchemaChange} />
          )}
          {tab === "sheet" && (
            <>
              <div className="mb-2 flex flex-wrap items-center gap-2 text-sm text-slate-600">
                <span className="font-medium">Rows per table:</span>
                {[5, 10, 20, 50].map((value) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={rowCount === value}
                    onClick={() => setRowCount(value)}
                    className={`min-h-11 min-w-12 rounded-lg px-3 text-sm font-bold transition ${
                      rowCount === value
                        ? "bg-brand-600 text-white"
                        : "bg-slate-100 text-slate-700 active:bg-slate-200"
                    }`}
                  >
                    {value}
                  </button>
                ))}
              </div>
              <SheetPreview schema={schema} data={sheet} loading={previewLoading} />
            </>
          )}
          {tab === "sql" && (
            <SqlPreview schemaSql={schemaSql} dataSql={dataSql} fileName={schemaFileName} loading={previewLoading} />
          )}
          {tab === "query" && schema && <SqlPlayground projectId={projectId} schema={schema} />}
          {tab === "diagram" && (
            <DiagramPreview
              svg={diagram}
              loading={previewLoading}
              onDownloadPng={downloadPng}
              onDownloadSvg={() => {
                if (exportsReady) downloadText(diagram, "diagram.svg", "image/svg+xml");
              }}
            />
          )}
          {tab === "history" && schema && (
            <VersionHistory projectId={projectId} history={history} schema={schema} onRestored={handleRestored} />
          )}

          {/* The one-click fix panel and change history used to live only inside
              the `hidden xl:block` sidebar, so the `#refine` anchor in the mobile
              action bar pointed at a `display:none` element and the entire
              refine + voice loop was unreachable on every phone. This is the
              same markup, shown below xl. */}
          <div className="mt-4 space-y-4 xl:hidden">
            <div className="glass rounded-2xl p-4" id="refine">
              <h3 className="text-base font-bold text-slate-900">One-click fix</h3>
              <p className="mt-1 text-sm text-slate-600">
                Change this same database — nothing gets rebuilt from scratch.
              </p>
              <div className="relative mt-3">
                <textarea
                  value={instruction}
                  aria-label="Describe the change to apply"
                  enterKeyHint="done"
                  onChange={(event) => setInstruction(event.target.value)}
                  onKeyDown={(event) => {
                    // Deliberately NOT plain Enter. This fires a paid, irreversible
                    // schema rewrite, and a phone keyboard has a return key but no
                    // Shift or Cmd - so plain Enter was one accidental tap away.
                    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                      event.preventDefault();
                      runRefine(instruction);
                    }
                  }}
                  rows={2}
                  placeholder="e.g. add payment table"
                  /* 56px of bottom padding clears the 44px mic that sits 12px in
                     from the corner, so a full second line of text can never end
                     up underneath it. */
                  className="w-full resize-none rounded-xl border border-slate-300 bg-white pb-14 pl-3 pr-4 pt-3 text-base text-slate-900 outline-none placeholder:text-slate-500 focus:border-brand-400"
                />
                <VoiceInput
                  ref={mobileVoiceRef}
                  embedded
                  size="xs"
                  whisperEnabled={whisperEnabled}
                  forceBrowser={forceBrowser}
                  onTranscript={appendInstruction}
                />
              </div>
              <button
                type="button"
                onClick={() => runRefine(instruction)}
                disabled={Boolean(pendingRefine)}
                className="btn-primary mt-2 min-h-11 w-full rounded-xl px-4 py-3 text-base font-bold text-white"
              >
                {pendingRefine ? "Reviewing…" : "🪄 Review change"}
              </button>
              <p className="mt-1.5 text-center text-xs text-slate-500">
                Tap Review change to see what it would do. Enter alone will not.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {QUICK_FIXES.map((fix) => (
                  <button
                    key={fix}
                    type="button"
                    onClick={() => runRefine(fix)}
                    className="min-h-11 rounded-full border border-slate-300 bg-slate-100 px-4 py-2 text-sm font-medium text-slate-700 transition active:border-brand-400 active:bg-brand-50 active:text-brand-700"
                  >
                    {fix}
                  </button>
                ))}
              </div>
            </div>

            {history.length > 0 && (
              <div className="glass rounded-2xl p-4">
                <h3 className="text-base font-bold text-slate-900">Change history</h3>
                <ol className="mt-3 space-y-2.5">
                  {history.slice(-8).reverse().map((item) => (
                    <li key={item.id} className="border-l-2 border-brand-500/40 pl-3">
                      <p className="text-sm font-semibold text-slate-800">“{item.instruction}”</p>
                      <p className="text-sm text-slate-600">{item.summary}</p>
                    </li>
                  ))}
                </ol>
              </div>
            )}

            <div className="glass-soft rounded-2xl p-4 text-sm leading-relaxed text-slate-600">
              <span className="font-semibold text-slate-800">Plan: {detail.limits.label}</span> · up to{" "}
              {maxTables} tables.{" "}
              <Link href="/pricing" className="font-semibold text-brand-700 underline-offset-2 hover:underline">
                Upgrade
              </Link>{" "}
              for 50 tables, unlimited databases and API access.
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <aside className="hidden space-y-4 xl:block">
          <div className="glass rounded-2xl p-4">
            <h3 className="text-base font-bold text-slate-900">Download</h3>
            <p className="mt-1 text-sm text-slate-600">
              {DIALECT_META[dialect].label} · {DIALECT_META[dialect].blurb}
            </p>
            <button
              type="button"
              onClick={downloadZip}
              disabled={zipping || !exportsReady}
              className="btn-primary mt-3 w-full rounded-xl px-4 py-3 text-sm font-bold text-white"
            >
              {zipping ? "Packing…" : "📦 Download database.zip"}
            </button>
            {previewError && (
              <div className="mt-2 rounded-xl border border-amber-400/50 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                <p>Previews failed: {previewError}</p>
                <button
                  type="button"
                  onClick={() => {
                    setPreviewError(null);
                    setPreviewNonce((value) => value + 1);
                  }}
                  className="mt-1 font-bold underline underline-offset-2"
                >
                  Retry
                </button>
              </div>
            )}
            <div className="mt-2 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => downloadText(schemaSql, schemaFileName)}
                disabled={!exportsReady}
                className="btn-secondary min-h-11 rounded-lg px-2 py-2.5 text-sm font-semibold text-slate-800"
              >
                database.sql
              </button>
              <button
                type="button"
                onClick={() => downloadText(dataSql, "sample_data.sql")}
                disabled={!exportsReady}
                className="btn-secondary min-h-11 rounded-lg px-2 py-2.5 text-sm font-semibold text-slate-800"
              >
                sample_data.sql
              </button>
              <button
                type="button"
                onClick={downloadPng}
                disabled={!exportsReady}
                className="btn-secondary min-h-11 rounded-lg px-2 py-2.5 text-sm font-semibold text-slate-800"
              >
                diagram.png
              </button>
              <button
                type="button"
                onClick={() => downloadText(JSON.stringify(schema, null, 2), "schema.json", "application/json")}
                className="btn-secondary min-h-11 rounded-lg px-2 py-2.5 text-sm font-semibold text-slate-800"
              >
                schema.json
              </button>
            </div>
            <p className="mt-3 rounded-lg bg-slate-50 p-3 text-sm leading-relaxed text-slate-600">
              <span className="font-semibold text-slate-800">Import:</span> phpMyAdmin → Import → choose{" "}
              <span className="font-mono">{schemaFileName}</span> → Go, then repeat with{" "}
              <span className="font-mono">sample_data.sql</span>.
            </p>
          </div>

          {/* No `id` here: `#refine` lives on the below-xl copy in the main
              column, so the anchor resolves to a single element. */}
          <div className="glass rounded-2xl p-4">
            <h3 className="text-base font-bold text-slate-900">One-click fix</h3>
            <p className="mt-1 text-sm text-slate-600">
              Change this same database — nothing gets rebuilt from scratch.
            </p>
            <div className="relative mt-3">
              <textarea
                value={instruction}
                aria-label="Describe the change to apply"
                enterKeyHint="done"
                onChange={(event) => setInstruction(event.target.value)}
                onKeyDown={(event) => {
                  // Deliberately NOT plain Enter. This fires a paid, irreversible
                  // schema rewrite, and a phone keyboard has a return key but no
                  // Shift or Cmd - so plain Enter was one accidental tap away.
                  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                    event.preventDefault();
                    runRefine(instruction);
                  }
                }}
                rows={2}
                placeholder="e.g. add payment table"
                className="w-full resize-none rounded-xl border border-slate-300 bg-white pb-14 pl-3 pr-4 pt-3 text-base text-slate-900 outline-none placeholder:text-slate-500 focus:border-brand-400"
              />
              <VoiceInput
                ref={sidebarVoiceRef}
                embedded
                size="xs"
                whisperEnabled={whisperEnabled}
                forceBrowser={forceBrowser}
                onTranscript={appendInstruction}
              />
            </div>
            <button
              type="button"
              onClick={() => runRefine(instruction)}
              disabled={Boolean(pendingRefine)}
              className="btn-primary mt-2 min-h-11 w-full rounded-xl px-4 py-3 text-base font-bold text-white"
            >
              {pendingRefine ? "Reviewing…" : "🪄 Review change"}
            </button>
            <p className="mt-1.5 text-center text-xs text-slate-500 sm:hidden">
              Tap Review change to see what it would do. Enter alone will not.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {QUICK_FIXES.map((fix) => (
                <button
                  key={fix}
                  type="button"
                  onClick={() => runRefine(fix)}
                  className="min-h-11 rounded-full border border-slate-300 bg-slate-100 px-4 py-2 text-sm font-medium text-slate-700 transition active:border-brand-400 active:bg-brand-50 active:text-brand-700"
                >
                  {fix}
                </button>
              ))}
            </div>
          </div>

          {history.length > 0 && (
            <div className="glass rounded-2xl p-4">
              <h3 className="text-base font-bold text-slate-900">Change history</h3>
              <ol className="mt-3 space-y-2.5">
                {history.slice(-8).reverse().map((item) => (
                  <li key={item.id} className="border-l-2 border-brand-500/40 pl-3">
                    <p className="text-sm font-semibold text-slate-800">“{item.instruction}”</p>
                    <p className="text-sm text-slate-600">{item.summary}</p>
                  </li>
                ))}
              </ol>
            </div>
          )}

          <div className="glass-soft rounded-2xl p-4 text-sm leading-relaxed text-slate-600">
            <span className="font-semibold text-slate-800">Plan: {detail.limits.label}</span> · up to {maxTables}{" "}
            tables.{" "}
            <Link href="/pricing" className="font-semibold text-brand-700 underline-offset-2 hover:underline">
              Upgrade
            </Link>{" "}
            for 50 tables, unlimited databases and API access.
          </div>
        </aside>
      </div>

      <div
        className={`action-bar-safe fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/92 px-3 pt-2 backdrop-blur-xl xl:hidden ${
          keyboardOpen ? "hidden" : ""
        }`}
      >
        <div className="mx-auto flex max-w-2xl gap-2">
          <button
            type="button"
            onClick={downloadZip}
            disabled={zipping || !exportsReady}
            className="btn-primary min-w-0 flex-1 truncate rounded-xl px-3 py-3.5 text-sm font-bold text-white"
          >
            {zipping ? "Packing…" : "📦 Download .zip"}
          </button>
          <a
            href="#refine"
            className="shrink-0 rounded-xl border border-slate-300 px-4 py-3.5 text-center text-sm font-semibold text-slate-800"
          >
            🪄 Fix
          </a>
        </div>
      </div>

      {error && (
        // Errors sit above the success toast rather than at the identical
        // offset, which previously made one of the two invisible whenever
        // both were set. The offset lives in a class, not an inline style:
        // an inline `bottom` outranks the `xl:bottom-4` class on the same
        // element, so this used to never reach the desktop corner.
        <div
          role="alert"
          className="error-toast-safe fixed left-1/2 z-[60] flex w-[min(92vw,420px)] -translate-x-1/2 items-start gap-3 rounded-xl border border-rose-400/50 bg-rose-900 px-4 py-3 text-base text-rose-50 shadow-xl"
        >
          <span className="min-w-0 flex-1 break-words">{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            aria-label="Dismiss error"
            className="-mr-2 -mt-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-rose-700 transition active:bg-rose-100"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}
      {toast && (
        <div
          role="status"
          aria-live="polite"
          className="toast-safe fade-up fixed left-1/2 z-50 w-[min(92vw,460px)] -translate-x-1/2 rounded-xl border border-brand-300 bg-white/97 px-4 py-3 text-base font-medium text-slate-900 shadow-2xl"
        >
          {toast}
        </div>
      )}

      {pendingRefine && (
        <RefinePreviewDialog
          projectId={projectId}
          instruction={pendingRefine}
          onApplied={onRefineApplied}
          onDiscard={() => setPendingRefine(null)}
        />
      )}

      {sharing && <ShareDialog projectId={projectId} onClose={() => setSharing(false)} />}
    </div>
  );
}
