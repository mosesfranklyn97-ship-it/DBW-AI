/**
 * Renders `d1.jpg`, the master the app icon is built from.
 *
 * Everything the shipped icons need is derived from this one file, so it is the
 * only place the artwork has to be edited. The variants are not independent
 * images: `d1.jpg` is the full-bleed composition at a size where the gradient
 * banding and the extrusion facets are both clean, and the other renderings
 * either crop it, flatten it to a silhouette, or resample it.
 *
 * This is procedural rather than a photograph, which matters for two of the
 * outputs. Android 13 tints the themed icon from the alpha channel alone and
 * throws the colour away, so `icon-monochrome-512.png` has to be the mark by
 * itself with no plate behind it; a photo of a mark cannot be separated into a
 * clean silhouette, and a photo with a busy background would turn into mush once
 * the system cuts it to one shape. Drawing the mark analytically means the
 * silhouette is exact at any size.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = resolve(rootDir, "public", "icons");
mkdirSync(outDir, { recursive: true });

/** Composition units. Every dimension below is in this space. */
const VIEW = 48;
/** Supersamples per axis. 3 is what the PNG icons use; see the note on cost. */
const SS = 3;
/**
 * `d1.jpg` is the master, so it renders at a size where the artwork is
 * re-encodable several times over. 2048 is the point where downsampling to 1024
 * still gives the JPEG decoder real detail to work with, and where the facets on
 * the extrusion stop reading as visible steps.
 */
const MASTER = 2048;

const INK = [0x04, 0x06, 0x0f];
const PLUS = [0x7d, 0xd3, 0xfc];
/**
 * White, so the alpha channel is the only channel the themed-icon path reads.
 * A dark or coloured ink here would be tinted anyway, and would show up as a
 * fringe on platforms that composite before tinting.
 */
const MONO_INK = [255, 255, 255];

/**
 * The glyph is lifted off the plate by this many units and drawn again, offset
 * down-right, so it reads as a solid extruded object rather than a flat sticker.
 * The depth has to agree between the front face, the extrusion pass and the cast
 * shadow, which is why it is a single constant rather than a literal in each.
 */
const DEPTH = 2.1;
/** Light from the upper-left, so the extrusion faces point down-right. */
const LIGHT = [-0.58, -0.81];

const GRADIENT = [
  [0, [0x5b, 0x6c, 0xff]],
  [0.55, [0x7c, 0x3a, 0xed]],
  [1, [0x0e, 0xa5, 0xe9]],
];

function gradientAt(t) {
  const v = Math.max(0, Math.min(1, t));
  for (let i = 0; i < GRADIENT.length - 1; i += 1) {
    const [p0, c0] = GRADIENT[i];
    const [p1, c1] = GRADIENT[i + 1];
    if (v <= p1) {
      const k = (v - p0) / (p1 - p0);
      return [
        c0[0] + (c1[0] - c0[0]) * k,
        c0[1] + (c1[1] - c0[1]) * k,
        c0[2] + (c1[2] - c0[2]) * k,
      ];
    }
  }
  return GRADIENT[GRADIENT.length - 1][1];
}

