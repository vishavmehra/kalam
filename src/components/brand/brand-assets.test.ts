/**
 * Guards the brand rasters in assets/images (rendered by assets/images/src/render.mjs from kalam-mark.svg):
 * sizes and alpha, adaptive icon safe zone, single-colour monochrome layer, contrast, and that app.json and
 * scripts/build-pwa.mjs point at files that exist. It also runs `render.mjs --check` (the PNGs match the master SVG)
 * and the real build-pwa.mjs on a scratch dist (manifest, touch icon, precache), so none of that can drift unnoticed.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { decodePng, type DecodedPng } from '../../../assets/images/src/png.mjs';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const IMAGES = `${ROOT}assets/images/`;
const text = (path: string) => readFileSync(`${ROOT}${path}`, 'utf8');
const png = (file: string): DecodedPng => decodePng(readFileSync(`${IMAGES}${file}`));

const hex = (value: string): [number, number, number] => {
  const n = value.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16)) as [number, number, number];
};
const luminance = ([r, g, b]: [number, number, number]) => {
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};
/** WCAG 2.x contrast ratio between two hex colours. */
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(hex(a)), luminance(hex(b))].sort((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
};
const toHex = (r: number, g: number, b: number) =>
  `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`.toUpperCase();

const at = (img: DecodedPng, x: number, y: number) => {
  const o = (y * img.width + x) * 4;
  return [img.rgba[o] ?? 0, img.rgba[o + 1] ?? 0, img.rgba[o + 2] ?? 0, img.rgba[o + 3] ?? 0] as const;
};
const colorAt = (img: DecodedPng, x: number, y: number) => {
  const [r, g, b] = at(img, x, y);
  return toHex(r, g, b);
};

/** Farthest centre-to-pixel distance of anything drawn (alpha above 0, or colour different from `background`). */
function reach(img: DecodedPng, background?: string): number {
  const c = img.width / 2;
  let max = 0;
  for (let y = 0; y < img.height; y += 1) {
    for (let x = 0; x < img.width; x += 1) {
      const [r, g, b, a] = at(img, x, y);
      const drawn = background ? toHex(r, g, b) !== background : a > 0;
      if (drawn) max = Math.max(max, Math.hypot(x + 0.5 - c, y + 0.5 - c));
    }
  }
  return max;
}

/** Longest side of the box around everything that differs from the background colour. */
function longestSide(img: DecodedPng, background: string): number {
  let [x0, y0, x1, y1] = [img.width, img.height, 0, 0];
  for (let y = 0; y < img.height; y += 1) {
    for (let x = 0; x < img.width; x += 1) {
      if (colorAt(img, x, y) === background) continue;
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
  }
  return Math.max(x1 - x0 + 1, y1 - y0 + 1);
}

/** The most frequent exact colours among fully opaque pixels. */
function dominant(img: DecodedPng, count: number): string[] {
  const seen = new Map<string, number>();
  for (let i = 0; i < img.width * img.height; i += 1) {
    if (img.rgba[i * 4 + 3] !== 255) continue;
    const key = toHex(img.rgba[i * 4] ?? 0, img.rgba[i * 4 + 1] ?? 0, img.rgba[i * 4 + 2] ?? 0);
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  return [...seen.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, count)
    .map(([key]) => key);
}

// Tokens, read from source so the rasters cannot drift from the palette unnoticed.
const tokens = text('src/design/tokens.ts');
const token = (source: string, name: string) => {
  const m = source.match(new RegExp(`\\b${name}: '(#[0-9A-Fa-f]{6})'`));
  if (!m?.[1]) throw new Error(`token ${name} not found`);
  return m[1].toUpperCase();
};
// The icon keeps its own colours until it is redrawn for "Khata and Kalam" (tokens.ts iconColors).
const iconBlock = tokens.slice(tokens.indexOf('export const iconColors'));
const darkBlock = iconBlock.slice(iconBlock.indexOf('dark:'));
const INK = token(iconBlock, 'ink');
const MARIGOLD = token(iconBlock, 'marigold');
const PAPER = token(iconBlock, 'paper');
const DARK = {
  background: token(darkBlock, 'background'),
  splash: token(darkBlock, 'splash'),
  ink: token(darkBlock, 'primary'),
  marigold: token(darkBlock, 'accent'),
};

describe('master SVG', () => {
  const svg = text('assets/images/src/kalam-mark.svg');
  const logo = text('src/design/Logo.tsx');
  const pathOf = (id: string) => svg.match(new RegExp(`id="${id}"[^>]*\\sd="([^"]+)"`))?.[1];

  it.each(['stem', 'arm', 'leg'])('keeps the %s path identical to LOGO_PATHS in Logo.tsx', (id) => {
    const inLogo = logo.match(new RegExp(`${id}: '([^']+)'`))?.[1];
    expect(pathOf(id)).toBeTruthy();
    expect(pathOf(id)).toBe(inLogo);
  });

  it('keeps the dot identical to Logo.tsx', () => {
    const dot = svg.match(/id="dot" cx="([\d.]+)" cy="([\d.]+)" r="([\d.]+)"/);
    expect(dot?.slice(1).map(Number)).toEqual([39, 38.6, 2.6]);
    expect(logo).toContain('dot: { cx: 39, cy: 38.6, r: 2.6 }');
  });

  it('uses the ink and marigold of the palette', () => {
    expect(svg.match(/id="stem" fill="(#[0-9A-Fa-f]{6})"/)?.[1]?.toUpperCase()).toBe(INK);
    expect(svg.match(/id="dot"[^>]*fill="(#[0-9A-Fa-f]{6})"/)?.[1]?.toUpperCase()).toBe(MARIGOLD);
  });
});

describe('rasters: size and alpha', () => {
  // [file, side, has an alpha channel]. App Store icons must be opaque, so the iOS files carry none.
  const expected: Array<[string, number, boolean]> = [
    ['icon.png', 1024, false],
    ['icon-ios-dark.png', 1024, false],
    ['icon-ios-tinted.png', 1024, false],
    ['android-icon-foreground.png', 1024, true],
    ['android-icon-background.png', 1024, false],
    ['android-icon-monochrome.png', 1024, true],
    ['splash-icon.png', 1024, true],
    ['splash-icon-dark.png', 1024, true],
    ['favicon.png', 48, true],
    ['pwa-192.png', 192, true],
    ['pwa-512.png', 512, true],
    ['pwa-maskable-512.png', 512, false],
    ['apple-touch-icon.png', 180, false],
  ];

  it.each(expected)('%s is %i px square, alpha %s', (file, side, alpha) => {
    const img = png(file);
    expect([img.width, img.height]).toEqual([side, side]);
    expect(img.hasAlpha).toBe(alpha);
  });

  it('gives the rounded web tiles transparent corners and an opaque middle', () => {
    for (const file of ['favicon.png', 'pwa-192.png', 'pwa-512.png']) {
      const img = png(file);
      expect(at(img, 0, 0)[3]).toBe(0);
      expect(at(img, img.width - 1, img.height - 1)[3]).toBe(0);
      expect(at(img, 2, Math.floor(img.height / 2))[3]).toBe(255);
    }
  });

  it('has no Expo template images left over', () => {
    for (const file of ['expo-logo.png', 'expo-badge.png', 'react-logo.png', 'logo-glow.png', 'tutorial-web.png']) {
      expect(existsSync(`${IMAGES}${file}`)).toBe(false);
    }
  });
});

describe('Android adaptive icon', () => {
  const foreground = png('android-icon-foreground.png');
  const background = png('android-icon-background.png');
  const monochrome = png('android-icon-monochrome.png');
  // The launcher masks the 108dp layer; anything outside the central 66dp circle may be cut.
  const safeRadius = (66 / 108 / 2) * foreground.width;

  it('keeps all three layers the same size', () => {
    expect([background.width, monochrome.width]).toEqual([foreground.width, foreground.width]);
  });

  it('keeps the whole foreground inside the safe zone and still fills most of it', () => {
    const r = reach(foreground);
    expect(r).toBeLessThanOrEqual(safeRadius);
    expect(r).toBeGreaterThan(safeRadius * 0.85);
  });

  it('keeps the monochrome layer inside the safe zone as one colour', () => {
    expect(reach(monochrome)).toBeLessThanOrEqual(safeRadius);
    const visible = new Set<string>();
    let covered = 0;
    for (let i = 0; i < monochrome.width * monochrome.height; i += 1) {
      if ((monochrome.rgba[i * 4 + 3] ?? 0) === 0) continue;
      covered += 1;
      visible.add(`${monochrome.rgba[i * 4]},${monochrome.rgba[i * 4 + 1]},${monochrome.rgba[i * 4 + 2]}`);
    }
    expect([...visible]).toEqual(['0,0,0']);
    const share = covered / (monochrome.width * monochrome.height);
    expect(share).toBeGreaterThan(0.05); // a real shape, not a speck
    expect(share).toBeLessThan(0.3);
  });

  it('makes the background layer one flat ink colour, matching app.json', () => {
    expect(dominant(background, 2)).toEqual([INK]);
    const config = JSON.parse(text('app.json')) as { expo: { android: { adaptiveIcon: { backgroundColor: string } } } };
    expect(config.expo.android.adaptiveIcon.backgroundColor.toUpperCase()).toBe(INK);
  });

  it('has white and marigold in the foreground, both readable on the ink background', () => {
    expect(dominant(foreground, 3)).toEqual(expect.arrayContaining(['#FFFFFF', MARIGOLD]));
    expect(contrast('#FFFFFF', INK)).toBeGreaterThanOrEqual(7);
    expect(contrast(MARIGOLD, INK)).toBeGreaterThanOrEqual(3);
  });
});

describe('contrast of the finished art', () => {
  it.each([
    ['icon.png', INK, '#FFFFFF', MARIGOLD],
    ['icon-ios-dark.png', DARK.background, DARK.ink, DARK.marigold],
    ['apple-touch-icon.png', INK, '#FFFFFF', MARIGOLD],
    ['pwa-maskable-512.png', INK, '#FFFFFF', MARIGOLD],
  ])('%s: mark 7:1, dot 3:1 against its tile', (file, tile, mark, dot) => {
    const img = png(file);
    expect(colorAt(img, 1, 1)).toBe(tile);
    expect(dominant(img, 3)).toEqual(expect.arrayContaining([tile, mark, dot]));
    expect(contrast(mark, tile)).toBeGreaterThanOrEqual(7);
    expect(contrast(dot, tile)).toBeGreaterThanOrEqual(3);
  });

  it('draws the tinted iOS icon in greyscale on black', () => {
    const img = png('icon-ios-tinted.png');
    for (let i = 0; i < img.width * img.height; i += 1) {
      const [r, g, b] = [img.rgba[i * 4], img.rgba[i * 4 + 1], img.rgba[i * 4 + 2]];
      if (r !== g || g !== b) throw new Error(`pixel ${i} is not grey`);
    }
    expect(colorAt(img, 1, 1)).toBe('#000000');
  });

  it('puts the splash marks on the colours app.json paints behind them', () => {
    const light = png('splash-icon.png');
    const dark = png('splash-icon-dark.png');
    expect(dominant(light, 2)).toEqual(expect.arrayContaining([INK, MARIGOLD]));
    expect(dominant(dark, 2)).toEqual(expect.arrayContaining([DARK.ink, DARK.marigold]));
    expect(contrast(INK, PAPER)).toBeGreaterThanOrEqual(7);
    expect(contrast(DARK.ink, DARK.background)).toBeGreaterThanOrEqual(7);
    expect(contrast(DARK.marigold, DARK.background)).toBeGreaterThanOrEqual(3);
    expect(contrast(DARK.ink, DARK.splash)).toBeGreaterThanOrEqual(7);
    expect(contrast(DARK.marigold, DARK.splash)).toBeGreaterThanOrEqual(3);
    // The marigold dot on paper is only 1.8:1. It is decorative (the K carries the meaning), so it is not asserted.
  });
});

describe('placement of the mark', () => {
  it('keeps the Android 12 splash icon inside the circle the system cuts (2/3 of the image)', () => {
    for (const file of ['splash-icon.png', 'splash-icon-dark.png']) {
      const img = png(file);
      expect(reach(img)).toBeLessThanOrEqual(img.width / 3);
    }
  });

  it('keeps the maskable icon inside the safe circle of radius 0.4', () => {
    const img = png('pwa-maskable-512.png');
    expect(reach(img, INK)).toBeLessThanOrEqual(0.4 * img.width);
  });

  it('sizes the full-bleed icons so the K is 50 to 70 percent of the width', () => {
    for (const [file, tile] of [
      ['icon.png', INK],
      ['icon-ios-dark.png', DARK.background],
      ['apple-touch-icon.png', INK],
    ] as const) {
      const img = png(file);
      const side = longestSide(img, tile) / img.width;
      expect(side).toBeGreaterThan(0.5);
      expect(side).toBeLessThan(0.7);
    }
  });
});

describe('wiring', () => {
  const config = JSON.parse(text('app.json')) as {
    expo: {
      icon: string;
      ios: { icon: { light: string; dark: string; tinted: string } };
      android: { adaptiveIcon: { foregroundImage: string; backgroundImage: string; monochromeImage: string } };
      web: { favicon: string; themeColor: string; backgroundColor: string };
      plugins: Array<string | [string, Record<string, unknown>]>;
    };
  };
  const exists = (relative: string) => existsSync(`${ROOT}${relative.replace(/^\.\//, '')}`);
  const splash =
    config.expo.plugins.find(
      (p): p is [string, Record<string, unknown>] => Array.isArray(p) && p[0] === 'expo-splash-screen',
    )?.[1] ?? {};

  it('points every icon key in app.json at a file that exists', () => {
    const { icon, android, web } = config.expo;
    const paths = [
      icon,
      android.adaptiveIcon.foregroundImage,
      android.adaptiveIcon.backgroundImage,
      android.adaptiveIcon.monochromeImage,
      web.favicon,
      splash.image as string,
      (splash.dark as { image: string }).image,
    ];
    paths.forEach((p) => expect(exists(p), p).toBe(true));
  });

  it('gives iOS the light, dark and tinted icons', () => {
    expect(config.expo.ios.icon).toEqual({
      light: './assets/images/icon.png',
      dark: './assets/images/icon-ios-dark.png',
      tinted: './assets/images/icon-ios-tinted.png',
    });
    Object.values(config.expo.ios.icon).forEach((p) => expect(exists(p), p).toBe(true));
  });

  it('uses a 1024 opaque top-level icon and a 48 px favicon', () => {
    const icon = png('icon.png');
    expect([icon.width, icon.height, icon.hasAlpha]).toEqual([1024, 1024, false]);
    expect(png('favicon.png').width).toBe(48);
  });

  it('paints the splash on the paper and ink night canvas tokens', () => {
    expect(String(splash.backgroundColor).toUpperCase()).toBe(PAPER);
    expect(String((splash.dark as { backgroundColor: string }).backgroundColor).toUpperCase()).toBe(DARK.splash);
  });

  it('uses the paper token for the web theme and background colours', () => {
    expect(config.expo.web.themeColor.toUpperCase()).toBe(PAPER);
    expect(config.expo.web.backgroundColor.toUpperCase()).toBe(PAPER);
  });
});

describe('render.mjs', () => {
  it('finds every raster in step with the master SVG (node render.mjs --check)', () => {
    const run = spawnSync(process.execPath, [`${IMAGES}src/render.mjs`, '--check'], { encoding: 'utf8' });
    expect(run.status, `${run.stdout}${run.stderr}`).toBe(0);
    expect(run.stdout.match(/^ok /gm)).toHaveLength(13);
  }, 120_000);
});

describe('one palette', () => {
  const files = (dir: string): string[] =>
    readdirSync(`${ROOT}${dir}`, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? files(`${dir}/${e.name}`) : [`${dir}/${e.name}`],
    );
  const svgs = files('assets').filter((f) => f.endsWith('.svg'));
  // The forest green, ochre and cream of the first palette.
  const OLD = /#(315C4C|D69B52|F8F7F2|202820|151A17|F1F4EF)\b/i;

  it('keeps the three logo SVGs', () => {
    expect(svgs.sort()).toEqual(['assets/brand/logo.svg', 'assets/brand/mark.svg', 'assets/images/src/kalam-mark.svg']);
  });

  it.each([...svgs, 'app.json', 'scripts/build-pwa.mjs'])('%s holds no colour of the old green palette', (path) => {
    expect(text(path)).not.toMatch(OLD);
  });

  it.each(['assets/brand/logo.svg', 'assets/brand/mark.svg'])('%s draws the same K as the master', (path) => {
    const svg = text(path);
    const master = text('assets/images/src/kalam-mark.svg');
    for (const id of ['stem', 'arm', 'leg']) {
      const d = master.match(new RegExp(`id="${id}"[^>]*\\sd="([^"]+)"`))?.[1];
      expect(d).toBeTruthy();
      expect(svg).toContain(`d="${d}"`);
    }
    expect(svg).toContain('cx="39" cy="38.6" r="2.6"');
    expect(svg).toContain(`fill="${MARIGOLD}"`);
  });

  it('writes the wordmark in the ink text token', () => {
    expect(text('assets/brand/logo.svg')).toContain(token(iconBlock, 'inkText'));
  });
});

describe('build-pwa.mjs on a scratch dist', () => {
  const script = `${ROOT}scripts/build-pwa.mjs`;
  const run = (dist: string) => execFileSync(process.execPath, [script, dist], { encoding: 'utf8' });
  const html = '<!doctype html><html><head><title>Kalam</title></head><body><div id="root"></div></body></html>';
  let dist = '';
  let index = '';
  let manifest: {
    theme_color: string;
    background_color: string;
    icons: Array<{ src: string; sizes: string; type: string; purpose: string }>;
  };

  beforeAll(() => {
    dist = mkdtempSync(join(tmpdir(), 'kalam-pwa-'));
    writeFileSync(join(dist, 'index.html'), html);
    run(dist);
    index = readFileSync(join(dist, 'index.html'), 'utf8');
    manifest = JSON.parse(readFileSync(join(dist, 'manifest.webmanifest'), 'utf8'));
  }, 60_000);
  afterAll(() => rmSync(dist, { recursive: true, force: true }));

  it('lists the 192, 512 and maskable 512 icons with their real sizes and purposes', () => {
    expect(manifest.icons.map((i) => [i.sizes, i.purpose, i.type])).toEqual([
      ['192x192', 'any', 'image/png'],
      ['512x512', 'any', 'image/png'],
      ['512x512', 'maskable', 'image/png'],
    ]);
    const names = ['pwa-192', 'pwa-512', 'pwa-maskable-512'];
    manifest.icons.forEach((icon, i) => {
      expect(icon.src).toMatch(new RegExp(`^/icons/${names[i]}\\.[0-9a-f]{12}\\.png$`));
      expect(readFileSync(join(dist, icon.src)).equals(readFileSync(`${IMAGES}${names[i]}.png`))).toBe(true);
    });
  });

  it('paints the install colours with the paper token', () => {
    expect(manifest.theme_color.toUpperCase()).toBe(PAPER);
    expect(manifest.background_color.toUpperCase()).toBe(PAPER);
    expect(index.match(/<meta name="theme-color" content="([^"]+)"/)?.[1]?.toUpperCase()).toBe(PAPER);
  });

  it('links the manifest and one hashed apple-touch-icon in index.html', () => {
    expect(index.match(/rel="manifest"/g)).toHaveLength(1);
    const touch = [...index.matchAll(/<link rel="apple-touch-icon" href="([^"]+)"/g)].map((m) => m[1] as string);
    expect(touch).toHaveLength(1);
    expect(touch[0]).toMatch(/^\/icons\/apple-touch-icon\.[0-9a-f]{12}\.png$/);
    expect(readFileSync(join(dist, touch[0] as string)).equals(readFileSync(`${IMAGES}apple-touch-icon.png`))).toBe(
      true,
    );
  });

  it('precaches every icon in sw.js', () => {
    const sw = readFileSync(join(dist, 'sw.js'), 'utf8');
    const precache = JSON.parse(sw.match(/const PRECACHE = (\[.*\]);/)?.[1] ?? '[]') as string[];
    const touch = index.match(/rel="apple-touch-icon" href="([^"]+)"/)?.[1];
    [...manifest.icons.map((i) => i.src), touch].forEach((url) => expect(precache).toContain(url));
  });

  it('adds no second set of tags when it runs again', () => {
    run(dist);
    expect(readFileSync(join(dist, 'index.html'), 'utf8')).toBe(index);
  });
});
