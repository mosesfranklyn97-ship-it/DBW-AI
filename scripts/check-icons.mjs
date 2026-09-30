import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

/**
 * Verifies the generated icon set.
 *
 * Two of these rules are platform requirements rather than taste:
 *
 *  - Android crops a maskable icon to a circle of 80% of its width and may
 *    animate a parallax zoom, so any ink outside that circle can be clipped
 *    off. The mark has to sit inside it with room to spare.
 *  - A monochrome icon is tinted by the launcher, so it must be a pure white
 *    alpha silhouette. A single non-white pixel tints to a muddy colour, and a
 *    filled background disc produces a solid rounded square instead of a glyph.
 */

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dir = resolve(root, "public", "icons");

let checks = 0;
const pass = (label) => {
  checks += 1;
  console.log(`  ok  ${label}`);
};

async function rgba(file) {
  const { data, info } = await sharp(resolve(dir, file))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, info };
}

/** Fraction of pixels opaque enough to count as ink. */
function inkRatio({ data, info }, threshold = 24) {
  const { width, height, channels } = info;
  let lit = 0;
  for (let i = 0; i < width * height; i += 1) {
    if (data[i * channels + 3] >= threshold) lit += 1;
  }
  return lit / (width * height);
}

/** Farthest opaque pixel from the centre, as a fraction of the half-width. */
function maxInkRadius({ data, info }) {
  const { width, height, channels } = info;
  const cx = (width - 1) / 2;
  const cy = (height - 1) / 2;
  const limit = Math.min(cx, cy);
  let worst = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (data[(y * width + x) * channels + 3] < 24) continue;
      const r = Math.hypot(x - cx, y - cy) / limit;
      if (r > worst) worst = r;
    }
  }
  return worst;
}

console.log("icon geometry");

const DIMENSIONS = {
  "icon-192.png": 192,
  "icon-512.png": 512,
  "icon-1024.png": 1024,
  "icon-maskable-192.png": 192,
  "icon-maskable-512.png": 512,
  "icon-monochrome-512.png": 512,
  "apple-touch-icon.png": 180,
  "favicon-32.png": 32,
};

for (const [file, size] of Object.entries(DIMENSIONS)) {
  const meta = await sharp(resolve(dir, file)).metadata();
  assert.equal(meta.width, size, `${file} should be ${size}px wide, got ${meta.width}`);
  assert.equal(meta.height, size, `${file} should be ${size}px tall, got ${meta.height}`);
}
pass(`all ${Object.keys(DIMENSIONS).length} PNGs have their declared square dimensions`);

const SAFE = 0.8;

/*
 * Safe zone.
 *
 * Android crops a maskable icon to a circle of 80% of its width, so what has to
 * stay inside that circle is the *mark*, not the backdrop. A maskable icon is
 * full bleed by design - its corners are meant to be opaque - so measuring raw
 * opacity always reports sqrt(2) and tells you nothing.
 *
 * The measurement is therefore taken from the monochrome variant, which the
 * generator draws as the glyph alone at the same `glyph` scale as the maskable
 * one. That equivalence is asserted below, so the proxy cannot quietly drift
 * away from the artwork it stands in for.
 */
{
  const reach = maxInkRadius(await rgba("icon-monochrome-512.png"));
  assert.ok(
    reach <= SAFE,
    `the mark reaches ${(reach * 100).toFixed(1)}% of the half-width, past the ${SAFE * 100}% safe zone`,
  );
  pass(`the mark stays inside the ${SAFE * 100}% safe zone (ink reaches ${(reach * 100).toFixed(1)}%)`);

  // Keep the proxy honest: both variants must share the same glyph scale.
  const source = await readFile(resolve(root, "scripts", "generate-icons.mjs"), "utf8");
  const scaleOf = (name) => {
    const match = new RegExp(`const ${name} = \\{[^}]*glyph: ([0-9.]+)`).exec(source);
    assert.ok(match, `could not read the ${name} glyph scale from generate-icons.mjs`);
    return Number(match[1]);
  };
  assert.equal(
    scaleOf("MONO"),
    scaleOf("MASKABLE"),
    "MONO and MASKABLE must share a glyph scale, or the safe-zone measurement above no longer describes the maskable icon",
  );
  pass(`MONO and MASKABLE share glyph scale ${scaleOf("MASKABLE")}, so the measurement is valid`);
}

// A maskable icon is meant to be full bleed: the launcher supplies the shape, so
// leaving a transparent margin would show the wallpaper through the corners.
{
  const { data, info } = await rgba("icon-maskable-512.png");
  const { width, height, channels } = info;
  let transparent = 0;
  for (let i = 0; i < width * height; i += 1) {
    if (data[i * channels + 3] < 250) transparent += 1;
  }
  assert.equal(transparent, 0, `maskable icon has ${transparent} non-opaque pixels`);
  pass("icon-maskable-512.png is fully opaque edge to edge");
}

{
  const file = "icon-monochrome-512.png";
  const { data, info } = await rgba(file);
  const { width, height, channels } = info;
  let lit = 0;
  let tinted = 0;
  for (let i = 0; i < width * height; i += 1) {
    if (data[i * channels + 3] < 8) continue;
    lit += 1;
    // Antialiased edges are white at partial alpha; anything with a colour cast
    // would be tinted by the launcher and read as a smudge.
    if (data[i * channels] < 250 || data[i * channels + 1] < 250 || data[i * channels + 2] < 250) {
      tinted += 1;
    }
  }
  assert.ok(lit > 0, `${file} is entirely transparent`);
  assert.equal(tinted, 0, `${file} has ${tinted} non-white pixels`);
  const coverage = lit / (width * height);
  assert.ok(coverage < 0.6, `monochrome coverage ${(coverage * 100).toFixed(1)}% suggests a filled plate`);
  pass(
    `${file} is a pure white silhouette (${lit.toLocaleString()} lit pixels, 0 tinted, ${(coverage * 100).toFixed(1)}% coverage)`,
  );
}

// A normal icon should fill its canvas, or the mark sits letterboxed on home
// screens.
{
  const ratio = inkRatio(await rgba("icon-512.png"), 250);
  assert.ok(ratio > 0.9, `icon-512.png is only ${(ratio * 100).toFixed(1)}% opaque; it should be full bleed`);
  pass(`icon-512.png is full bleed (${(ratio * 100).toFixed(1)}% opaque)`);
}

console.log("icon source");

{
  const buffer = await readFile(resolve(dir, "d1.jpg"));
  const meta = await sharp(buffer).metadata();
  assert.equal(meta.format, "jpeg", "d1.jpg should be a JPEG");
  assert.equal(meta.width, 2048, `d1.jpg master should be 2048px, got ${meta.width}`);
  assert.equal(meta.height, 2048, `d1.jpg master should be 2048px, got ${meta.height}`);
  pass(`d1.jpg is a valid ${meta.width}x${meta.height} JPEG (${(buffer.length / 1024).toFixed(0)} KB)`);
}

console.log(`icons: ${checks} assertions passed`);