function sdRoundedRect(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - (hw - r);
  const qy = Math.abs(py - cy) - (hh - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

function sdEllipse(px, py, cx, cy, rx, ry) {
  return (Math.hypot((px - cx) / rx, (py - cy) / ry) - 1) * Math.min(rx, ry);
}

function sdPolyline(px, py, points) {
  let best = Infinity;
  for (let i = 0; i < points.length - 1; i += 1) {
    const ax = points[i][0];
    const ay = points[i][1];
    const vx = points[i + 1][0] - ax;
    const vy = points[i + 1][1] - ay;
    const wx = px - ax;
    const wy = py - ay;
    const len = vx * vx + vy * vy;
    const t = len === 0 ? 0 : Math.max(0, Math.min(1, (wx * vx + wy * vy) / len));
    const dx = wx - vx * t;
    const dy = wy - vy * t;
    const d = dx * dx + dy * dy;
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

function cubic(p0, p1, p2, p3, steps = 20) {
  const out = [];
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps;
    const mt = 1 - t;
    out.push([
      mt * mt * mt * p0[0] + 3 * mt * mt * t * p1[0] + 3 * mt * t * t * p2[0] + t * t * t * p3[0],
      mt * mt * mt * p0[1] + 3 * mt * mt * t * p1[1] + 3 * mt * t * t * p2[1] + t * t * t * p3[1],
    ]);
  }
  return out;
}

function bandShape(topY, bottomY) {
  const points = [
    [12, topY],
    [12, bottomY],
  ];
  points.push(
    ...cubic([12, bottomY], [12, bottomY + 2.5], [17.4, bottomY + 4.6], [24, bottomY + 4.6]),
  );
  points.push(
    ...cubic([24, bottomY + 4.6], [30.6, bottomY + 4.6], [36, bottomY + 2.1], [36, bottomY]),
  );
  points.push([36, topY]);
  return points;
}

function withBounds(points, pad) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of points) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { points, pad, minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
}

const STROKES = [
  withBounds(bandShape(15, 23), 1.3),
  withBounds(bandShape(23, 32), 1.3),
  withBounds(
    [
      [35, 30.4],
      [35, 37.6],
    ],
    1.1,
  ),
  withBounds(
    [
      [31.4, 34],
      [38.6, 34],
    ],
    1.1,
  ),
];

/** Silhouette bounds in glyph space, so most pixels can be rejected up front. */
const GLYPH_BOX = (() => {
  const box = { minX: 12, minY: 10.4, maxX: 42.5, maxY: 41.5 };
  for (const stroke of STROKES) {
    box.minX = Math.min(box.minX, stroke.minX);
    box.minY = Math.min(box.minY, stroke.minY);
    box.maxX = Math.max(box.maxX, stroke.maxX);
    box.maxY = Math.max(box.maxY, stroke.maxY);
  }
  return box;
})();

const EX = -LIGHT[0] * DEPTH;
const EY = -LIGHT[1] * DEPTH;

/** Everything the solid can occupy, including the part its walls sweep into. */
const SOLID_BOX = {
  minX: GLYPH_BOX.minX,
  minY: GLYPH_BOX.minY,
  maxX: GLYPH_BOX.maxX + EX,
  maxY: GLYPH_BOX.maxY + EY,
};

/** Centre of the solid, i.e. the front face plus the space its walls sweep. */
const SOLID_CX = (SOLID_BOX.minX + SOLID_BOX.maxX) / 2;
const SOLID_CY = (SOLID_BOX.minY + SOLID_BOX.maxY) / 2;

function onSolid(gx, gy) {
  return gx >= SOLID_BOX.minX && gx <= SOLID_BOX.maxX && gy >= SOLID_BOX.minY && gy <= SOLID_BOX.maxY;
}

/**
 * How far the cast shadow is offset from the silhouette, plus its blur. Kept
 * short on purpose: a long shadow runs into the plate's rounded corner in the
 * non-full-bleed variants and gets cut off, so the grounding is done mostly by
 * the contact term instead.
 */
const SHADOW_DX = 1.4;
const SHADOW_DY = 1.8;
const SHADOW_BLUR = 1.8;

const SHADOW_BOX = {
  minX: GLYPH_BOX.minX - SHADOW_DX - SHADOW_BLUR,
  minY: GLYPH_BOX.minY - SHADOW_DY - SHADOW_BLUR,
  maxX: GLYPH_BOX.maxX + SHADOW_DX + SHADOW_BLUR,
  maxY: GLYPH_BOX.maxY + SHADOW_DY + SHADOW_BLUR,
};

function mix(a, b, t) {
  const k = Math.max(0, Math.min(1, t));
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}

function smoothstep(edgeIn, edgeOut, x) {
  const t = Math.max(0, Math.min(1, (x - edgeIn) / (edgeOut - edgeIn)));
  return t * t * (3 - 2 * t);
}

/**
 * View space to glyph space: scale about the solid's centre, then put that
 * centre at the middle of the canvas.
 *
 * `mode.glyph` is a zoom on glyph space, so it is inverted relative to how it
 * reads: the canvas samples a `VIEW/2 * mode.glyph` unit window of glyph space,
 * which means a value above 1 *shrinks* the mark. Scaling about the solid's own
 * centre rather than the point the extrusion pushes towards is what keeps it
 * centred: scaling about an off-centre point both translates and scales, which
 * is how the maskable icon previously came out at 89.5% of the edge with a
 * corner reach of 1.32, well outside the 0.8 radius Android crops to.
 */
function toGlyph(vx, vy, mode) {
  return [SOLID_CX + (vx - VIEW / 2) * mode.glyph, SOLID_CY + (vy - VIEW / 2) * mode.glyph];
}

/** Signed distance to the whole mark. Negative inside. */
function glyphSdf(gx, gy) {
  let d = sdEllipse(gx, gy, 24, 15, 12, 4.6);
  for (let i = 0; i < STROKES.length; i += 1) {
    d = Math.min(d, sdPolyline(gx, gy, STROKES[i].points) - STROKES[i].pad);
  }
  return d;
}

/** How the two stacked bands and the plus read as lit surfaces. Negative is top. */
function topFaceShade(gx, gy) {
  const bandTop = gy < 23.5 ? 1 : 0;
  const armX = gx > 30.5 ? 1 : 0;
  const armY = gy < 34 ? 1 : 0;
  return -0.26 + 0.3 * bandTop + 0.16 * armX + 0.1 * armY;
}

function rimLight(gx, gy, side) {
  const edge = side === 0 ? gx - 12 : 36 - gx;
  return smoothstep(1.7, 0, edge) * smoothstep(-0.15, 0.55, glyphSdf(gx, gy));
}

function topLight(gx, gy) {
  return smoothstep(1.7, -0.3, gy - 10.4) * smoothstep(0, 0.7, glyphSdf(gx, gy));
}

function sideLight(gx, gy) {
  return smoothstep(1.7, 0, gy - 10.4) * smoothstep(0, 0.7, glyphSdf(gx, gy));
}

function bottomLight(gx, gy) {
  return smoothstep(1.7, 0, 42.5 - gx) * smoothstep(0, 0.7, glyphSdf(gx, gy));
}

function shadowAt(gx, gy) {
  const sx = gx - SHADOW_DX;
  const sy = gy - SHADOW_DY;
  if (sx < SHADOW_BOX.minX || sx > SHADOW_BOX.maxX || sy < SHADOW_BOX.minY || sy > SHADOW_BOX.maxY) {
    return 0;
  }
  const d = glyphSdf(sx, sy);
  return smoothstep(SHADOW_BLUR, 0, d) * 0.82;
}

function sample(vx, vy, mode) {
  const [gx, gy] = toGlyph(vx, vy, mode);

  /**
   * Monochrome layer, handled before any of the plate logic.
   *
   * Android 13+ tints this using the alpha channel only, recolouring whatever
   * the user picks from their wallpaper palette, so it carries a silhouette and
   * nothing else: no plate (the system supplies the background layer), no
   * gradient, no rim light, none of the shadow. Those all encode colour, and
   * colour here is thrown away.
   *
   * The silhouette is the flat front face rather than the whole extruded solid.
   * Including the walls would grow the shape by DEPTH in a direction the system
   * then masks, which eats into the safe zone and blurs the edge.
   */
  if (mode.mono) {
    if (!onSolid(gx, gy) || glyphSdf(gx, gy) > 0) return null;
    return MONO_INK;
  }

  let plate = null;
  if (mode.fullBleed) {
    plate = gradientAt(vx / VIEW);
  } else if (sdRoundedRect(vx, vy, 24, 24, 22, 22, 13) <= 0) {
    plate = gradientAt((vx - 2 + vy - 2) / 88);
  }
  if (!plate) return null;

  if (onSolid(gx, gy)) {
    const d = glyphSdf(gx, gy);
    // Front face first, then the extruded walls behind it.
    if (d <= 0) {
      const shade = topFaceShade(gx, gy);
      const base = mix(INK, PLUS, Math.max(0, Math.min(1, shade)));
      const lift = topLight(gx, gy) * 0.3 + rimLight(gx, gy, 0) * 0.16 + bottomLight(gx, gy) * 0.1;
      const sheen = sideLight(gx, gy) * 0.16;
      return mix(mix(base, [255, 255, 255], lift), PLUS, sheen * 0.5);
    }
    // The wall between the front face and the silhouette it is extruded into.
    const depth = Math.min(1, d / DEPTH);
    const face = gx >= 36 ? sideLight(gx, gy) : topLight(gx, gy);
    const wall = mix(mix(INK, PLUS, 0.06 + 0.1 * face), INK, 0.22 * depth);
    return mix(wall, [255, 255, 255], Math.max(0, 0.12 * (1 - depth)));
  }

  // Contact shadow just off the silhouette, then a much fainter ambient one.
  if (gx >= SHADOW_BOX.minX && gx <= SHADOW_BOX.maxX && gy >= SHADOW_BOX.minY && gy <= SHADOW_BOX.maxY) {
    return mix(plate, INK, 0.28 * shadowAt(gx, gy));
  }

  return plate;
}

/**
 * Rasterises the master at `size`.
 *
 * `ss` is the per-axis supersample count and it is exposed because the cost here
 * is O(size^2 * ss^2) with a signed-distance evaluation per sample. The largest
 * rendering trades 3x3 for 2x2: at high resolution each pixel already spans more
 * of the shape, so the banding that supersampling exists to remove is below what
 * the eye resolves once the launcher scales the result down.
 */
function renderMaster(size, mode, ss = SS) {
  const rgba = Buffer.alloc(size * size * 4);
  const step = VIEW / size;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let hits = 0;
      for (let sy = 0; sy < ss; sy += 1) {
        for (let sx = 0; sx < ss; sx += 1) {
          const vx = (x + (sx + 0.5) / ss) * step;
          const vy = (y + (sy + 0.5) / ss) * step;
          const color = sample(vx, vy, mode);
          if (color) {
            r += color[0];
            g += color[1];
            b += color[2];
            hits += 1;
          }
        }
      }
      const offset = (y * size + x) * 4;
      if (hits === 0) continue;
      rgba[offset] = Math.round(r / hits);
      rgba[offset + 1] = Math.round(g / hits);
      rgba[offset + 2] = Math.round(b / hits);
      rgba[offset + 3] = Math.round((hits / (ss * ss)) * 255);
    }
  }
  return rgba;
}

