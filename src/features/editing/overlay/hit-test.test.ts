import { describe, expect, it } from 'vitest';
import type { KalamSpec } from '@/core/spec/schema';
import { classifyStroke, combineStrokes, type InkPoint, type MarkGesture } from './gestures';
import { dropSlot, partAt, resolveMark, resolveNote, type Part } from './hit-test';
import { shownScreen, visibleParts } from './parts';

/** A typical phone form: heading, two fields, a button, then two totals side by side. */
const parts: Part[] = [
  { id: 'title', rect: { x: 16, y: 20, width: 360, height: 30 } },
  { id: 'amount', rect: { x: 16, y: 70, width: 360, height: 70 } },
  { id: 'note', rect: { x: 16, y: 160, width: 360, height: 70 } },
  { id: 'save', rect: { x: 16, y: 250, width: 360, height: 56 } },
  { id: 'stat_a', rect: { x: 16, y: 330, width: 170, height: 80 } },
  { id: 'stat_b', rect: { x: 206, y: 330, width: 170, height: 80 } },
];

const run = (a: [number, number], b: [number, number], n = 20): InkPoint[] =>
  Array.from({ length: n + 1 }, (_, i) => ({ x: a[0] + ((b[0] - a[0]) * i) / n, y: a[1] + ((b[1] - a[1]) * i) / n }));
const ellipse = (cx: number, cy: number, rx: number, ry: number, n = 60): InkPoint[] =>
  Array.from({ length: n + 1 }, (_, i) => ({ x: cx + rx * Math.cos((2 * Math.PI * i) / n), y: cy + ry * Math.sin((2 * Math.PI * i) / n) }));
const mark = (pts: InkPoint[]): MarkGesture => classifyStroke(pts);

describe('resolveMark', () => {
  it('a circle around the button picks just the button', () => {
    expect(resolveMark(mark(ellipse(196, 278, 200, 42)), parts)).toEqual({ kind: 'select', targets: ['save'] });
  });

  it('one big loop around both totals picks both, in screen order', () => {
    expect(resolveMark(mark(ellipse(196, 370, 210, 60)), parts)).toEqual({ kind: 'select', targets: ['stat_a', 'stat_b'] });
  });

  it('a small circle inside a big part picks that part', () => {
    expect(resolveMark(mark(ellipse(100, 195, 30, 20)), parts)).toEqual({ kind: 'select', targets: ['note'] });
  });

  it('a tap picks the part under the finger; a tap on empty space picks nothing', () => {
    expect(resolveMark({ kind: 'tap', at: { x: 120, y: 180 } }, parts)).toEqual({ kind: 'select', targets: ['note'] });
    expect(resolveMark({ kind: 'tap', at: { x: 196, y: 60 } }, parts)).toEqual({ kind: 'none', reason: 'empty' });
  });

  it('an X over the button removes the button', () => {
    const x = combineStrokes(mark(run([120, 255], [270, 300])), classifyStroke(run([270, 255], [120, 300])));
    expect(x?.kind).toBe('cross');
    expect(resolveMark(x as MarkGesture, parts)).toEqual({ kind: 'remove', targets: ['save'] });
  });

  it('a line through the middle of the button strikes it out', () => {
    expect(resolveMark(mark(run([40, 280], [350, 276])), parts)).toEqual({ kind: 'remove', targets: ['save'] });
  });

  it('a line just under the heading underlines it', () => {
    expect(resolveMark(mark(run([30, 56], [300, 57])), parts)).toEqual({ kind: 'select', targets: ['title'] });
  });

  it('an arrow from the button to the gap above Amount moves it there', () => {
    const arrow: MarkGesture = { kind: 'arrow', from: { x: 196, y: 278 }, to: { x: 196, y: 60 } };
    expect(resolveMark(arrow, parts)).toEqual({ kind: 'move', target: 'save', before: 'amount' });
  });

  it('an arrow to the bottom moves a part to the end', () => {
    const arrow: MarkGesture = { kind: 'arrow', from: { x: 196, y: 35 }, to: { x: 196, y: 460 } };
    expect(resolveMark(arrow, parts)).toEqual({ kind: 'move', target: 'title', before: null });
  });

  it('an arrow that lands where the part already is changes nothing', () => {
    const arrow: MarkGesture = { kind: 'arrow', from: { x: 196, y: 100 }, to: { x: 196, y: 150 } };
    expect(resolveMark(arrow, parts)).toEqual({ kind: 'none', reason: 'same_place' });
  });

  it('an arrow that starts on empty space has no source', () => {
    const arrow: MarkGesture = { kind: 'arrow', from: { x: 196, y: 600 }, to: { x: 196, y: 60 } };
    expect(resolveMark(arrow, parts)).toEqual({ kind: 'none', reason: 'no_source' });
  });

  it('a straight line from a part to elsewhere reads as a headless arrow', () => {
    expect(resolveMark(mark(run([196, 278], [196, 152])), parts)).toEqual({ kind: 'move', target: 'save', before: 'note' });
  });

  it('a scribble over the heading asks for new words for it', () => {
    const zig: InkPoint[] = [];
    for (let i = 0; i < 9; i++) zig.push(...run([i % 2 ? 160 : 60, 24 + i * 2], [i % 2 ? 60 : 160, 26 + i * 2], 6));
    expect(resolveMark(mark(zig), parts)).toEqual({ kind: 'relabel', target: 'title' });
  });

  it('a wiggly stroke picks the parts it passes through', () => {
    const wiggle: InkPoint[] = [...run([100, 100], [200, 180]), ...run([200, 180], [80, 270])];
    expect(resolveMark(mark(wiggle), parts)).toEqual({ kind: 'select', targets: ['amount', 'note', 'save'] });
  });
});

