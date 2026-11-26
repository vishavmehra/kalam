/**
 * The landing story as data ("Khata and Kalam", DIRECTION §4, owner override 2026-11-25): a pen writes a Hindi
 * tailor's order book on paper, Kalam reads each field with a red pen, the inputs fly into a tilted phone, the
 * order-book app appears with real values, the Checked stamp lands and the app keeps saving with no signal.
 * One source drives the WebGL hero (web), the Reanimated hero (Android, iOS) and the still frame.
 *
 * The Hindi on the page and in the phone is example data in the example app's own language. It is not Kalam's
 * interface, so it is not translated. Pure TypeScript.
 */
import { graphemes } from '@/i18n/graphemes';

// ─── The page (assets/images/brand/hero-sketch-tailor.webp, 480 × 600 at 1x) ────────────────────────────────

export const PAGE_ASPECT = 480 / 600;

export type FieldKey = 'title' | 'name' | 'phone' | 'cloth' | 'size' | 'date' | 'money' | 'balance' | 'save';

export interface Box { x: number; y: number; w: number; h: number }

/** Where each handwritten field sits, as fractions of the page (hero-sketch-tailor.fields.json). */
export const FIELDS: Record<FieldKey, Box> = {
  title: { x: 0.1369, y: 0.1441, w: 0.3863, h: 0.0858 },
  name: { x: 0.1439, y: 0.285, w: 0.777, h: 0.0529 },
  phone: { x: 0.1394, y: 0.3593, w: 0.7816, h: 0.0587 },
  cloth: { x: 0.1402, y: 0.44, w: 0.5321, h: 0.0559 },
  size: { x: 0.1397, y: 0.5169, w: 0.6252, h: 0.0574 },
  date: { x: 0.1415, y: 0.5954, w: 0.7795, h: 0.0561 },
  money: { x: 0.1365, y: 0.673, w: 0.6061, h: 0.058 },
  balance: { x: 0.1408, y: 0.7511, w: 0.5791, h: 0.0582 },
  save: { x: 0.1391, y: 0.8589, w: 0.1798, h: 0.057 },
};

/** The order the pen writes in, top to bottom. */
export const WRITE_ORDER: readonly FieldKey[] = ['title', 'name', 'phone', 'cloth', 'size', 'date', 'money', 'balance', 'save'];

/** Fixed object colours (DIRECTION §2.3): the pen marks on photographed paper look the same in both themes. */
export const PEN_RED = '#C8322A';
export const PEN_INK = '#1F3A93';
export const STAMP_VIOLET = '#5B3BB5';

/** Where the Checked stamp lands on the page: the empty lower right, clear of every field. */
export const STAMP_ON_PAGE = { cx: 0.68, cy: 0.905, w: 0.36, rotate: -8 } as const;

// ─── Timing (seconds) ───────────────────────────────────────────────────────────────────────────────────────

/** Story beats. Writing is linear (a nib moves at constant speed); everything else eases. About 9.7 s in all. */
export const T = {
  inputsIn: 0.05,
  write: 0.4,
  read: 4.25,
  pull: 5.0,
  reveal: 5.55,
  typeName: 6.45,
  roll: 6.9,
  stamp: 7.8,
  route: 8.4,
  offline: 9.1,
  end: 9.7,
} as const;

/** Seconds of pen time per field: the title is big, the save button is one word. */
const WRITE_SECONDS: Record<FieldKey, number> = {
  title: 0.7, name: 0.28, phone: 0.28, cloth: 0.4, size: 0.38, date: 0.3, money: 0.38, balance: 0.38, save: 0.18,
};
/** The pen lifts and moves to the next line between fields. */
const PEN_GAP = 0.06;

export interface Timed { key: FieldKey; start: number; duration: number }

/** When the pen writes each field. Contiguous, in WRITE_ORDER, starting at T.write and ending before T.read. */
export const WRITE_SCHEDULE: readonly Timed[] = (() => {
  let t: number = T.write;
  return WRITE_ORDER.map((key) => {
    const item = { key, start: t, duration: WRITE_SECONDS[key] };
    t += WRITE_SECONDS[key] + PEN_GAP;
    return item;
  });
})();