/**
 * Renderings of the same mark.
 *
 * `glyph` is a zoom, so larger means smaller artwork; see `toGlyph`. The reach
 * figures are the worst-corner distance as a fraction of the icon's half-width,
 * and Android's limit is 0.8 for anything it crops to a shape.
 */
const MASKABLE = { fullBleed: true, glyph: 1.45 }; // 0.67 reach, mark at 47% of the edge
const APPLE = { fullBleed: true, glyph: 1.3 }; // 0.74 reach, iOS masks a squircle
/** Matched to the maskable icon, since the system supplies its own backdrop. */
const MONO = { fullBleed: true, glyph: 1.45, mono: true }; // 0.67 reach, mark at 47% of the edge

/**
 * `d1.jpg` is the master.
 *
 * It is drawn in the APPLE rendering rather than the NORMAL one because those
 * are the same composition at two different plate sizes, and the full-bleed
 * version is the one worth keeping: the master is re-encoded into the "any"
 * icons, and a full-bleed master has no transparent corners to lose to the JPEG
 * round trip. The NORMAL rendering with its own rounded plate is no longer
 * emitted at all; the "any" icons are the full-bleed art, which is what both
 * iOS and Android crop to a rounded shape themselves.
 */
const d1 = renderMaster(MASTER, APPLE, 2);

