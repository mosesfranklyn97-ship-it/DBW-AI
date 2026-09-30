/**
 * Writes `public/sw.js` from `scripts/sw.template.js`, substituting a build id
 * for `__SW_BUILD__`. Wired into the `dev` and `build` scripts so the service
 * worker is always generated and never hand-edited.
 *
 * Without this the worker is a fixed file: a deploy that does not touch it
 * ships identical bytes, the browser sees nothing new, and the caches from the
 * last release are still being served. Stamping gives each build its own
 * identity, which is what makes an install actually happen on devices that
 * already have the app.
 */
import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TEMPLATE = join(ROOT, "scripts", "sw.template.js");
const OUTPUT = join(ROOT, "public", "sw.js");
const TOKEN = "BUILD_ID_PLACEHOLDER";

/** Directories walked in full, relative to the project root. */
const TREES = ["src", "public"];

/** Individual files that change the built app. */
const FILES = ["package.json", "next.config.ts", "postcss.config.mjs", "tsconfig.json"];

/** Excluded from the hash. The output cannot hash itself, or the id would move
 *  every time it is written. */
const SKIP = new Set(["public/sw.js"]);

async function* walk(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.isFile()) yield full;
  }
}

/**
 * Short digest of everything that goes into the build. A content hash is used
 * rather than a timestamp so an unchanged tree keeps its id, and re-running the
 * script writes nothing.
 */
async function hashSource() {
  const hash = createHash("sha256");
  const paths = [];

  for (const tree of TREES) {
    for await (const file of walk(join(ROOT, tree))) paths.push(file);
  }
  for (const file of FILES) paths.push(join(ROOT, file));

  for (const file of paths.sort()) {
    const rel = relative(ROOT, file).split(sep).join("/");
    if (SKIP.has(rel)) continue;
    hash.update(rel);
    hash.update(await readFile(file));
  }
  return hash.digest("hex").slice(0, 12);
}

async function main() {
  const template = await readFile(TEMPLATE, "utf8");
  if (!template.includes(TOKEN)) {
    throw new Error(`${TEMPLATE} no longer contains the ${TOKEN} placeholder.`);
  }

  // Vercel exposes the commit, which is the most legible id to see in a
  // deployed worker. Locally there is no commit to read, so the source hash
  // stands in - and it is the more honest of the two, since it only moves when
  // the shipped app actually moves.
  const build = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) || (await hashSource());

  const stamped = template.replaceAll(TOKEN, build);
  const current = await readFile(OUTPUT, "utf8").catch(() => null);
  if (current === stamped) return;

  await writeFile(OUTPUT, stamped);
  console.log(`sw.js stamped with build ${build}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