/** The red-pen underlines Kalam draws while it reads each field (the title is a heading, not a field). */
export const READ_SCHEDULE: readonly Timed[] = WRITE_ORDER.filter((k) => k !== 'title').map((key, i) => ({
  key, start: T.read + i * 0.09, duration: 0.3,
}));

export function clamp01(v: number): number {
  'worklet';
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** 0..1 progress of a timed item at time t. */
export function progressAt(item: Timed, t: number): number {
  'worklet';
  return clamp01((t - item.start) / item.duration);
}

export interface PenPose {
  /** Nib tip on the page, fractions. */
  x: number;
  y: number;
  /** True while ink is flowing. */
  down: boolean;
  /** 0 hidden (before it arrives, after it leaves), 1 on the page. */
  shown: number;
}

function tipY(b: Box): number {
  'worklet';
  return b.y + b.h * 0.7;
}

/**
 * The nib's position at time t: on the writing front of the current field, gliding between fields, arriving
 * before the first and leaving after the last. A small up-and-down mimics handwriting.
 */
export function penAt(t: number): PenPose {
  'worklet';
  const first = WRITE_SCHEDULE[0]!;
  const last = WRITE_SCHEDULE[WRITE_SCHEDULE.length - 1]!;
  const b0 = FIELDS[first.key];
  if (t < first.start) {
    const a = clamp01((t - (first.start - 0.35)) / 0.35);
    return { x: b0.x + (1 - a) * 0.3, y: tipY(b0) - (1 - a) * 0.12, down: false, shown: a };
  }
  for (let i = 0; i < WRITE_SCHEDULE.length; i++) {
    const s = WRITE_SCHEDULE[i]!;
    const b = FIELDS[s.key];
    if (t <= s.start + s.duration) {
      const p = progressAt(s, t);
      const wiggle = Math.sin(p * s.duration * 46) * b.h * 0.18;
      return { x: b.x + p * b.w, y: tipY(b) - b.h * 0.25 + wiggle, down: true, shown: 1 };
    }
    const next = WRITE_SCHEDULE[i + 1];
    if (next && t < next.start) {
      const a = clamp01((t - (s.start + s.duration)) / PEN_GAP);
      const n = FIELDS[next.key];
      return { x: b.x + b.w + (n.x - b.x - b.w) * a, y: tipY(b) + (tipY(n) - tipY(b)) * a, down: false, shown: 1 };
    }
  }
  const bl = FIELDS[last.key];
  const a = clamp01((t - (last.start + last.duration)) / 0.4);
  return { x: bl.x + bl.w + a * 0.35, y: tipY(bl) - a * 0.2, down: false, shown: 1 - a };
}

/** The four steps under the hero: reads your page, turns it into an app, checks it, keeps it on your phone. */
export function stepAt(t: number): 0 | 1 | 2 | 3 {
  'worklet';
  if (t < T.pull) return 0;
  if (t < T.stamp) return 1;
  if (t < T.route) return 2;
  return 3;
}

// ─── The example app (Calm green, its own theme; never Kalam's) ─────────────────────────────────────────────

export const ORDER = {
  customer: 'सुनीता शर्मा',
  phone: '98210 45367',
  total: 850,
  advance: 500,
} as const;

/** "अपने आप": the balance is a formula, total minus advance. */
export const BALANCE = ORDER.total - ORDER.advance;

/** The customer's name as typed so far (whole graphemes, so a vowel sign never dangles). */
export function typedName(p: number): string {
  const g = graphemes(ORDER.customer);
  return g.slice(0, Math.round(clamp01(p) * g.length)).join('');
}

/** The balance rolling up to its value, easing out. */
export function rolledBalance(p: number): number {
  const e = 1 - (1 - clamp01(p)) ** 3;
  return Math.round(e * BALANCE);
}

export const rupees = (n: number) => `₹${n.toLocaleString('en-IN')}`;

/** The date line of the Checked stamp, as a rubber-stamp dater prints it: "25 NOV 2026". */
export function stampDate(locale: string, date = new Date()): string {
  try {
    return date.toLocaleDateString(locale, { day: '2-digit', month: 'short', year: 'numeric' }).replace(/[.,]/g, '').toUpperCase();
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

export const APP_THEME = {
  primary: '#2F6B4F', primarySoft: '#E2EEE7', bg: '#F6F7F3', field: '#FFFFFF', line: '#CBD6CF',
  text: '#13201C', muted: '#56665E', onPrimary: '#FFFFFF', chrome: '#FCFCFA', chromeInk: '#12172E',
  leaf: '#1C6E43', toast: '#18241F', toastCheck: '#7FD3A6', device: '#0E1222', notch: '#05060C',
} as const;

/** Phone screen in app units. The body adds `BEZEL` on every side. */
export const SCREEN = { w: 360, h: 640, r: 40 } as const;
export const BEZEL = 12;
export const PHONE_ASPECT = (SCREEN.w + BEZEL * 2) / (SCREEN.h + BEZEL * 2);

export type Font = 'deva' | 'devaSemi' | 'devaBold' | 'latin' | 'latinSemi' | 'money';

/** Registered font families (Anek Devanagari loads with `loadScriptFonts(['devanagari'])`). */
export const FONT_FAMILY: Record<Font, string> = {
  deva: 'AnekDevanagari_400Regular',
  devaSemi: 'AnekDevanagari_600SemiBold',
  devaBold: 'AnekDevanagari_700Bold',
  latin: 'AnekLatin_400Regular',
  latinSemi: 'AnekLatin_600SemiBold',
  money: 'AnekLatin_700Wide',
};

export type Prim =
  | { kind: 'rect'; x: number; y: number; w: number; h: number; r: number; fill?: string; stroke?: string; lw?: number }
  | { kind: 'text'; x: number; y: number; text: string; size: number; font: Font; fill: string; anchor?: 'start' | 'middle' | 'end' }
  /** A 24-unit icon path (lucide geometry), scaled by `s` and placed at x, y. */
  | { kind: 'path'; d: string; x: number; y: number; s: number; stroke: string; lw: number };

export const ICON = {
  check: 'M20 6 9 17l-5-5',
  library: 'm16 6 4 14M12 6v14M8 8v12M4 4v16',
  wifi: 'M12 20h.01M2 8.82a15 15 0 0 1 20 0M5 12.86a10 10 0 0 1 14 0M8.5 16.43a5 5 0 0 1 7 0',
  wifiOff: 'M12 20h.01M8.5 16.43a5 5 0 0 1 7 0M2 8.82a15 15 0 0 1 4.17-2.65M10.66 5c4.01-.36 8.14.9 11.34 3.76M16.85 11.25a10 10 0 0 1 2.22 1.68M5 13a10 10 0 0 1 5.24-2.76M2 2l20 20',
  phone: 'M7 2h10a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zM12 18h.01',
} as const;

export interface AppState {
  /** Customer name typed so far. */
  name: string;
  /** Balance shown, in rupees. */
  balance: number;
  /** Wifi has dropped (the status bar shows wifi-off). */
  offline: boolean;
  /** The "saved on this phone" toast is in the chrome slot. */
  saved: boolean;
  /** Kalam chrome stamp, in the UI language ("On this phone"). */
  onThisPhone: string;
}

/** The finished frame: what the still image and the end of the story show. */
export function finalApp(onThisPhone: string): AppState {
  return { name: ORDER.customer, balance: BALANCE, offline: true, saved: true, onThisPhone };
}

/**
 * The order-book app on the phone as drawing primitives (360 × 640 units). Painted into a canvas texture on
 * the web and drawn with react-native-svg elsewhere, so both show the same app.
 */
export function orderAppUI(s: AppState): Prim[] {
  const A = APP_THEME;
  const out: Prim[] = [];
  const rect = (x: number, y: number, w: number, h: number, r: number, fill?: string, stroke?: string, lw = 1.2) =>
    out.push({ kind: 'rect', x, y, w, h, r, fill, stroke, lw });
  const text = (x: number, y: number, t: string, size: number, font: Font, fill: string, anchor?: 'start' | 'middle' | 'end') =>
    out.push({ kind: 'text', x, y, text: t, size, font, fill, anchor });
  const icon = (d: string, x: number, y: number, s: number, stroke: string, lw = 2) => out.push({ kind: 'path', d, x, y, s, stroke, lw });

  rect(0, 0, SCREEN.w, SCREEN.h, 0, A.bg);
  // Status bar.
  text(30, 30, '9:41', 14, 'latinSemi', A.chromeInk);
  rect(128, 11, 104, 26, 13, A.notch);
  for (let i = 0; i < 4; i++) rect(276 + i * 5, 26 - i * 3, 3, 5 + i * 3, 1, A.chromeInk);
  icon(s.offline ? ICON.wifiOff : ICON.wifi, 298, 15, 0.62, s.offline ? '#B02A22' : A.chromeInk, 2.4);
  rect(318, 18, 24, 12, 3, undefined, A.chromeInk, 1.4);
  rect(320.5, 20.5, 17, 7, 1.5, A.chromeInk);
  // Kalam's thin chrome: shelf key, app name, "On this phone" stamp.
  rect(0, 46, SCREEN.w, 46, 0, A.chrome);
  rect(0, 91, SCREEN.w, 1, 0, A.line);
  icon(ICON.library, 14, 57, 0.95, A.chromeInk, 2);
  text(46, 75, 'दर्ज़ी ऑर्डर बुक', 14.5, 'devaSemi', A.chromeInk);
  const sw = Math.min(150, Math.max(92, 34 + s.onThisPhone.length * 6.4));
  rect(SCREEN.w - 14 - sw, 56, sw, 26, 5, '#E2EFE6', A.leaf, 1.4);
  rect(SCREEN.w - 14 - sw + 2.5, 58.5, sw - 5, 21, 3.5, undefined, A.leaf, 0.7);
  icon(ICON.phone, SCREEN.w - 14 - sw + 7, 61, 0.62, A.leaf, 2.4);
  text(SCREEN.w - 14 - sw / 2 + 8, 74, s.onThisPhone, 11.5, 'latinSemi', A.leaf, 'middle');
  if (s.saved) {
    rect(10, 50, SCREEN.w - 20, 40, 10, A.toast);
    icon(ICON.check, 24, 58, 0.95, A.toastCheck, 2.6);
    text(54, 76, 'सेव हो गया, इसी फ़ोन पर', 14, 'devaSemi', '#F2F5F1');
  }

  // The form.
  text(20, 126, 'नया ऑर्डर', 22, 'devaBold', A.text);
  const label = (x: number, y: number, t: string) => text(x, y, t, 12, 'deva', A.muted);
  const box = (x: number, y: number, w: number) => rect(x, y, w, 36, 9, A.field, A.line, 1.2);

  label(20, 152, 'ग्राहक का नाम');
  box(20, 160, 320);
  text(32, 184, s.name, 15, 'devaSemi', A.text);

  label(20, 214, 'फ़ोन');
  box(20, 222, 320);
  text(32, 246, ORDER.phone, 15, 'latinSemi', A.text);

  label(20, 276, 'कपड़ा');
  rect(20, 284, 72, 30, 8, A.primary);
  text(56, 304, 'ब्लाउज़', 13.5, 'devaSemi', A.onPrimary, 'middle');
  rect(100, 284, 62, 30, 8, A.field, A.line);
  text(131, 304, 'कुर्ता', 13.5, 'deva', A.text, 'middle');
  rect(170, 284, 52, 30, 8, A.field, A.line);
  text(196, 304, 'सूट', 13.5, 'deva', A.text, 'middle');

  label(20, 336, 'नाप (इंच)');
  const trio: Array<[string, string]> = [['छाती', '36'], ['कमर', '30'], ['लंबाई', '15']];
  trio.forEach(([l, v], i) => {
    const x = 20 + i * 108;
    box(x, 344, 100);
    text(x + 9, 367, l, 11.5, 'deva', A.muted);
    text(x + 90, 368, v, 15, 'money', A.text, 'end');
  });

  label(20, 398, 'डिलीवरी');
  box(20, 406, 320);
  text(32, 430, 'शनि, 28 नवंबर', 15, 'deva', A.text);

  label(20, 460, 'कुल');
  label(184, 460, 'एडवांस');
  box(20, 468, 156);
  box(184, 468, 156);
  text(32, 492, rupees(ORDER.total), 15.5, 'money', A.text);
  text(196, 492, rupees(ORDER.advance), 15.5, 'money', A.text);

  rect(20, 518, 320, 48, 10, A.primarySoft);
  text(34, 548, 'बाकी', 15, 'devaSemi', A.text);
  rect(76, 532, 62, 21, 5, A.field, A.primary, 1);
  text(107, 547, 'अपने आप', 11, 'devaSemi', A.primary, 'middle');
  text(326, 550, rupees(s.balance), 21, 'money', A.primary, 'end');

  rect(20, 578, 320, 46, 12, A.primary);
  text(180, 607, 'ऑर्डर सेव करें', 16, 'devaBold', A.onPrimary, 'middle');
  return out;
}

// ─── Layout of the stage (px), shared by the still frame, the Reanimated story and the WebGL camera ───────

export interface Rect { x: number; y: number; w: number; h: number }
export interface StampPlace { cx: number; cy: number; w: number; rotate: number }
export interface StageLayout { paper: Rect; phone: Rect; compact: boolean; stamp: StampPlace }

/**
 * Paper on the left, phone on the right, side by side at every width: nothing covers the phone or the page
 * (owner, 2026-11-25). A narrow stage shrinks both and puts them close together instead of overlapping them.
 */
export function stageLayout(w: number, h: number): StageLayout {
  const compact = w < 600;
  const margin = compact ? 10 : Math.max(24, w * 0.05);
  let paperW: number;
  let phoneH: number;
  let gap: number;
  if (compact) {
    // The page tilts 2.5 degrees, which widens its box by about 5 px a side: keep the gap past that.
    gap = 12;
    const avail = w - margin * 2 - gap;
    paperW = avail * 0.53;
    phoneH = (avail * 0.47) / PHONE_ASPECT;
    const k = Math.min(1, (h * 0.92) / phoneH, (h * 0.8) / (paperW / PAGE_ASPECT));
    paperW *= k;
    phoneH *= k;
  } else {
    paperW = Math.min(w * 0.56, h * 0.86 * PAGE_ASPECT);
    phoneH = Math.min(h * 0.96, (w * 0.46) / PHONE_ASPECT);
    gap = w * 0.04;
    const k = Math.min(1, (w - margin * 2 - gap) / (paperW + phoneH * PHONE_ASPECT));
    paperW *= k;
    phoneH *= k;
  }
  const paperH = paperW / PAGE_ASPECT;
  const phoneW = phoneH * PHONE_ASPECT;
  const pairW = paperW + gap + phoneW;
  const left = Math.max(margin, (w - pairW) / 2);
  const paper = { x: left, y: (h - paperH) / 2, w: paperW, h: paperH };
  const phone = { x: left + paperW + gap, y: (h - phoneH) / 2, w: phoneW, h: phoneH };
  // The stamp stays clear of the phone and of the handwritten save button.
  const covered = (phone.x - paper.x) / paper.w;
  const half = STAMP_ON_PAGE.w / 2;
  const cx = Math.max(FIELDS.save.x + FIELDS.save.w + 0.02 + half, Math.min(STAMP_ON_PAGE.cx, covered - 0.03 - half));
  return { paper, phone, compact, stamp: { ...STAMP_ON_PAGE, cx } };
}

// ─── Where the ways in wait while the pen writes ─────────────────────────────────────────────────────────────

/** The page leans 2.5° anticlockwise on screen, in the still frame and in 3D alike. */
export const PAPER_TILT_RAD = (2.5 * Math.PI) / 180;

/** The order number printed at the top right of the page, and everything the pen writes under it (page fractions). */
export const ORDER_NO: Box = { x: 0.7, y: 0.09, w: 0.21, h: 0.045 };
export const WRITTEN: Box = { x: 0.13, y: 0.135, w: 0.79, h: 0.79 };

export type WayIn = 'text' | 'photo' | 'voice' | 'video';
export interface Size { w: number; h: number }
/** Centre of a waiting input on the stage (px), its shrink factor (1 = full size) and its box at that size. */
export interface Hover { cx: number; cy: number; k: number; box: Rect }

/** A page-fraction box on the stage, as the axis-aligned box of the tilted page's corners (px). */
export function onStage(paper: Rect, b: Box): Rect {
  const cx = paper.x + paper.w / 2, cy = paper.y + paper.h / 2;
  const cos = Math.cos(PAPER_TILT_RAD), sin = Math.sin(PAPER_TILT_RAD);
  const pts = [[b.x, b.y], [b.x + b.w, b.y], [b.x, b.y + b.h], [b.x + b.w, b.y + b.h]].map(([fx, fy]) => {
    const dx = paper.x + fx! * paper.w - cx, dy = paper.y + fy! * paper.h - cy;
    // Anticlockwise on screen (y down): the right side rises.
    return [cx + dx * cos + dy * sin, cy - dx * sin + dy * cos] as const;
  });
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/**
 * Where the four ways in wait while the pen writes (owner override 2): two to a row, one row in the band above
 * the page's writing (left of the order number) and one below its save button, and never over the phone. A row
 * that does not fit its band shrinks (k < 1) rather than overlap. `size` is each input's on-screen size at k = 1,
 * tilt included.
 */
export function hoverSlots(w: number, h: number, size: Record<WayIn, Size>, pad = 12): Record<WayIn, Hover> {
  const { paper, phone } = stageLayout(w, h);
  const written = onStage(paper, WRITTEN);
  const orderNo = onStage(paper, ORDER_NO);
  const out = {} as Record<WayIn, Hover>;
  const row = ([a, b]: [WayIn, WayIn], y0: number, y1: number) => {
    // A band ends where the phone starts, and where the order number starts if it reaches down to it.
    const besidePhone = y1 > phone.y - pad && y0 < phone.y + phone.h + pad;
    const besideNo = y1 > orderNo.y - pad && y0 < orderNo.y + orderNo.h + pad;
    const x0 = pad;
    const x1 = Math.min(besidePhone ? phone.x - pad : w - pad, besideNo ? orderNo.x - pad : w - pad);
    const rowW = size[a].w + pad + size[b].w;
    const rowH = Math.max(size[a].h, size[b].h);
    const k = Math.max(0, Math.min(1, (x1 - x0) / rowW, (y1 - y0) / rowH));
    const left = Math.min(Math.max(paper.x + paper.w / 2 - (rowW * k) / 2, x0), x1 - rowW * k);
    const cy = (y0 + y1) / 2;
    const place = (key: WayIn, x: number): Hover => {
      const bw = size[key].w * k, bh = size[key].h * k;
      return { cx: x + bw / 2, cy, k, box: { x, y: cy - bh / 2, w: bw, h: bh } };
    };
    out[a] = place(a, left);
    out[b] = place(b, left + (size[a].w + pad) * k);
  };
  row(['text', 'photo'], pad, written.y - pad);
  row(['voice', 'video'], written.y + written.h + pad, h - pad);
  return out;
}

/** The ways in as the WebGL hero paints them (scene/fragments.web.ts), in world units at scale 1. */
export const WAY_IN_SIZE: Record<WayIn, Size> = {
  text: { w: 2.6, h: 1.25 }, photo: { w: 1.65, h: 1.95 }, voice: { w: 2.5, h: 0.95 }, video: { w: 2.21, h: 0.85 },
};
/** Their small turn while they wait (radians). */
export const WAY_IN_TILT: Record<WayIn, number> = { text: 0.05, photo: -0.07, voice: -0.05, video: 0.04 };
/** The 3D camera: field of view (degrees) and the depth the inputs wait at (world units, 1 = 100 px at z = 0). */
export const CAMERA_FOV = 30;
export const HOVER_Z = 0.8;

/** WebGL: the inputs' scale on a stage this wide. */
export function wayInScale(w: number): number {
  return Math.max(0.34, Math.min(0.62, w / 1500));
}

/** WebGL: how much bigger things at the hover depth look than at z = 0, for a stage this tall. */
export function hoverMagnification(h: number): number {
  const d = h / 100 / (2 * Math.tan((CAMERA_FOV * Math.PI) / 360));
  return d / (d - HOVER_Z);
}

/** WebGL: each input's on-screen size (px) at full size, with its tilt. */
export function wayInScreenSizes(w: number, h: number): Record<WayIn, Size> {
  const unit = 100 * wayInScale(w) * hoverMagnification(h);
  const out = {} as Record<WayIn, Size>;
  for (const key of Object.keys(WAY_IN_SIZE) as WayIn[]) {
    const { w: sw, h: sh } = WAY_IN_SIZE[key];
    const c = Math.cos(WAY_IN_TILT[key]), s = Math.abs(Math.sin(WAY_IN_TILT[key]));
    out[key] = { w: (sw * c + sh * s) * unit, h: (sw * s + sh * c) * unit };
  }
  return out;
}
