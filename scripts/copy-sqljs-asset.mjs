import { copyFile, mkdir, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * sql.js loads its WebAssembly binary at runtime from a URL, and the browser
 * bundle cannot resolve one out of node_modules on its own. The file is copied
 * into public/ so the page can fetch it from a stable, cacheable path.
 *
 * It is copied rather than imported because Next.js does not emit .wasm as a
 * static asset from a node_modules import, and inlining 643 KB of base64 into
 * the JavaScript chunk would delay first paint for everyone who never opens the
 * playground.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const target = join(root, "public", "sql-wasm.wasm");
const source = join(root, "node_modules", "sql.js", "dist", "sql-wasm.wasm");

async function main() {
  const from = await stat(source).catch(() => null);
  if (!from) {
    console.error("sql-wasm.wasm not found — run npm install first.");
    process.exit(1);
  }

  const existing = await stat(target).catch(() => null);
  // Rewriting an identical 643 KB file on every dev boot invalidates the
  // browser's cache and makes the playground reload the wasm each time.
  if (existing && existing.size === from.size) return;

  await mkdir(dirname(target), { recursive: true });
  await copyFile(source, target);
  console.log(`sql-wasm.wasm → public/ (${Math.round(from.size / 1024)} KB)`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