/**
 * Encoded once here, then resampled by sharp for every derived icon.
 *
 * sharp is doing the downscaling rather than a hand-rolled box filter because a
 * 2048-to-32 reduction needs a proper multi-step kernel; the naive average
 * filter this file used to carry drops the mark's thin arms at favicon size and
 * leaves a visible staircase on the gradient.
 */
const masterPng = await sharp(d1, { raw: { width: MASTER, height: MASTER, channels: 4 } })
  .png({ compressionLevel: 9 })
  .toBuffer();

await writeFileSync(resolve(outDir, "d1.jpg"), await sharp(masterPng).jpeg({ quality: 92, mozjpeg: true }).toBuffer());

/** Derived from `d1.jpg`, so swapping that one file swaps every icon. */
const fromMaster = async (name, size) => {
  await sharp(resolve(outDir, "d1.jpg"))
    .resize(size, size, { fit: "cover", kernel: "lanczos3" })
    .png({ compressionLevel: 9 })
    .toFile(resolve(outDir, name));
};

await fromMaster("apple-touch-icon.png", 180);
await fromMaster("icon-192.png", 192);
await fromMaster("icon-512.png", 512);
await fromMaster("icon-1024.png", 1024);

/**
 * The maskable and monochrome variants are drawn rather than resampled.
 *
 * Both are cropped to a shape by the launcher, so they need artwork at a size
 * that survives that crop: resampling `d1.jpg` down would keep the mark at its
 * full-bleed proportions, which is where the corners run past the 0.8 safe
 * radius and the launcher shaves them off. Monochrome cannot be resampled at
 * all, since a photo has no alpha channel to tint.
 */
