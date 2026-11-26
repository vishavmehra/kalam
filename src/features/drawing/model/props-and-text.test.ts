import { describe, expect, it } from 'vitest';
import type { DrawingElement } from '@/core/contracts';
import {
  arrowHeadLength, canTransition, canvasFontStack, createPage, DEFAULT_RADIUS, drawnRadius, elementBounds, elementPrimitives,
  MAX_HEAD, MAX_RADIUS, migrateDrawing, needsScriptFont, nonLatinScripts, OBJECT_PROPERTIES, pointerStateOf, POINTER_TRANSITIONS,
  propsOf, textFontFamilies, textSize, withProperties, type PointerState,
} from './index';

const rect = (extra: Partial<DrawingElement> = {}): DrawingElement => ({ id: 'r', kind: 'rect', x: 0, y: 0, w: 100, h: 60, color: '#000000', size: 2, ...extra }) as DrawingElement;
const arrow = (): DrawingElement => ({ id: 'a', kind: 'arrow', x: 0, y: 0, w: 100, h: 0, color: '#000000', size: 3 });
const text = (t = 'Hello'): DrawingElement => ({ id: 't', kind: 'text', x: 0, y: 0, text: t, color: '#000000', fontSize: 20 });
const prims = (el: DrawingElement) => elementPrimitives(el);

describe('object properties (behind the feature check)', () => {
  it('is on', () => { expect(OBJECT_PROPERTIES).toBe(true); });

  it('sets a fill and a corner radius on a rectangle, and the display list follows', () => {
    const el = withProperties(rect(), { fill: '#fdf1d0', radius: 24 });
    expect(propsOf(el)).toMatchObject({ fill: '#fdf1d0', radius: 24 });
    expect(prims(el)[0]).toMatchObject({ t: 'rect', fill: '#fdf1d0', r: 24 });
    expect(prims(rect())[0]).toMatchObject({ t: 'rect', r: DEFAULT_RADIUS });
    expect(prims(rect())[0]).not.toHaveProperty('fill');
  });

  it('never draws a corner bigger than half the shorter side, so a pill stays a pill', () => {
    const pill = withProperties(rect(), { radius: MAX_RADIUS });
    expect(propsOf(pill).radius).toBe(MAX_RADIUS);
    expect(drawnRadius(pill, 100, 60)).toBe(30);
    expect(prims(pill)[0]).toMatchObject({ r: 30 });
  });

  it('fills an ellipse but gives it no corner radius', () => {
    const e = withProperties({ id: 'e', kind: 'ellipse', x: 0, y: 0, w: 50, h: 30, color: '#000000', size: 2 }, { fill: '#aabbcc', radius: 10 });
    expect(propsOf(e).fill).toBe('#aabbcc');
    expect(propsOf(e).radius).toBeUndefined();
    expect(prims(e)[0]).toMatchObject({ t: 'ellipse', fill: '#aabbcc' });
  });

  it('removes a fill with null, and ignores a value that is not a colour', () => {
    const filled = withProperties(rect(), { fill: '#112233' });
    expect(propsOf(withProperties(filled, { fill: null })).fill).toBeUndefined();
    const plain = rect();
    expect(withProperties(plain, { fill: 'url(#x)' })).toBe(plain);
    expect(withProperties(plain, { fill: 'red' })).toBe(plain);
  });

  it('sizes an arrow head, with automatic as the default and a safe range', () => {
    expect(arrowHeadLength(arrow(), 3)).toBe(12);
    expect(arrowHeadLength(arrow(), 1)).toBe(10);
    const big = withProperties(arrow(), { headSize: 32 });
    expect(arrowHeadLength(big, 3)).toBe(32);
    expect(propsOf(withProperties(arrow(), { headSize: 9999 })).headSize).toBe(MAX_HEAD);
    expect(propsOf(withProperties(big, { headSize: null })).headSize).toBeUndefined();
    const heads = prims(big).filter((p) => p.t === 'line');
    expect(heads).toHaveLength(3);
    const len = (p: (typeof heads)[number]) => (p.t === 'line' ? Math.hypot(p.x2 - p.x1, p.y2 - p.y1) : 0);
    expect(len(heads[1]!)).toBeCloseTo(32, 5);
  });

  it('picks a font and bold for text, and the text widens for mono and bold', () => {
    const t = withProperties(text('Total'), { font: 'mono', bold: true });
    expect(propsOf(t)).toMatchObject({ font: 'mono', bold: true });
    expect(prims(t)[0]).toMatchObject({ t: 'text', font: 'mono', bold: true });
    expect(prims(text())[0]).not.toHaveProperty('font');
    expect(elementBounds(t).w).toBeGreaterThan(elementBounds(text('Total')).w);
    expect(propsOf(withProperties(t, { bold: false })).bold).toBeUndefined();
  });

  it('applies only what fits the kind, and returns the same object when nothing changes', () => {
    const r = rect();
    expect(withProperties(r, { headSize: 20, font: 'serif' })).toBe(r);
    expect(withProperties(text(), { fill: '#000000', radius: 4 })).toEqual(text());
    const once = withProperties(r, { radius: 14 });
    expect(withProperties(once, { radius: 14 })).toBe(once);
  });

  it('survives a save and load, and bad stored values are dropped', () => {
    const page = { ...createPage(0, 'pg_p'), elements: [withProperties(rect(), { fill: '#fdf1d0', radius: 24 }), withProperties(text('Hi'), { font: 'serif', bold: true }), withProperties(arrow(), { headSize: 20 })] };
    const stored = JSON.parse(JSON.stringify({ id: 'drw', title: 't', createdAt: 1, updatedAt: 1, pages: [page] })) as unknown;
    const back = migrateDrawing(stored)!.doc.pages[0]!.elements;
    expect(propsOf(back[0]!)).toMatchObject({ fill: '#fdf1d0', radius: 24 });
    expect(propsOf(back[1]!)).toMatchObject({ font: 'serif', bold: true });
    expect(propsOf(back[2]!).headSize).toBe(20);
    const hostile = { id: 'd', pages: [{ id: 'p', elements: [{ id: 'x', kind: 'rect', x: 0, y: 0, w: 5, h: 5, fill: 'javascript:alert(1)', radius: 'big', font: 'comic' }] }] };
    const clean = migrateDrawing(hostile)!.doc.pages[0]!.elements[0]!;
    expect(propsOf(clean).fill).toBeUndefined();
    expect(propsOf(clean).radius).toBeUndefined();
    expect(propsOf(clean).font).toBeUndefined();
  });
});

