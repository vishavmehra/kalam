import { describe, expect, it } from 'vitest';

import { graphemes } from '@/i18n/graphemes';

import {
  BALANCE, FIELDS, finalApp, hoverSlots, onStage, ORDER, ORDER_NO, orderAppUI, PAGE_ASPECT, PHONE_ASPECT, penAt, READ_SCHEDULE, type Rect, rolledBalance,
  SCREEN, stageLayout, STAMP_ON_PAGE, stampDate, stepAt, T, typedName, wayInScreenSizes, WRITE_ORDER, WRITE_SCHEDULE, WRITTEN,
} from './story';

describe('landing story', () => {
  it('writes every field once, in order, before Kalam starts reading', () => {
    expect(WRITE_SCHEDULE.map((s) => s.key)).toEqual(WRITE_ORDER);
    for (let i = 1; i < WRITE_SCHEDULE.length; i++) {
      expect(WRITE_SCHEDULE[i]!.start).toBeGreaterThan(WRITE_SCHEDULE[i - 1]!.start + WRITE_SCHEDULE[i - 1]!.duration);
    }
    const last = WRITE_SCHEDULE[WRITE_SCHEDULE.length - 1]!;
    expect(WRITE_SCHEDULE[0]!.start).toBe(T.write);
    expect(last.start + last.duration).toBeLessThan(T.read);
    expect(READ_SCHEDULE.map((r) => r.key)).not.toContain('title');
    const lastRead = READ_SCHEDULE[READ_SCHEDULE.length - 1]!;
    expect(lastRead.start + lastRead.duration).toBeLessThan(T.stamp);
  });

  it('keeps the beats in story order', () => {
    const beats = [T.inputsIn, T.write, T.read, T.pull, T.reveal, T.typeName, T.roll, T.stamp, T.route, T.offline, T.end];
    expect([...beats].sort((a, b) => a - b)).toEqual(beats);
    expect([stepAt(0), stepAt(T.pull), stepAt(T.stamp), stepAt(T.route), stepAt(T.end)]).toEqual([0, 1, 2, 3, 3]);
  });

  it('moves the pen along the line it is writing, and puts it away after', () => {
    const name = WRITE_SCHEDULE.find((s) => s.key === 'name')!;
    const b = FIELDS.name;
    const mid = penAt(name.start + name.duration / 2);
    expect(mid.down).toBe(true);
    expect(mid.x).toBeCloseTo(b.x + b.w / 2, 5);
    expect(mid.y).toBeGreaterThan(b.y - b.h);
    expect(mid.y).toBeLessThan(b.y + b.h * 1.5);
    expect(penAt(0).shown).toBe(0);
    expect(penAt(T.end).shown).toBe(0);
  });

  it('computes the balance as total minus advance and types whole letters', () => {
    expect(BALANCE).toBe(350);
    expect(rolledBalance(0)).toBe(0);
    expect(rolledBalance(1)).toBe(350);
    expect(typedName(1)).toBe(ORDER.customer);
    expect(typedName(0)).toBe('');
    // A half-typed name is always whole letters: a vowel sign never dangles without its consonant.
    const prefixes = graphemes(ORDER.customer).map((_, i, g) => g.slice(0, i + 1).join(''));
    for (const p of [0.2, 0.4, 0.5, 0.7, 0.9]) expect(prefixes).toContain(typedName(p));
  });

  it('draws the finished app with the real values and the offline save', () => {
    const texts = orderAppUI(finalApp('On this phone')).flatMap((p) => (p.kind === 'text' ? [p.text] : []));
    expect(texts).toEqual(expect.arrayContaining(['सुनीता शर्मा', '₹850', '₹500', '₹350', 'सेव हो गया, इसी फ़ोन पर', 'On this phone']));
    for (const p of orderAppUI(finalApp('x'))) {
      if (p.kind === 'rect') expect(p.y + p.h).toBeLessThanOrEqual(SCREEN.h);
    }
  });

  it('lays the page and the phone inside the stage at every width', () => {
    for (const [w, h] of [[358, 440], [390, 470], [500, 460], [760, 560], [1000, 620], [780, 640]] as const) {
      const { paper, phone } = stageLayout(w, h);
      for (const r of [paper, phone]) {
        expect(r.x).toBeGreaterThanOrEqual(0);
        expect(r.y).toBeGreaterThanOrEqual(0);
        expect(r.x + r.w).toBeLessThanOrEqual(w + 0.5);
        expect(r.y + r.h).toBeLessThanOrEqual(h + 0.5);
      }
      expect(paper.w / paper.h).toBeCloseTo(PAGE_ASPECT, 5);
      expect(phone.w / phone.h).toBeCloseTo(PHONE_ASPECT, 5);
      // Nothing overlaps at any width (owner, 2026-11-25); a narrow stage shrinks the pair instead. The page
      // tilts 2.5 degrees, so its box is allowed to grow by half its height times sin 2.5 on each side.
      const tilt = (paper.h / 2) * Math.sin((2.5 * Math.PI) / 180);
      expect(paper.x + paper.w + tilt, `${w}x${h}`).toBeLessThanOrEqual(phone.x);
    }
  });

  it('lands the stamp clear of every field and never under the phone', () => {
    for (const [w, h] of [[358, 440], [500, 460], [760, 560], [1000, 620]] as const) {
      const { paper, phone, stamp } = stageLayout(w, h);
      const half = stamp.w / 2;
      const top = stamp.cy - half * (573 / 900) * PAGE_ASPECT;
      const left = stamp.cx - half;
      for (const key of WRITE_ORDER) {
        const b = FIELDS[key];
        expect(b.y + b.h <= top || b.x + b.w <= left, `${w}: ${key}`).toBe(true);
      }
      expect(paper.x + (stamp.cx + half) * paper.w, `${w}: phone`).toBeLessThan(phone.x);
    }
    expect(STAMP_ON_PAGE.rotate).toBeLessThan(0);
  });

  it('keeps the waiting inputs clear of the phone and the writing at every stage size', () => {
    const overlap = (a: Rect, b: Rect) =>
      Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
    const square = { w: 48, h: 48 };
    // Stage areas measured on the landing: phone, tablet (stacked), 1280, 1440 and 1920 side by side.
    for (const [w, h] of [[358, 440], [390, 470], [768, 600], [1024, 610], [698, 560], [791, 650], [1236, 900]] as const) {
      const { paper, phone } = stageLayout(w, h);
      const written = onStage(paper, WRITTEN);
      for (const [kind, sizes] of [['web', wayInScreenSizes(w, h)], ['native', { text: square, photo: square, voice: square, video: square }]] as const) {
        const slots = Object.entries(hoverSlots(w, h, sizes));
        for (const [key, s] of slots) {
          const at = `${kind} ${w}x${h} ${key}`;
          expect(overlap(s.box, phone), `${at} phone`).toBe(0);
          expect(overlap(s.box, written), `${at} writing`).toBe(0);
          expect(overlap(s.box, onStage(paper, ORDER_NO)), `${at} order number`).toBe(0);
          expect(overlap(s.box, onStage(paper, FIELDS.save)), `${at} save`).toBe(0);
          expect(s.box.x, at).toBeGreaterThanOrEqual(0);
          expect(s.box.y, at).toBeGreaterThanOrEqual(0);
          expect(s.box.x + s.box.w, at).toBeLessThanOrEqual(w);
          expect(s.box.y + s.box.h, at).toBeLessThanOrEqual(h);
          // Shrunk to fit, but still big enough to read as a note, a photo, a voice note and a film strip.
          expect(s.k, at).toBeGreaterThan(0.45);
          for (const [other, o] of slots) if (other !== key) expect(overlap(s.box, o.box), `${at} ${other}`).toBe(0);
        }
      }
    }
  });

  it('prints the stamp date like a dater', () => {
    expect(stampDate('en-IN', new Date(2026, 10, 25))).toBe('25 NOV 2026');
  });
});