const maskable = renderMaster(1024, MASKABLE, 3);
const maskableRaw = { raw: { width: 1024, height: 1024, channels: 4 } };
// Both maskable sizes are downsampled from the 1024 master. Writing the master
// straight to the 512 filename shipped a 1024px image under a name that says
// 512, while the manifest advertised "512x512" - a mismatch any launcher or PWA
// audit is entitled to reject.
await sharp(maskable, maskableRaw)
  .resize(512, 512, { kernel: "lanczos3" })
  .png({ compressionLevel: 9 })
  .toFile(resolve(outDir, "icon-maskable-512.png"));
await sharp(maskable, maskableRaw)
  .resize(192, 192, { kernel: "lanczos3" })
  .png({ compressionLevel: 9 })
  .toFile(resolve(outDir, "icon-maskable-192.png"));

const mono = renderMaster(512, MONO, 3);
const monoPng = await sharp(mono, { raw: { width: 512, height: 512, channels: 4 } })
  .png({ compressionLevel: 9 })
  .toBuffer();
await writeFileSync(resolve(outDir, "icon-monochrome-512.png"), monoPng);

/** Favicon sizes come off the master too, so they track the rest. */
const faviconSizes = [16, 32, 48];
const faviconPngs = await Promise.all(
  faviconSizes.map(async (size) => ({
    size,
    data: await sharp(resolve(outDir, "d1.jpg"))
      .resize(size, size, { fit: "cover", kernel: "lanczos3" })
      .png({ compressionLevel: 9 })
      .toBuffer(),
  })),
);
await fromMaster("favicon-32.png", 32);

/**
 * `favicon.ico` is a container of PNGs, so it is assembled by hand. A size of
 * 256 or more is written as 0 in the directory entry, which is how the format
 * says "read the width from the image", and the offsets are relative to the
 * start of the file.
 */
const icoHeader = Buffer.alloc(6);
icoHeader.writeUInt16LE(1, 2);
icoHeader.writeUInt16LE(faviconPngs.length, 4);
const icoEntries = [];
let icoOffset = 6 + faviconPngs.length * 16;
for (const image of faviconPngs) {
  const entry = Buffer.alloc(16);
  entry[0] = image.size >= 256 ? 0 : image.size;
  entry[1] = image.size >= 256 ? 0 : image.size;
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(image.data.length, 8);
  entry.writeUInt32LE(icoOffset, 12);
  icoEntries.push(entry);
  icoOffset += image.data.length;
}
await writeFileSync(resolve(outDir, "..", "favicon.ico"), Buffer.concat([icoHeader, ...icoEntries, ...faviconPngs.map((i) => i.data)]));

console.log("d1.jpg written to " + resolve(outDir, "d1.jpg"));
console.log("icons written to " + outDir);

/**
 * No launch screens are generated here on purpose.
 *
 * This script used to write 24 `apple-touch-startup-image` PNGs into
 * `public/splash`, each a white field with a glow and the centred mark. They
 * were declared by the `<link>` tags in `src/lib/splash.ts`, and iOS still
 * needs `apple-touch-startup-image` to show anything but its own default.
 *
 * They are gone because a static launch image with its own background is what
 * the user asked to remove: the installed app opened on a branded screen and
 * then cut hard to the real UI. Without the links, iOS falls back to a plain
 * white launch field, which is the same colour as `background_color` in the
 * manifest and the first React paint, so there is nothing to hand off from.
 * That also keeps ~24 large PNGs out of the deployed bundle.
 */