describe('drop slots and notes', () => {
  it('reads a side-by-side row left to right', () => {
    expect(dropSlot({ x: 196, y: 370 }, parts)).toBe('stat_b');
    expect(dropSlot({ x: 390, y: 370 }, parts)).toBeNull();
    expect(dropSlot({ x: 196, y: 240 }, parts)).toBe('save');
  });

  it('the smallest part wins when parts overlap', () => {
    const nested: Part[] = [{ id: 'card', rect: { x: 0, y: 0, width: 400, height: 400 } }, { id: 'button', rect: { x: 10, y: 10, width: 80, height: 40 } }];
    expect(partAt({ x: 20, y: 20 }, nested)?.id).toBe('button');
  });

  it('a note on a part is about that part; on empty space it marks a spot', () => {
    expect(resolveNote({ x: 100, y: 280 }, parts)).toEqual({ target: 'save' });
    expect(resolveNote({ x: 100, y: 150 }, parts)).toEqual({ before: 'note' });
  });
});

describe('shown screen and its parts', () => {
  const screens = {
    screens: [
      { id: 'home', title: 'Home', children: [{ id: 'title', type: 'heading', label: 'Hi' }, { id: 'go', type: 'text', label: 'x' }] },
      { id: 'add', title: 'Add', children: [{ id: 'amount', type: 'text', label: 'a' }, { id: 'save', type: 'text', label: 'b' }, { id: 'low', type: 'text', label: 'c' }] },
    ],
  } as unknown as KalamSpec;
  const r = (y: number) => ({ x: 0, y, width: 100, height: 40 });

  it('picks the screen with the most measured parts and keeps screen order', () => {
    const rects = new Map([['save', r(100)], ['amount', r(20)], ['low', r(900)]]);
    const screen = shownScreen(screens, rects);
    expect(screen?.id).toBe('add');
    expect(visibleParts(screen, rects, 600).map((p) => p.id)).toEqual(['amount', 'save']);
    expect(shownScreen(screens, new Map())).toBeUndefined();
  });
});