describe('text size', () => {
  it('counts user-perceived characters, so a Hindi word is not measured as its code units', () => {
    const word = 'कुल';
    expect(word.length).toBe(3);
    const hindi = textSize(word, 20).w; const latin = textSize('abc', 20).w;
    expect(hindi).toBeGreaterThan(0);
    const conjunct = 'क्षत्रिय';
    expect(textSize(conjunct, 20).w).toBeLessThan(conjunct.length * 20 * 0.64);
    expect(hindi).toBeGreaterThan(latin * 0.5);
  });

  it('measures several lines by the longest', () => {
    const s = textSize('ab\nabcdef\nabc', 10);
    expect(s.h).toBeCloseTo(37.5, 5);
    expect(s.w).toBeCloseTo(6 * 10 * 0.56, 5);
  });
});

describe('script fonts for drawing text', () => {
  it('needs nothing for English and the right Noto font for each Indic script', () => {
    expect(needsScriptFont('Total 120')).toBe(false);
    expect(nonLatinScripts('Total 120')).toEqual([]);
    expect(textFontFamilies('Total')).toEqual([]);
    expect(textFontFamilies('कुल रकम')).toEqual(['NotoSansDevanagari_400Regular']);
    expect(textFontFamilies('மொத்தம்', 'semibold')).toEqual(['NotoSansTamil_600SemiBold']);
    expect(textFontFamilies('కన్నడ ಕನ್ನಡ')).toHaveLength(2);
    expect(textFontFamilies('മലയാളം')).toEqual(['NotoSansMalayalam_400Regular']);
    expect(textFontFamilies('ગુજરાતી')).toEqual(['NotoSansGujarati_400Regular']);
    expect(textFontFamilies('বাংলা')).toEqual(['NotoSansBengali_400Regular']);
    expect(textFontFamilies('ਪੰਜਾਬੀ')).toEqual(['NotoSansGurmukhi_400Regular']);
  });

  it('builds a canvas font stack that keeps Inter for English letters and lists every script in the text', () => {
    expect(canvasFontStack('Total', 'regular', 'Inter')).toBeUndefined();
    const hi = canvasFontStack('Total कुल', 'regular', 'Inter')!;
    expect(hi.startsWith('"Inter", "NotoSansDevanagari_400Regular"')).toBe(true);
    const both = canvasFontStack('कुल மொத்தம் कुल', 'semibold', 'Inter')!;
    expect(both).toContain('NotoSansDevanagari_600SemiBold');
    expect(both).toContain('NotoSansTamil_600SemiBold');
    expect(both.endsWith('sans-serif')).toBe(true);
  });
});

describe('pointer states', () => {
  it('names the state from the gesture the studio is in', () => {
    expect(pointerStateOf({})).toBe('idle');
    expect(pointerStateOf({ textEdit: {} })).toBe('text_editing');
    expect(pointerStateOf({ gesture: { kind: 'draw' } })).toBe('drawing');
    expect(pointerStateOf({ gesture: { kind: 'erase' } })).toBe('drawing');
    expect(pointerStateOf({ gesture: { kind: 'shape' } })).toBe('drawing');
    expect(pointerStateOf({ gesture: { kind: 'marquee' } })).toBe('pointer_down');
    expect(pointerStateOf({ gesture: { kind: 'marquee' }, marquee: {} })).toBe('selecting');
    expect(pointerStateOf({ gesture: { kind: 'move' } })).toBe('pointer_down');
    expect(pointerStateOf({ gesture: { kind: 'move' }, preview: {} })).toBe('transforming');
    expect(pointerStateOf({ gesture: { kind: 'resize' }, preview: {} })).toBe('transforming');
    expect(pointerStateOf({ gesture: { kind: 'rotate' }, preview: {} })).toBe('transforming');
    expect(pointerStateOf({ gesture: { kind: 'pan' } })).toBe('panning');
    expect(pointerStateOf({ gesture: { kind: 'pinch' } })).toBe('panning');
  });

  it('lists legal moves: every state can reach idle, and a pan only ends', () => {
    const states = Object.keys(POINTER_TRANSITIONS) as PointerState[];
    for (const s of states) expect(canTransition(s, 'idle'), `${s} to idle`).toBe(true);
    expect(POINTER_TRANSITIONS.panning).toEqual(['idle']);
    expect(canTransition('drawing', 'panning')).toBe(true);
    expect(canTransition('idle', 'selecting')).toBe(false);
    expect(canTransition('panning', 'drawing')).toBe(false);
    expect(canTransition('drawing', 'drawing')).toBe(true);
  });
});
