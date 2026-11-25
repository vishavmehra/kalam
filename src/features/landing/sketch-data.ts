/**
 * The onboarding story, as data: a hand-drawn wireframe of a phone app (ink strokes) and the
 * rendered app it becomes. One source drives the WebGL hero (web), the Skia hero (Android) and
 * the static SVG fallback, so all three tell the same story. Coordinates are phone-screen units
 * (360 × 740), origin top-left. Deterministic: a seeded PRNG makes the "hand" identical each run.
 */

export const SCREEN = { w: 360, h: 740, r: 40 } as const;

/**
 * The sample app has its OWN theme (emerald + coral), deliberately unlike Kalam's ink + marigold
 * shell (docs/02 §12): a generated app never looks like Kalam.
 */
export const APP_COLORS = {
  primary: '#0B6B57',
  accent: '#FF8C69',
  bg: '#FFFFFF',
  surface: '#EDF6F2',
  line: '#CFE0D9',
  divider: '#E3EEE9',
  text: '#13201C',
  muted: '#566B63',
  onPrimary: '#FFFFFF',
} as const;

/** Pen ink (blue-black) and the marigold highlighter, matching Kalam's palette (docs/02 §5). */
export const INK = { ink: '#1E2563', accent: '#F2AE1C' } as const;

// ─── Rendered app (drawn by canvas on web, SVG elsewhere) ─────────────────────
export type UIPrim =
  | { kind: 'rect'; x: number; y: number; w: number; h: number; r: number; fill?: string; stroke?: string }
  | { kind: 'circle'; cx: number; cy: number; r: number; fill: string }
  | { kind: 'line'; x1: number; y1: number; x2: number; y2: number; stroke: string }
  | { kind: 'text'; x: number; y: number; text: string; size: number; weight: 400 | 500 | 600 | 700; fill: string; anchor?: 'start' | 'middle' | 'end' };

const C = APP_COLORS;
const ROWS: Array<[string, string]> = [['Tea & snacks', '₹ 60'], ['Auto rickshaw', '₹ 120'], ['Groceries', '₹ 845']];

export const APP_UI: UIPrim[] = [
  { kind: 'rect', x: 0, y: 0, w: 360, h: 740, r: 0, fill: C.bg },
  { kind: 'rect', x: 0, y: 0, w: 360, h: 124, r: 0, fill: C.primary },
  { kind: 'text', x: 24, y: 54, text: 'November', size: 13, weight: 500, fill: 'rgba(255,255,255,0.78)' },
  { kind: 'text', x: 24, y: 88, text: 'Daily expenses', size: 25, weight: 700, fill: C.onPrimary },
  { kind: 'rect', x: 20, y: 144, w: 320, h: 120, r: 18, fill: C.surface },
  { kind: 'text', x: 40, y: 182, text: 'Spent this month', size: 13, weight: 500, fill: C.muted },
  { kind: 'text', x: 40, y: 236, text: '₹ 12,480', size: 38, weight: 700, fill: C.text },
  { kind: 'rect', x: 250, y: 166, w: 72, h: 26, r: 13, fill: C.accent },
  { kind: 'text', x: 286, y: 184, text: '+ ₹ 60', size: 12, weight: 600, fill: C.text, anchor: 'middle' },
  { kind: 'rect', x: 20, y: 288, w: 320, h: 56, r: 12, fill: C.bg, stroke: C.line },
  { kind: 'text', x: 38, y: 321, text: 'Amount', size: 15, weight: 400, fill: C.muted },
  { kind: 'rect', x: 20, y: 356, w: 320, h: 56, r: 12, fill: C.bg, stroke: C.line },
  { kind: 'text', x: 38, y: 389, text: 'Category', size: 15, weight: 400, fill: C.muted },
  { kind: 'rect', x: 20, y: 428, w: 320, h: 56, r: 14, fill: C.primary },
  { kind: 'text', x: 180, y: 462, text: 'Add expense', size: 16, weight: 600, fill: C.onPrimary, anchor: 'middle' },
  { kind: 'text', x: 24, y: 524, text: 'Today', size: 13, weight: 600, fill: C.muted },
  ...ROWS.flatMap(([name, amount], i): UIPrim[] => {
    const y = 536 + i * 60;
    return [
      { kind: 'circle', cx: 42, cy: y + 26, r: 16, fill: C.surface },
      { kind: 'text', x: 70, y: y + 31, text: name, size: 15, weight: 500, fill: C.text },
      { kind: 'text', x: 336, y: y + 31, text: amount, size: 15, weight: 600, fill: C.text, anchor: 'end' },
      ...(i < ROWS.length - 1 ? [{ kind: 'line', x1: 24, y1: y + 56, x2: 336, y2: y + 56, stroke: C.divider } as UIPrim] : []),
    ];
  }),
];

