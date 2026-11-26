/**
 * Renders every raster brand asset in assets/images from the one master, assets/images/src/kalam-mark.svg.
 *
 *   node assets/images/src/render.mjs            write the PNGs
 *   node assets/images/src/render.mjs --check    render in memory, compare the pixels with the files on disk, exit 1 on a difference
 *
 * Rasteriser: Skia through canvaskit-wasm. It already ships with @shopify/react-native-skia (the Drawing Studio
 * uses it on the web), so there is no new package and no browser. Each size is drawn from the vector paths at
 * that size, never scaled down from a bigger bitmap, so small icons stay crisp. Output is deterministic.
 *
 * Geometry comes from the master (ids stem, arm, leg, dot). Colours: the master holds the light theme (charcoal
 * and saffron); the dark and tinted variants below repeat the dark icon tokens of src/design/tokens.ts, and
 * src/components/brand/brand-assets.test.ts fails if they drift.
 */
import { Buffer } from 'node:buffer';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { decodePng, encodePng } from './png.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..');
const require = createRequire(import.meta.url);

/** Dark icon tokens (iconColors.dark.background, .primary, .accent in src/design/tokens.ts): charcoal tile, cream K, saffron full stop. */
export const DARK = { background: '#1C1A18', ink: '#F5F1EA', marigold: '#F06A4F' };
const WHITE = '#FFFFFF';

/**
 * Where the mark may sit, as a fraction of the canvas width. Android keeps adaptive icon art inside a circle of
 * 66dp on the 108dp layer (radius 0.3056) and cuts the Android 12 splash icon to a circle of two thirds of the
 * image (radius 0.3333); the PWA maskable spec allows a circle of radius 0.4. A "radius" fit measures the farthest
 * point of the mark from its centre, so the whole drawing (not just its box) stays inside the circle.
 * brand-assets.test.ts measures the finished PNGs against the same limits.
 */
const ADAPTIVE_FIT = 0.29; // a little inside the limit
const MASKABLE_FIT = 0.36;

/** Reads the geometry and light-theme colours out of the master SVG. */
export function readMaster(svg = readFileSync(join(HERE, 'kalam-mark.svg'), 'utf8')) {
  const element = (id) => {
    const m = svg.match(new RegExp(`<(?:path|circle) id="${id}"([^>]*?)/?>`));
    if (!m) throw new Error(`kalam-mark.svg has no element with id "${id}"`);
    return m[1];
  };
  const attr = (source, name) => {
    const m = source.match(new RegExp(`\\s${name}="([^"]*)"`));
    if (!m) throw new Error(`kalam-mark.svg: missing attribute ${name}`);
    return m[1];
  };
  const [stem, arm, leg, dot] = ['stem', 'arm', 'leg', 'dot'].map(element);
  return {
    stem: attr(stem, 'd'),
    arm: { d: attr(arm, 'd'), width: Number(attr(arm, 'stroke-width')) },
    leg: attr(leg, 'd'),
    dot: { cx: Number(attr(dot, 'cx')), cy: Number(attr(dot, 'cy')), r: Number(attr(dot, 'r')) },
    ink: attr(stem, 'fill'),
    marigold: attr(dot, 'fill'),
  };
}

