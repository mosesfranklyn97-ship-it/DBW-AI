"use client";

import { useState } from "react";

interface Props {
  svg: string;
  loading: boolean;
  onDownloadPng: () => void;
  onDownloadSvg: () => void;
}

export default function DiagramPreview({ svg, loading, onDownloadPng, onDownloadSvg }: Props) {
  // A three-level ER diagram is roughly 1090px wide at the generator's fixed
  // box metrics, so a 390px phone showed about a third of it with no zoom and
  // no hint that it scrolled. "Fit" scales the whole diagram to the viewport;
  // "Actual size" keeps the 1:1 rendering and scrolls.
  const [fit, setFit] = useState(true);

  return (
      <div className="code-panel overflow-hidden rounded-2xl">

      <div className="flex flex-wrap items-center gap-2 border-b border-white/10 px-3 py-2.5">
        <span className="text-sm font-semibold text-slate-200">Entity relationship diagram</span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setFit((value) => !value)}
            aria-pressed={fit}
            className={`min-h-11 rounded-lg border px-3 py-2 text-sm font-semibold transition active:bg-white/10 ${
              fit
                ? "border-brand-400/60 bg-brand-500/25 text-white"
                : "border-white/20 text-slate-200"
            }`}
          >
            {fit ? "✓ Fit to width" : "Actual size"}
          </button>
          <button
            type="button"
            onClick={onDownloadPng}
            className="btn-primary min-h-11 rounded-lg px-3 py-2 text-sm font-bold text-white"
          >
            ⬇ diagram.png
          </button>
          <button
            type="button"
            onClick={onDownloadSvg}
            className="min-h-11 rounded-lg border border-white/20 px-3 py-2 text-sm font-semibold text-slate-100 transition active:bg-white/10"
          >
            ⬇ .svg
          </button>
        </div>
      </div>
      {loading ? (
        <div className="shimmer m-4 h-[52vh] h-[52dvh] rounded-xl" />
      ) : fit ? (
        <div
          className="max-h-[62vh] max-h-[62dvh] overflow-auto bg-[#020617] p-3 [&_svg]:h-auto [&_svg]:w-full"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      ) : (
        <div
          className="diagram-actual scroll-thin scroll-x-touch max-h-[62vh] max-h-[62dvh] overflow-auto bg-[#020617] p-3 [&_svg]:h-auto"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      )}
    </div>
  );
}
