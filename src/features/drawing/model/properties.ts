/**
 * Object properties the docs ask for and the contract does not carry yet (docs/08 §6.2, §6.5, §6.6):
 * fill, corner radius, arrow head size and font. They are read and written here through one local type,
 * so the Studio, the renderers, save and SVG export all work today. `OBJECT_PROPERTIES` is the feature
 * check: turn it off and the controls disappear and the fields are ignored on save.
 *
 * CONTRACT CHANGE REQUEST (additive, optional, on `DrawingElementCommon`): see ObjectProps below. When the
 * lead adds them, `propsOf` can read `el` directly and the casts here go away.
 */
import type { DrawingElement } from '@/core/contracts';

export const OBJECT_PROPERTIES = true;

export type FontChoice = 'sans' | 'serif' | 'mono';
export const FONT_CHOICES: ReadonlyArray<{ id: FontChoice; label: string }> = [
  { id: 'sans', label: 'Sans' },
  { id: 'serif', label: 'Serif' },
  { id: 'mono', label: 'Mono' },
];

/** Same shape as the fields the contract request names. Every field is optional. */
export interface ObjectProps {
  /** rect, ellipse: fill colour as a hex string. Absent means no fill. */
  fill?: string;
  /** rect: corner radius in document px. Absent means 4, which is how rectangles looked before this field. */
  radius?: number;
  /** arrow: head length in document px. Absent means `max(10, size * 4)`. */
  headSize?: number;
  /** text: typeface. Absent means 'sans'. */
  font?: FontChoice;
  /** text: bold. Absent means regular. */
  bold?: boolean;
}

export const DEFAULT_RADIUS = 4;
export const MAX_RADIUS = 400;
export const MIN_HEAD = 6;
export const MAX_HEAD = 80;
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

export const RADIUS_OPTIONS: ReadonlyArray<{ id: string; label: string; value: number }> = [
  { id: 'square', label: 'Square', value: 0 },
  { id: 'small', label: 'Small', value: DEFAULT_RADIUS },
  { id: 'medium', label: 'Medium', value: 14 },
  { id: 'large', label: 'Large', value: 28 },
  { id: 'pill', label: 'Pill', value: MAX_RADIUS },
];

export const HEAD_OPTIONS: ReadonlyArray<{ id: string; label: string; value: number | null }> = [
  { id: 'auto', label: 'Auto', value: null },
  { id: 'small', label: 'Small', value: 12 },
  { id: 'medium', label: 'Medium', value: 20 },
  { id: 'large', label: 'Large', value: 32 },
];

type WithProps = DrawingElement & ObjectProps;

/** The extra properties of an element, or nothing when the feature is off. */
export function propsOf(el: DrawingElement): ObjectProps {
  return OBJECT_PROPERTIES ? (el as WithProps) : {};
}

/** Radius to draw: never more than half the shorter side, so a pill stays a pill. */
export function drawnRadius(el: DrawingElement, w: number, h: number): number {
  const r = propsOf(el).radius ?? DEFAULT_RADIUS;
  return Math.max(0, Math.min(r, w / 2, h / 2));
}

export function arrowHeadLength(el: DrawingElement, size: number): number {
  const set = propsOf(el).headSize;
  return set !== undefined ? Math.min(MAX_HEAD, Math.max(MIN_HEAD, set)) : Math.max(10, size * 4);
}

export const hasFill = (el: DrawingElement): boolean => el.kind === 'rect' || el.kind === 'ellipse';
export const hasRadius = (el: DrawingElement): boolean => el.kind === 'rect';
export const hasHead = (el: DrawingElement): boolean => el.kind === 'arrow';
export const hasFont = (el: DrawingElement): boolean => el.kind === 'text';

export interface PropertyPatch {
  /** A hex colour, or `null` to remove the fill. */
  fill?: string | null;
  radius?: number;
  /** A length, or `null` to go back to the automatic size. */
  headSize?: number | null;
  font?: FontChoice;
  bold?: boolean;
}

/** Applies the parts of `patch` that make sense for this kind. Returns `el` itself when nothing changes. */
export function withProperties(el: DrawingElement, patch: PropertyPatch): DrawingElement {
  if (!OBJECT_PROPERTIES) return el;
  const next: WithProps = { ...el };
  if (patch.fill !== undefined && hasFill(el)) {
    if (patch.fill === null) Reflect.deleteProperty(next, 'fill');
    else if (HEX.test(patch.fill)) next.fill = patch.fill;
  }
  if (patch.radius !== undefined && hasRadius(el) && Number.isFinite(patch.radius)) {
    next.radius = Math.round(Math.min(MAX_RADIUS, Math.max(0, patch.radius)));
  }
  if (patch.headSize !== undefined && hasHead(el)) {
    if (patch.headSize === null) Reflect.deleteProperty(next, 'headSize');
    else if (Number.isFinite(patch.headSize)) next.headSize = Math.round(Math.min(MAX_HEAD, Math.max(MIN_HEAD, patch.headSize)));
  }
  if (hasFont(el)) {
    if (patch.font && FONT_CHOICES.some((f) => f.id === patch.font)) next.font = patch.font;
    if (patch.bold !== undefined) {
      if (patch.bold) next.bold = true;
      else Reflect.deleteProperty(next, 'bold');
    }
  }
  const keys: Array<keyof ObjectProps> = ['fill', 'radius', 'headSize', 'font', 'bold'];
  return keys.every((k) => (next as ObjectProps)[k] === (el as ObjectProps)[k]) ? el : next;
}

/** Reads the extra properties off untrusted stored data (used by validate and migrate on load). */
export function parseProps(raw: Record<string, unknown>, kind: string): ObjectProps {
  const out: ObjectProps = {};
  if (!OBJECT_PROPERTIES) return out;
  if ((kind === 'rect' || kind === 'ellipse') && typeof raw.fill === 'string' && HEX.test(raw.fill)) out.fill = raw.fill;
  if (kind === 'rect' && typeof raw.radius === 'number' && Number.isFinite(raw.radius)) out.radius = Math.round(Math.min(MAX_RADIUS, Math.max(0, raw.radius)));
  if (kind === 'arrow' && typeof raw.headSize === 'number' && Number.isFinite(raw.headSize)) {
    out.headSize = Math.round(Math.min(MAX_HEAD, Math.max(MIN_HEAD, raw.headSize)));
  }
  if (kind === 'text') {
    if (raw.font === 'sans' || raw.font === 'serif' || raw.font === 'mono') out.font = raw.font;
    if (raw.bold === true) out.bold = true;
  }
  return out;
}