/** Every file this script writes. `fit` is { max } (longest side of the mark) or { radius }, both as a fraction of the canvas. */
export function targets(master) {
  const { ink, marigold } = master;
  return [
    // iOS and the Expo top-level icon: opaque, full bleed, the system rounds the corners.
    { file: 'icon.png', size: 1024, alpha: false, tile: ink, fit: { max: 0.6 }, ink: WHITE, dot: marigold },
    {
      file: 'icon-ios-dark.png',
      size: 1024,
      alpha: false,
      tile: DARK.background,
      fit: { max: 0.6 },
      ink: DARK.ink,
      dot: DARK.marigold,
    },
    // Apple tinted icons are greyscale on black; the system colours them.
    {
      file: 'icon-ios-tinted.png',
      size: 1024,
      alpha: false,
      tile: '#000000',
      fit: { max: 0.6 },
      ink: WHITE,
      dot: '#B3B3B3',
    },
    // Android adaptive icon: three 1024 layers; the launcher masks the 108dp canvas to a circle, squircle or square.
    {
      file: 'android-icon-foreground.png',
      size: 1024,
      alpha: true,
      tile: null,
      fit: { radius: ADAPTIVE_FIT },
      ink: WHITE,
      dot: marigold,
    },
    { file: 'android-icon-background.png', size: 1024, alpha: false, tile: ink, fit: null },
    // Themed icon (Android 13+): one colour, the launcher reads only the alpha channel.
    {
      file: 'android-icon-monochrome.png',
      size: 1024,
      alpha: true,
      tile: null,
      fit: { radius: ADAPTIVE_FIT },
      ink: '#000000',
      dot: '#000000',
    },
    // Splash: the mark alone on a transparent canvas, the plugin paints the background colour.
    { file: 'splash-icon.png', size: 1024, alpha: true, tile: null, fit: { radius: ADAPTIVE_FIT }, ink, dot: marigold },
    {
      file: 'splash-icon-dark.png',
      size: 1024,
      alpha: true,
      tile: null,
      fit: { radius: ADAPTIVE_FIT },
      ink: DARK.ink,
      dot: DARK.marigold,
    },
    // Web: a rounded tile with transparent corners reads on light and dark tab strips alike.
    {
      file: 'favicon.png',
      size: 48,
      alpha: true,
      tile: ink,
      corner: 0.25,
      fit: { max: 0.68 },
      ink: WHITE,
      dot: marigold,
    },
    {
      file: 'pwa-192.png',
      size: 192,
      alpha: true,
      tile: ink,
      corner: 0.25,
      fit: { max: 0.6 },
      ink: WHITE,
      dot: marigold,
    },
    {
      file: 'pwa-512.png',
      size: 512,
      alpha: true,
      tile: ink,
      corner: 0.25,
      fit: { max: 0.6 },
      ink: WHITE,
      dot: marigold,
    },
    {
      file: 'pwa-maskable-512.png',
      size: 512,
      alpha: false,
      tile: ink,
      fit: { radius: MASKABLE_FIT },
      ink: WHITE,
      dot: marigold,
    },
    { file: 'apple-touch-icon.png', size: 180, alpha: false, tile: ink, fit: { max: 0.6 }, ink: WHITE, dot: marigold },
  ];
}

/** Box of the mark in master units, and the farthest point from the box centre (control points bound the curves). */
function measure(CK, master) {
  const paths = [master.stem, master.arm.d, master.leg].map((d) => CK.Path.MakeFromSVGString(d));
  const [stem, arm, leg] = paths;
  const inflate = master.arm.width / 2;
  const boxes = [
    Array.from(stem.computeTightBounds()),
    Array.from(arm.computeTightBounds()).map((v, i) => (i < 2 ? v - inflate : v + inflate)),
    Array.from(leg.computeTightBounds()),
    [
      master.dot.cx - master.dot.r,
      master.dot.cy - master.dot.r,
      master.dot.cx + master.dot.r,
      master.dot.cy + master.dot.r,
    ],
  ];
  const left = Math.min(...boxes.map((b) => b[0]));
  const top = Math.min(...boxes.map((b) => b[1]));
  const right = Math.max(...boxes.map((b) => b[2]));
  const bottom = Math.max(...boxes.map((b) => b[3]));
  const cx = (left + right) / 2;
  const cy = (top + bottom) / 2;
  let reach = master.dot.r + Math.hypot(master.dot.cx - cx, master.dot.cy - cy);
  [
    [stem, 0],
    [arm, inflate],
    [leg, 0],
  ].forEach(([path, extra]) => {
    for (let i = 0; i < path.countPoints(); i += 1) {
      const [x, y] = path.getPoint(i);
      reach = Math.max(reach, Math.hypot(x - cx, y - cy) + extra);
    }
  });
  paths.forEach((p) => p.delete());
  return { cx, cy, width: right - left, height: bottom - top, reach };
}

