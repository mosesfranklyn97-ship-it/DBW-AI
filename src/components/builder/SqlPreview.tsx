"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { highlightSql } from "@/lib/client/highlight";

interface Props {
  schemaSql: string;
  dataSql: string;
  fileName: string;
  loading: boolean;
}

export default function SqlPreview({ schemaSql, dataSql, fileName, loading }: Props) {
  const [tab, setTab] = useState<"schema" | "data">("schema");
  const [copied, setCopied] = useState<"idle" | "done" | "failed">("idle");
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const code = tab === "schema" ? schemaSql : dataSql;
  const html = useMemo(() => highlightSql(code || ""), [code]);

  useEffect(() => {
    return () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    };
  }, []);

  const copy = async () => {
    if (copyTimer.current) clearTimeout(copyTimer.current);
    try {
      await navigator.clipboard.writeText(code);
      setCopied("done");
    } catch {
      // Blocked clipboard (insecure context, denied permission) previously
      // failed silently, leaving the user with no idea why nothing copied.
      setCopied("failed");
    }
    copyTimer.current = setTimeout(() => {
      copyTimer.current = null;
      setCopied("idle");
    }, 1800);
  };

  return (
      <div className="code-panel overflow-hidden rounded-2xl">

      <div className="flex flex-wrap items-center gap-2 border-b border-white/10 px-3 py-2.5">
        {/*
          The schema tab is labelled with the AI-generated project name, so it
          can be 40+ characters. Without a scroll container and shrink-0 the
          two tabs - the only way to switch between DDL and seed data - were
          pushed off the right edge of a 320px screen and clipped by the
          panel's overflow-hidden, with no way to reach them.
        */}
        <div className="scroll-x-touch flex max-w-full overflow-x-auto rounded-lg border border-white/15 p-0.5">
          {(
            [
              { key: "schema", label: fileName },
              { key: "data", label: "sample_data.sql" },
            ] as const
          ).map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setTab(item.key)}
              aria-pressed={tab === item.key}
              className={`min-h-11 shrink-0 whitespace-nowrap rounded-md px-3 py-2 font-mono text-sm font-semibold transition ${
                tab === item.key ? "bg-brand-500/30 text-white" : "text-slate-300 active:bg-white/10"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
        <span className="ml-auto shrink-0 text-sm text-slate-400">{code.split("\n").length} lines</span>
        <button
          type="button"
          onClick={copy}
          role="status"
          className="min-h-11 shrink-0 rounded-lg border border-white/20 px-3 py-2 text-sm font-semibold text-slate-100 transition active:bg-white/10"
        >
          {copied === "done" ? "✓ Copied" : copied === "failed" ? "Copy blocked" : "Copy SQL"}
        </button>
      </div>

      {loading ? (
        <div className="space-y-2 p-4">
          {Array.from({ length: 10 }).map((_, index) => (
            <div key={index} className="shimmer h-3 rounded" style={{ width: `${45 + ((index * 13) % 50)}%` }} />
          ))}
        </div>
      ) : (
        <pre className="sql-code scroll-thin max-h-[62vh] max-h-[62dvh] overflow-auto bg-black/30 p-4 font-mono text-[13px] leading-relaxed text-slate-200">
          <code dangerouslySetInnerHTML={{ __html: html }} />
        </pre>
      )}
    </div>
  );
}
