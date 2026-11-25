/** Hand-drawn app outline used by the creation progress animation (viewBox 0 0 120 180). */
export interface InkPath { d: string; len: number; width: number }

function roundRect(x: number, y: number, w: number, h: number, r: number, width: number): InkPath {
  const d = `M${x + r},${y} H${x + w - r} A${r},${r} 0 0 1 ${x + w},${y + r} V${y + h - r} A${r},${r} 0 0 1 ${x + w - r},${y + h}`
    + ` H${x + r} A${r},${r} 0 0 1 ${x},${y + h - r} V${y + r} A${r},${r} 0 0 1 ${x + r},${y} Z`;
  return { d, len: 2 * (w + h) - 8 * r + 2 * Math.PI * r, width };
}

function line(x1: number, y1: number, x2: number, y2: number, width: number): InkPath {
  return { d: `M${x1},${y1} L${x2},${y2}`, len: Math.hypot(x2 - x1, y2 - y1), width };
}

export const INK_VIEWBOX = '0 0 120 180';

/** Paint order = drawing order: phone frame, title, three rows, then the action button. */
export const INK_PATHS: InkPath[] = [
  roundRect(12, 6, 96, 168, 16, 2.6),
  line(26, 28, 70, 28, 3.4),
  roundRect(26, 44, 68, 22, 6, 1.8),
  line(34, 55, 66, 55, 1.6),
  roundRect(26, 74, 68, 22, 6, 1.8),
  line(34, 85, 58, 85, 1.6),
  roundRect(26, 104, 68, 22, 6, 1.8),
  line(34, 115, 62, 115, 1.6),
  roundRect(34, 142, 52, 18, 9, 2.4),
];