// ─── Hand-drawn strokes ───────────────────────────────────────────────────────
export type Pt = [number, number];
export interface InkStroke {
  points: Pt[];
  width: number;
  color: keyof typeof INK;
  /** Seconds from the start of the drawing when this stroke begins / its duration. */
  start: number;
  duration: number;
}

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function length(pts: Pt[]): number {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return l;
}

/** Low-frequency perpendicular wobble — the difference between a ruler and a hand. */
function wobble(pts: Pt[], rnd: () => number, amp: number): Pt[] {
  const p1 = rnd() * 6.28, p2 = rnd() * 6.28, f1 = 0.8 + rnd() * 1.2, f2 = 2.5 + rnd() * 2;
  const total = length(pts) || 1;
  let acc = 0;
  return pts.map((p, i) => {
    if (i > 0) acc += Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]);
    const prev = pts[Math.max(0, i - 1)], next = pts[Math.min(pts.length - 1, i + 1)];
    let nx = -(next[1] - prev[1]), ny = next[0] - prev[0];
    const nl = Math.hypot(nx, ny) || 1; nx /= nl; ny /= nl;
    const s = acc / total;
    const o = amp * (Math.sin(s * 6.28 * f1 + p1) * 0.7 + Math.sin(s * 6.28 * f2 + p2) * 0.3);
    return [p[0] + nx * o, p[1] + ny * o];
  });
}

