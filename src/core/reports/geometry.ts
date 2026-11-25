/**
 * Chart-ready geometry from a report's points: scales, line paths and donut arcs. Pure numbers and
 * SVG path strings, so the chart components only draw.
 */

/** Rounds up to 1, 2, 2.5 or 5 times a power of ten (so axis labels are round numbers). */
export function niceMax(max: number): number {
  if (!(max > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(max));
  const step = [1, 2, 2.5, 5, 10].find((s) => s * p >= max) ?? 10;
  return step * p;
}

export interface LinePoint { x: number; y: number; index: number; value: number }

/**
 * Plot positions for one series inside a box. Nulls leave a gap in the line (nothing to average).
 * The scale starts at zero unless values go below it.
 */
export function lineGeometry(values: ReadonlyArray<number | null>, box: { width: number; height: number; padX: number; padTop: number; padBottom: number }) {
  const nums = values.filter((v): v is number => v !== null);
  const min = Math.min(0, ...nums);
  const max = niceMax(Math.max(0, ...nums) - min) + min;
  const span = max - min || 1;
  const plotW = Math.max(1, box.width - box.padX * 2);
  const plotH = Math.max(1, box.height - box.padTop - box.padBottom);
  const step = values.length > 1 ? plotW / (values.length - 1) : 0;
  const yOf = (v: number) => box.padTop + plotH - ((v - min) / span) * plotH;
  const points: LinePoint[] = values.flatMap((v, i) => (v === null ? [] : [{ x: box.padX + (values.length > 1 ? i * step : plotW / 2), y: yOf(v), index: i, value: v }]));
  let path = '';
  let prev = -2;
  for (const p of points) {
    path += `${p.index === prev + 1 ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`;
    prev = p.index;
  }
  return { points, path, min, max, baseline: yOf(Math.max(min, 0)), yOf };
}

/** Bar length as a share of the longest bar, 0 to 1. Negative and missing values draw nothing. */
export function barFractions(values: ReadonlyArray<number | null>): number[] {
  const max = Math.max(0, ...values.map((v) => v ?? 0));
  return values.map((v) => (max > 0 && v !== null && v > 0 ? v / max : 0));
}

/** Path of a horizontal bar anchored at x=0 with a 4px rounded data end. */
export function barPath(width: number, height: number, r = 4): string {
  if (width <= 0) return '';
  const rr = Math.min(r, width, height / 2);
  return `M0,0H${(width - rr).toFixed(1)}Q${width.toFixed(1)},0 ${width.toFixed(1)},${rr}V${height - rr}Q${width.toFixed(1)},${height} ${(width - rr).toFixed(1)},${height}H0Z`;
}

export interface DonutArc { index: number; fraction: number; path: string }

/** Donut slices clockwise from 12 o'clock. Zero and negative values get no slice. */
export function donutArcs(values: ReadonlyArray<number | null>, size: number, thickness: number): DonutArc[] {
  const total = values.reduce<number>((s, v) => s + (v && v > 0 ? v : 0), 0);
  if (total <= 0) return [];
  const c = size / 2;
  const ro = c;
  const ri = c - thickness;
  const at = (r: number, a: number) => `${(c + r * Math.sin(a)).toFixed(2)},${(c - r * Math.cos(a)).toFixed(2)}`;
  const out: DonutArc[] = [];
  let start = 0;
  values.forEach((v, index) => {
    if (!v || v <= 0) return;
    const fraction = v / total;
    // A whole ring cannot be one SVG arc, so a 100% slice stops just short of closing.
    const end = start + Math.min(fraction, 0.9999) * Math.PI * 2;
    const large = end - start > Math.PI ? 1 : 0;
    const path = `M${at(ro, start)}A${ro},${ro} 0 ${large} 1 ${at(ro, end)}L${at(ri, end)}A${ri},${ri} 0 ${large} 0 ${at(ri, start)}Z`;
    out.push({ index, fraction, path });
    start += fraction * Math.PI * 2;
  });
  return out;
}