function drawTarget(CK, master, box, t) {
  const surface = CK.MakeSurface(t.size, t.size);
  if (!surface) throw new Error('canvaskit could not create a raster surface');
  const canvas = surface.getCanvas();
  canvas.clear(CK.TRANSPARENT);
  const paint = new CK.Paint();
  paint.setAntiAlias(true);
  const color = (hex) => CK.parseColorString(hex);

  if (t.tile) {
    paint.setColor(color(t.tile));
    if (t.corner) {
      const r = t.size * t.corner;
      canvas.drawRRect(CK.RRectXY(CK.LTRBRect(0, 0, t.size, t.size), r, r), paint);
    } else {
      canvas.drawRect(CK.LTRBRect(0, 0, t.size, t.size), paint);
    }
  }

  if (t.fit) {
    const scale = t.fit.max
      ? (t.fit.max * t.size) / Math.max(box.width, box.height)
      : (t.fit.radius * t.size) / box.reach;
    canvas.save();
    canvas.translate(t.size / 2, t.size / 2);
    canvas.scale(scale, scale);
    canvas.translate(-box.cx, -box.cy);
    const stem = CK.Path.MakeFromSVGString(master.stem);
    const arm = CK.Path.MakeFromSVGString(master.arm.d);
    const leg = CK.Path.MakeFromSVGString(master.leg);
    paint.setColor(color(t.ink));
    canvas.drawPath(stem, paint);
    canvas.drawPath(leg, paint);
    paint.setStyle(CK.PaintStyle.Stroke);
    paint.setStrokeWidth(master.arm.width);
    paint.setStrokeCap(CK.StrokeCap.Round);
    canvas.drawPath(arm, paint);
    paint.setStyle(CK.PaintStyle.Fill);
    paint.setColor(color(t.dot));
    canvas.drawCircle(master.dot.cx, master.dot.cy, master.dot.r, paint);
    canvas.restore();
    [stem, arm, leg].forEach((p) => p.delete());
  }

  const image = surface.makeImageSnapshot();
  const rgba = image.readPixels(0, 0, {
    width: t.size,
    height: t.size,
    colorType: CK.ColorType.RGBA_8888,
    alphaType: CK.AlphaType.Unpremul,
    colorSpace: CK.ColorSpace.SRGB,
  });
  image.delete();
  paint.delete();
  surface.delete();
  return encodePng({ width: t.size, height: t.size, rgba: new Uint8Array(rgba), alpha: t.alpha });
}

/** Same image? Compares decoded pixels, so a different zlib build (Node version, CPU) cannot make a file look stale. */
function samePixels(a, b) {
  const [x, y] = [decodePng(a), decodePng(b)];
  return (
    x.width === y.width &&
    x.height === y.height &&
    x.hasAlpha === y.hasAlpha &&
    Buffer.from(x.rgba).equals(Buffer.from(y.rgba))
  );
}

/** Renders every target and returns [{ file, png }]. */
export async function renderAll() {
  let CanvasKitInit;
  let wasmDir;
  try {
    CanvasKitInit = require('canvaskit-wasm');
    wasmDir = dirname(require.resolve('canvaskit-wasm'));
  } catch {
    throw new Error('canvaskit-wasm not found. It is installed with @shopify/react-native-skia; run npm ci first.');
  }
  const CK = await CanvasKitInit({ locateFile: (name) => join(wasmDir, name) });
  const master = readMaster();
  const box = measure(CK, master);
  return targets(master).map((t) => ({ file: t.file, png: drawTarget(CK, master, box, t) }));
}

async function main() {
  const check = process.argv.includes('--check');
  const rendered = await renderAll();
  let stale = 0;
  for (const { file, png } of rendered) {
    const path = join(OUT, file);
    if (check) {
      const same = existsSync(path) && samePixels(readFileSync(path), png);
      if (!same) stale += 1;
      console.log(`${same ? 'ok   ' : 'STALE'} ${file}`);
    } else {
      writeFileSync(path, png);
      console.log(`wrote ${file} (${png.length} bytes)`);
    }
  }
  if (stale) {
    console.error(`${stale} raster(s) differ from the master. Run: node assets/images/src/render.mjs`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