/** Rounded-rect perimeter starting near the top-left, with a slight overshoot at the end. */
function roundedRect(x: number, y: number, w: number, h: number, r: number, step = 4, overshoot = 0.04): Pt[] {
  const segs: Array<(t: number) => Pt> = [];
  const lens: number[] = [];
  const line = (a: Pt, b: Pt) => { segs.push((t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); lens.push(Math.hypot(b[0] - a[0], b[1] - a[1])); };
  const arc = (cx: number, cy: number, a0: number) => { segs.push((t) => [cx + r * Math.cos(a0 + t * Math.PI / 2), cy + r * Math.sin(a0 + t * Math.PI / 2)]); lens.push((Math.PI / 2) * r); };
  line([x + r, y], [x + w - r, y]); arc(x + w - r, y + r, -Math.PI / 2);
  line([x + w, y + r], [x + w, y + h - r]); arc(x + w - r, y + h - r, 0);
  line([x + w - r, y + h], [x + r, y + h]); arc(x + r, y + h - r, Math.PI / 2);
  line([x, y + h - r], [x, y + r]); arc(x + r, y + r, Math.PI);
  const total = lens.reduce((a, b) => a + b, 0);
  const out: Pt[] = [];
  const end = total * (1 + overshoot);
  for (let d = 0; d <= end; d += step) {
    let rem = d % total, i = 0;
    while (i < lens.length - 1 && rem > lens[i]) { rem -= lens[i]; i++; }
    out.push(segs[i](Math.min(1, rem / lens[i])));
  }
  return out;
}

function lineSeg(a: Pt, b: Pt, step = 4): Pt[] {
  const n = Math.max(2, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
  return Array.from({ length: n + 1 }, (_, i) => [a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n] as Pt);
}

/** Cursive scribble standing in for handwritten words (prolate-cycloid loops). One stroke per word. */
function scribble(x0: number, x1: number, base: number, h: number, rnd: () => number, words = 2): Pt[][] {
  const gap = h * 0.7;
  const span = x1 - x0 - gap * (words - 1);
  const weights = Array.from({ length: words }, () => 0.6 + rnd() * 0.8);
  const wsum = weights.reduce((a, b) => a + b, 0);
  let cx = x0;
  return weights.map((wt) => {
    const ww = (span * wt) / wsum;
    const letters = Math.max(2, Math.round(ww / (h * 0.62)));
    const T = letters * Math.PI * 2;
    const r = h * 0.2;
    const pts: Pt[] = [];
    for (let t = 0; t <= T; t += 0.45) {
      const k = Math.floor(t / (Math.PI * 2));
      const tall = (k * 7 + Math.floor(rnd() * 3)) % 4 === 0 ? 1.45 : 1;
      const x = cx + (ww * t) / T - r * Math.sin(t);
      const y = base - h * tall * (0.5 - 0.5 * Math.cos(t)) * (0.8 + 0.2 * Math.sin(t * 0.37));
      pts.push([x, y]);
    }
    cx += ww + gap;
    return pts;
  });
}

function ellipse(cx: number, cy: number, rx: number, ry: number, turns: number, start: number): Pt[] {
  const pts: Pt[] = [];
  for (let a = 0; a <= turns * Math.PI * 2; a += 0.06) {
    const drift = 1 + a * 0.012;
    pts.push([cx + rx * drift * Math.cos(a + start), cy + ry * drift * Math.sin(a + start)]);
  }
  return pts;
}

/** Total length of the drawing phase in seconds. */
export const DRAW_SECONDS = 3.4;

let cache: InkStroke[] | undefined;

/** The wireframe sketch, timed so strokes draw in sequence over DRAW_SECONDS. */
export function buildSketch(): InkStroke[] {
  if (cache) return cache;
  const rnd = mulberry32(20261117);
  const raw: Array<{ points: Pt[]; width: number; color: keyof typeof INK; speed: number }> = [];
  const add = (points: Pt[], width: number, speed = 900, amp = 1.4, color: keyof typeof INK = 'ink') =>
    raw.push({ points: wobble(points, rnd, amp), width, color, speed });
  const words = (x0: number, x1: number, base: number, h: number, n: number, w = 2) =>
    scribble(x0, x1, base, h, rnd, n).forEach((p) => add(p, w, 520, 0.6));

  add(roundedRect(-16, -16, 392, 772, 54, 5), 3.4, 1500, 2.2);
  add(lineSeg([2, 126], [358, 122]), 2.6, 1100);
  words(24, 210, 86, 17, 2, 2.6);
  words(24, 96, 54, 8, 1, 1.8);
  add(roundedRect(20, 144, 320, 120, 18), 2.6, 1100);
  words(40, 150, 182, 8, 2, 1.8);
  words(40, 196, 234, 26, 2, 3.2);
  add(roundedRect(20, 288, 320, 56, 12), 2.4, 1200);
  words(38, 104, 322, 9, 1, 1.8);
  add(roundedRect(20, 356, 320, 56, 12), 2.4, 1200);
  words(38, 116, 390, 9, 1, 1.8);
  add(roundedRect(20, 428, 320, 56, 14), 2.6, 1200);
  for (let i = 0; i < 5; i++) add(lineSeg([34 + i * 16, 476], [52 + i * 16, 436]), 1.6, 700, 0.4);
  words(132, 232, 462, 10, 2, 2);
  words(24, 70, 524, 8, 1, 1.8);
  ROWS.forEach((_, i) => {
    const y = 536 + i * 60;
    add(ellipse(42, y + 26, 14, 14, 1.05, -1.2), 2, 900, 0.5);
    words(70, 170 + rnd() * 30, y + 31, 9, 2, 1.8);
    words(292, 336, y + 31, 9, 1, 2);
    if (i < ROWS.length - 1) add(lineSeg([24, y + 56], [336, y + 57]), 1.6, 1300, 0.8);
  });
  // The marigold highlighter loop around the total — the one thing the "hand" emphasises.
  add(ellipse(120, 212, 118, 46, 1.12, 2.6), 5, 650, 1.6, 'accent');

  const gap = 0.05;
  const rawTimes = raw.map((s) => length(s.points) / s.speed);
  const total = rawTimes.reduce((a, b) => a + b + gap, 0);
  const k = DRAW_SECONDS / total;
  let t = 0;
  cache = raw.map((s, i) => {
    const stroke: InkStroke = { points: s.points, width: s.width, color: s.color, start: t * k, duration: rawTimes[i] * k };
    t += rawTimes[i] + gap;
    return stroke;
  });
  return cache;
}

/** Per-point ink width: blunt start, tapered tail, slight pressure variation. */
export function inkWidths(stroke: InkStroke): number[] {
  const n = stroke.points.length;
  return stroke.points.map((_, i) => {
    const s = n > 1 ? i / (n - 1) : 0;
    const head = 0.6 + 0.4 * Math.min(1, s / 0.05);
    const tail = 0.3 + 0.7 * Math.min(1, (1 - s) / 0.2);
    const pressure = 0.92 + 0.08 * Math.sin(i * 0.9);
    return stroke.width * head * tail * pressure;
  });
}

/** Left/right offset polylines of a stroke ribbon (shared by WebGL mesh + SVG outline). */
export function ribbon(stroke: InkStroke): { left: Pt[]; right: Pt[] } {
  const pts = stroke.points;
  const w = inkWidths(stroke);
  const left: Pt[] = [], right: Pt[] = [];
  pts.forEach((p, i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    let nx = -(b[1] - a[1]), ny = b[0] - a[0];
    const l = Math.hypot(nx, ny) || 1; nx /= l; ny /= l;
    const h = w[i] / 2;
    left.push([p[0] + nx * h, p[1] + ny * h]);
    right.push([p[0] - nx * h, p[1] - ny * h]);
  });
  return { left, right };
}

const f = (n: number) => n.toFixed(1);

/** Filled SVG path of a stroke's ink outline (static illustration). */
export function strokeOutlinePath(stroke: InkStroke): string {
  const { left, right } = ribbon(stroke);
  const pts = [...left, ...right.reverse()];
  return `M${pts.map((p) => `${f(p[0])} ${f(p[1])}`).join('L')}Z`;
}

/** Centre-line SVG path (Skia path trimming on Android). */
export function strokeCenterPath(stroke: InkStroke): string {
  return `M${stroke.points.map((p) => `${f(p[0])} ${f(p[1])}`).join('L')}`;
}
