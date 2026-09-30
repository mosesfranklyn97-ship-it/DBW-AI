"use client";

/**
 * Last-resort boundary. Replaces the whole document, so it has to render its
 * own <html> and <body> and cannot rely on the root layout's providers.
 */
export default function GlobalError({ reset }: { reset: () => void }) {
  return (
    <html lang="en">
      {/* This boundary replaces the root layout, which is the only thing that
          emits <meta name="viewport">. Without it a phone falls back to the
          ~980px layout viewport and scales the whole screen down, so the one
          screen a user sees on a total load failure renders tiny. It also
          cannot rely on globals.css, so the safe-area and dvh values that would
          normally come from there are inlined below. */}
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="theme-color" content="#ffffff" />
      </head>
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          paddingTop: "calc(1.25rem + env(safe-area-inset-top, 0px))",
          paddingRight: "1.25rem",
          paddingBottom: "calc(1.25rem + env(safe-area-inset-bottom, 0px))",
          paddingLeft: "1.25rem",
          fontFamily: "ui-sans-serif, system-ui, -apple-system, sans-serif",
          WebkitTapHighlightColor: "transparent",
          background: "#ffffff",
          color: "#0f172a",
        }}
      >
        <div style={{ maxWidth: "24rem", textAlign: "center" }}>
          <div style={{ fontSize: "2rem" }}>⚠️</div>
          <h1 style={{ fontSize: "1.25rem", fontWeight: 700, margin: "0.75rem 0 0" }}>
            The app failed to load
          </h1>
          <p style={{ fontSize: "0.875rem", lineHeight: 1.6, color: "#475569", margin: "0.5rem 0 0" }}>
            Reloading usually clears it. If not, close and reopen the app.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: "1.5rem",
              minHeight: 44,
              padding: "0.75rem 1.25rem",
              borderRadius: "0.75rem",
              border: 0,
              fontWeight: 700,
              fontSize: "1rem",
              color: "#fff",
              background: "linear-gradient(120deg, #5b6cff, #7c3aed 55%, #0ea5e9)",
            }}
          >
            Reload
          </button>
        </div>
      </body>
    </html>
  );
}
