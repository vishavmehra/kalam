import { describe, expect, it } from 'vitest';
import type { DrawingElement, DrawingPage } from '@/core/contracts';
import {
  createPage, flattenPath, importSvg, pageToSvg, parseSvgColor, PAGE_HEIGHT, PAGE_OBJECT_CAP, PAGE_WIDTH, propsOf, SVG_IMPORT_LIMITS,
  SVG_STROKE_POINTS, withProperties,
} from './index';

type Geo = { x: number; y: number; w: number; h: number; color: string; size: number; rotation?: number };

const page = (...elements: DrawingElement[]): DrawingPage => ({ ...createPage(0, 'pg_svg'), title: 'Home & "Orders"', elements });
const stroke = (id: string, n = 20): DrawingElement => ({
  id, kind: 'stroke', tool: 'pen', color: '#1b2a49', size: 4,
  points: Array.from({ length: n }, (_, i) => ({ x: 40 + i * 5, y: 100 + Math.sin(i / 3) * 20 })),
});
const kinds = (els: DrawingElement[]) => els.map((e) => e.kind);

describe('SVG export', () => {
  it('writes one standalone SVG with the page size, a title and every visible object as its own group', () => {
    const svg = pageToSvg(page(
      { id: 'r1', kind: 'rect', x: 20, y: 30, w: 100, h: 60, color: '#112233', size: 2 },
      { id: 'hidden', kind: 'rect', x: 0, y: 0, w: 10, h: 10, color: '#112233', size: 2, hidden: true },
      { id: 'e1', kind: 'ellipse', x: 50, y: 200, w: 80, h: 40, color: '#445566', size: 3 },
    ));
    expect(svg.startsWith('<?xml')).toBe(true);
    expect(svg).toContain(`width="${PAGE_WIDTH}" height="${PAGE_HEIGHT}" viewBox="0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}"`);
    expect(svg).toContain('<title>Home &amp; &quot;Orders&quot;</title>');
    expect(svg).toContain('<g id="r1">');
    expect(svg).toContain('<g id="e1">');
    expect(svg).not.toContain('id="hidden"');
    expect(svg.trim().endsWith('</svg>')).toBe(true);
  });

  it('is well formed: every opened tag is closed, including rotated objects', () => {
    const svg = pageToSvg(page({ id: 'r', kind: 'rect', x: 50, y: 50, w: 80, h: 40, color: '#000000', size: 2, rotation: 30 }, stroke('s')));
    const opens = (svg.match(/<g[ >]/g) ?? []).length;
    const closes = (svg.match(/<\/g>/g) ?? []).length;
    expect(opens).toBe(closes);
    expect(svg).toContain('rotate(30');
  });

  it('escapes text, so a label cannot break out of the file', () => {
    const svg = pageToSvg(page({ id: 't', kind: 'text', x: 10, y: 10, text: '</text><script>alert(1)</script> & "x"', color: '#000000', fontSize: 16 }));
    expect(svg).not.toContain('<script>');
    expect(svg).toContain('&lt;script&gt;');
    expect(svg).toContain('&amp;');
  });

  it('uses the Noto font stack for Hindi and Tamil text', () => {
    const svg = pageToSvg(page(
      { id: 'h', kind: 'text', x: 10, y: 10, text: 'कुल रकम', color: '#000000', fontSize: 20 },
      { id: 't', kind: 'text', x: 10, y: 60, text: 'மொத்தம்', color: '#000000', fontSize: 20 },
    ));
    expect(svg).toContain('NotoSansDevanagari_400Regular');
    expect(svg).toContain('NotoSansTamil_400Regular');
    expect(svg).toContain('कुल रकम');
  });

  it('marks group members and keeps the exact points of pen strokes', () => {
    const svg = pageToSvg(page({ ...stroke('s1'), groupId: 'grp_1' }, { id: 'r', kind: 'rect', x: 0, y: 0, w: 30, h: 30, color: '#000000', size: 2, groupId: 'grp_1' }));
    expect(svg.match(/data-kalam-group="grp_1"/g)).toHaveLength(2);
    expect(svg).toContain('data-kalam-kind="stroke"');
    expect(svg).toContain('data-kalam-points="40,100');
  });

  it('draws a dashed box where a photo has no bytes, and embeds one that does', () => {
    const photo: DrawingElement = { id: 'p', kind: 'image', x: 10, y: 10, w: 100, h: 80, blobId: 'blob1', alt: 'A <shop>' };
    expect(pageToSvg(page(photo))).not.toContain('<image');
    const tiny = 'data:image/png;base64,iVBORw0KGgo=';
    const withBytes = pageToSvg(page(photo), { imageHref: () => tiny });
    expect(withBytes).toContain(`href="${tiny}"`);
    expect(withBytes).toContain('aria-label="A &lt;shop&gt;"');
    expect(pageToSvg(page(photo), { imageHref: () => 'https://evil.example/x.png' })).not.toContain('evil.example');
    expect(pageToSvg(page(photo), { imageHref: () => 'data:image/svg+xml;base64,AAAA' })).not.toContain('data:image/svg');
  });
});

describe('SVG round trip', () => {
  it('brings Kalam\'s own export back as the same kinds of objects, strokes, stamps and groups included', () => {
    const original = page(
      stroke('s1', 30),
      { id: 'r', kind: 'rect', x: 20, y: 300, w: 120, h: 70, color: '#bb2200', size: 3, groupId: 'g1' },
      { id: 'e', kind: 'ellipse', x: 200, y: 300, w: 80, h: 80, color: '#00aa44', size: 2, groupId: 'g1' },
      { id: 'a', kind: 'arrow', x: 30, y: 450, w: 150, h: 20, color: '#0044cc', size: 4 },
      { id: 'l', kind: 'line', x: 30, y: 500, w: 200, h: 0, color: '#0044cc', size: 2 },
      { id: 't', kind: 'text', x: 40, y: 560, text: 'Total due', color: '#112233', fontSize: 24 },
      { id: 'st', kind: 'stamp', x: 40, y: 620, w: 240, h: 56, component: 'bigButton', label: 'Save' },
    );
    const res = importSvg(pageToSvg(original));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(kinds(res.elements)).toEqual(['stroke', 'rect', 'ellipse', 'arrow', 'line', 'text', 'stamp']);
    const byKind = (k: string) => res.elements.filter((e) => e.kind === k);
    expect(byKind('stroke')).toHaveLength(1);
    expect((byKind('stroke')[0] as Extract<DrawingElement, { kind: 'stroke' }>).points).toHaveLength(30);
    expect(byKind('rect')).toHaveLength(1);
    expect(byKind('ellipse')).toHaveLength(1);
    expect(byKind('arrow')).toHaveLength(1);
    expect(byKind('text')).toHaveLength(1);
    expect((byKind('text')[0] as Extract<DrawingElement, { kind: 'text' }>).text).toBe('Total due');
    expect(byKind('stamp')).toHaveLength(1);
    const stamp = byKind('stamp')[0] as Extract<DrawingElement, { kind: 'stamp' }>;
    expect(stamp.component).toBe('bigButton');
    expect(stamp.label).toBe('Save');
    expect(stamp.w).toBe(240);
    // The rectangle and ellipse stay one group, under a fresh id.
    const rect = byKind('rect')[0]!; const ellipse = byKind('ellipse')[0]!;
    expect(rect.groupId).toBeTruthy();
    expect(rect.groupId).toBe(ellipse.groupId);
    expect(rect.groupId).not.toBe('g1');
    // Geometry survives: the rectangle is where it was.
    const r = rect as Geo;
    expect([r.x, r.y, r.w, r.h]).toEqual([20, 300, 120, 70]);
    expect(r.color).toBe('#bb2200');
  });

  it('keeps fill, corner radius, arrow head size, font and bold', () => {
    const res = importSvg(pageToSvg(page(
      withProperties({ id: 'b', kind: 'rect', x: 20, y: 300, w: 120, h: 70, color: '#bb2200', size: 3 }, { fill: '#ffcc00', radius: 14 }),
      withProperties({ id: 'a', kind: 'arrow', x: 30, y: 450, w: 150, h: 20, color: '#0044cc', size: 4 }, { headSize: 32 }),
      withProperties({ id: 's', kind: 'text', x: 40, y: 520, text: 'Serif bold', color: '#112233', fontSize: 24 }, { font: 'serif', bold: true }),
      withProperties({ id: 'm', kind: 'text', x: 40, y: 580, text: 'Mono', color: '#112233', fontSize: 20 }, { font: 'mono' }),
      { id: 'p', kind: 'text', x: 40, y: 640, text: 'Plain', color: '#112233', fontSize: 20 },
      withProperties({ id: 'e', kind: 'ellipse', x: 200, y: 300, w: 80, h: 80, color: '#00aa44', size: 2 }, { fill: '#99ddaa' }),
    )));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const [box, arrow, serif, mono, plain, ellipse] = res.elements;
    expect(propsOf(box!)).toMatchObject({ fill: '#ffcc00', radius: 14 });
    expect(propsOf(arrow!).headSize).toBe(32);
    expect(propsOf(serif!)).toMatchObject({ font: 'serif', bold: true });
    expect(propsOf(mono!).font).toBe('mono');
    expect(propsOf(mono!).bold).toBeUndefined();
    expect(propsOf(plain!).font).toBeUndefined();
    expect(propsOf(ellipse!).fill).toBe('#99ddaa');
  });

  it('keeps every point of a long stroke, and the tool and width of a highlighter', () => {
    const wave = (n: number) => Array.from({ length: n }, (_, i) => ({ x: 20 + (i % 300), y: 100 + Math.sin(i / 9) * 30 + Math.floor(i / 300) * 40 }));
    const marker: DrawingElement = { id: 'h', kind: 'stroke', tool: 'highlighter', color: '#ffee00', size: 18, points: wave(1000) };
    const res = importSvg(pageToSvg(page(marker)));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const back = res.elements[0] as Extract<DrawingElement, { kind: 'stroke' }>;
    expect(res.elements).toHaveLength(1);
    expect(back.tool).toBe('highlighter');
    expect(back.size).toBe(18);
    expect(back.color).toBe('#ffee00');
    expect(back.points).toHaveLength(1000);
    expect(back.points[999]!.x).toBeCloseTo(marker.points[999]!.x, 1);
    // Past the cap the stroke is thinned evenly, with its first and last point kept, instead of losing its shape.
    const huge: DrawingElement = { ...marker, id: 'huge', tool: 'pen', size: 4, points: wave(5000) };
    const thin = importSvg(pageToSvg(page(huge)));
    expect(thin.ok).toBe(true);
    if (thin.ok) {
      const pts = (thin.elements[0] as Extract<DrawingElement, { kind: 'stroke' }>).points;
      expect(pts).toHaveLength(SVG_STROKE_POINTS);
      expect(pts[0]!.x).toBeCloseTo(huge.points[0]!.x, 1);
      expect(pts[pts.length - 1]!.y).toBeCloseTo(huge.points[4999]!.y, 1);
    }
  });

  it('keeps Hindi and Tamil text exactly', () => {
    const res = importSvg(pageToSvg(page(
      { id: 'h', kind: 'text', x: 10, y: 10, text: 'कुल रकम', color: '#000000', fontSize: 20 },
      { id: 't', kind: 'text', x: 10, y: 60, text: 'மொத்தம்', color: '#000000', fontSize: 20 },
    )));
    expect(res.ok && res.elements.map((e) => (e.kind === 'text' ? e.text : ''))).toEqual(['कुल रकम', 'மொத்தம்']);
  });

  it('keeps rotation of a box', () => {
    const res = importSvg(pageToSvg(page({ id: 'r', kind: 'rect', x: 100, y: 100, w: 80, h: 40, color: '#000000', size: 2, rotation: 25 })));
    expect(res.ok).toBe(true);
    if (res.ok) {
      const r = res.elements.find((e) => e.kind === 'rect')!;
      expect(r.rotation).toBeCloseTo(25, 1);
      expect((r as Geo).x).toBeCloseTo(100, 1);
    }
  });
});

describe('SVG import of other programs\' files', () => {
  const wrap = (body: string, attrs = 'viewBox="0 0 200 100"') => `<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" ${attrs}>${body}</svg>`;

  it('turns simple shapes into editable objects', () => {
    const res = importSvg(wrap(`
      <rect x="10" y="10" width="80" height="40" rx="6" fill="#ff0000" stroke="#000" stroke-width="2"/>
      <circle cx="150" cy="30" r="20" fill="none" stroke="blue"/>
      <ellipse cx="50" cy="80" rx="30" ry="10" fill="rgb(0,128,0)"/>
      <line x1="0" y1="95" x2="200" y2="95" stroke="#333" stroke-width="3"/>
      <polyline points="10,10 20,20 30,10" stroke="#111" fill="none"/>
      <polygon points="100,60 120,60 110,80" stroke="#111" fill="none"/>
      <text x="100" y="50" font-size="14" fill="#123456">Hello</text>`));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(kinds(res.elements)).toEqual(['rect', 'ellipse', 'ellipse', 'line', 'stroke', 'stroke', 'text']);
    const rect = res.elements[0] as Geo;
    expect(rect.color).toBe('#000000');
    expect(res.elements[1]!.kind === 'ellipse' && (res.elements[1] as { w: number }).w).toBe(40);
    const poly = res.elements[5] as Extract<DrawingElement, { kind: 'stroke' }>;
    expect(poly.points).toHaveLength(4);
    expect(poly.points[0]).toEqual(poly.points[3]);
  });

  it('applies moves, scales and turns, and skips skews', () => {
    const res = importSvg(wrap(`
      <g transform="translate(50 20)"><rect x="0" y="0" width="30" height="10" stroke="#000"/></g>
      <rect x="0" y="0" width="10" height="10" stroke="#000" transform="scale(2)"/>
      <rect x="0" y="0" width="10" height="10" stroke="#000" transform="skewX(20)"/>`));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const [a, b] = res.elements as Array<Geo>;
    expect([a!.x, a!.y]).toEqual([50, 20]);
    expect([b!.w, b!.h]).toEqual([20, 20]);
    expect(res.skipped).toBe(1);
    expect(res.notices.join(' ')).toMatch(/could not be brought in/);
  });

  it('reads style attributes and inherited colours', () => {
    const res = importSvg(wrap('<g fill="#00ff00" stroke="#0000ff"><rect x="1" y="1" width="20" height="20" style="stroke:#ff00ff;stroke-width:5"/></g>'));
    expect(res.ok).toBe(true);
    if (res.ok) {
      const r = res.elements[0] as Geo;
      expect(r.color).toBe('#ff00ff');
      expect(r.size).toBe(5);
    }
  });

  it('flattens paths into pen strokes, curves and closed shapes included', () => {
    const res = importSvg(wrap('<path d="M10 10 L50 10 C60 10 70 20 70 30 Q70 60 40 60 H10 V40 Z" stroke="#000" fill="none"/>'));
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.elements).toHaveLength(1);
      const s = res.elements[0] as Extract<DrawingElement, { kind: 'stroke' }>;
      expect(s.points.length).toBeGreaterThan(15);
      expect(s.points[s.points.length - 1]).toEqual(s.points[0]);
    }
    const two = flattenPath('M0 0 L10 0 M20 20 l5 5 l5 0');
    expect(two).toHaveLength(2);
    expect(two[1]![2]).toEqual({ x: 30, y: 25 });
  });

  it('puts the pieces of a many-part path into one group', () => {
    const res = importSvg(wrap('<path d="M0 0 L10 10 M30 30 L40 40" stroke="#000"/>'));
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.elements).toHaveLength(2);
      expect(res.elements[0]!.groupId).toBeTruthy();
      expect(res.elements[0]!.groupId).toBe(res.elements[1]!.groupId);
    }
  });

  it('makes a big picture smaller to fit the screen, keeping its shape', () => {
    const res = importSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2000 4000"><rect x="0" y="0" width="2000" height="4000" stroke="#000"/></svg>');
    expect(res.ok).toBe(true);
    if (res.ok) {
      const r = res.elements[0] as Geo;
      expect(r.w).toBeLessThanOrEqual(PAGE_WIDTH);
      expect(r.h).toBeLessThanOrEqual(PAGE_HEIGHT);
      expect(r.h / r.w).toBeCloseTo(2, 5);
      expect(res.notices.join(' ')).toMatch(/smaller/);
    }
  });

  it('colours: hex, short hex, rgb, names, none and things it does not understand', () => {
    expect(parseSvgColor('#ABC')).toBe('#aabbcc');
    expect(parseSvgColor('#aabbccdd')).toBe('#aabbcc');
    expect(parseSvgColor('rgb(255, 0, 128)')).toBe('#ff0080');
    expect(parseSvgColor('rgb(100%, 0%, 0%)')).toBe('#ff0000');
    expect(parseSvgColor('Navy')).toBe('#000080');
    expect(parseSvgColor('none')).toBeNull();
    expect(parseSvgColor('url(#grad)')).toBeUndefined();
    expect(parseSvgColor('currentColor')).toBeUndefined();
  });
});

describe('SVG import safety', () => {
  const wrap = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${body}</svg>`;

  it('never reads scripts, links, outside pictures or embedded content, and says so', () => {
    const res = importSvg(wrap(`
      <script>alert(1)</script>
      <a href="https://evil.example"><rect x="0" y="0" width="10" height="10" stroke="#000"/></a>
      <image href="https://evil.example/x.png" x="0" y="0" width="10" height="10"/>
      <use href="#x"/>
      <foreignObject><div>hi</div></foreignObject>
      <style>rect{fill:red}</style>
      <rect x="20" y="20" width="10" height="10" stroke="#000" onclick="alert(1)" onload="x()"/>`));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.elements).toHaveLength(1);
    expect(JSON.stringify(res.elements)).not.toMatch(/evil|alert|onclick/);
    expect(res.notices.join(' ')).toMatch(/Scripts, links/);
  });

  it('refuses a file with entity definitions', () => {
    const res = importSvg('<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY a "aaaa">]><svg xmlns="http://www.w3.org/2000/svg"><text x="0" y="10">&a;</text></svg>');
    expect(res).toEqual({ ok: false, reason: expect.stringMatching(/entities/) });
  });

  it('decodes only the built in entities and character numbers', () => {
    const res = importSvg(wrap('<text x="10" y="20" fill="#000">A &amp; B &lt; C &#x41; &unknown;</text>'));
    expect(res.ok && (res.elements[0] as { text: string }).text).toBe('A & B < C A &unknown;');
  });

  it('refuses files that are not SVG, are empty, are broken or are too large', () => {
    expect(importSvg('')).toMatchObject({ ok: false });
    expect(importSvg('<html><body/></html>')).toMatchObject({ ok: false });
    expect(importSvg('<svg><rect></svg>')).toMatchObject({ ok: false });
    expect(importSvg('not xml at all')).toMatchObject({ ok: false });
    expect(importSvg('<svg ' + 'x'.repeat(SVG_IMPORT_LIMITS.maxChars) + '>')).toMatchObject({ ok: false, reason: expect.stringMatching(/too large/) });
    expect(importSvg('<svg xmlns="http://www.w3.org/2000/svg"><rect x="0" y="0" width="1" height="1" stroke="#000"/></svg>', 0)).toMatchObject({ ok: false });
    expect(importSvg(wrap('<defs><rect x="0" y="0" width="5" height="5" stroke="#000"/></defs>'))).toMatchObject({ ok: false });
  });

  it('caps depth, tag count and the number of objects it will bring in', () => {
    const deep = '<g>'.repeat(SVG_IMPORT_LIMITS.maxDepth + 5) + '<rect x="0" y="0" width="5" height="5" stroke="#000"/>' + '</g>'.repeat(SVG_IMPORT_LIMITS.maxDepth + 5);
    expect(importSvg(wrap(deep))).toMatchObject({ ok: false });
    const many = Array.from({ length: SVG_IMPORT_LIMITS.maxNodes + 10 }, () => '<rect x="0" y="0" width="1" height="1" stroke="#000"/>').join('');
    expect(importSvg(wrap(many))).toMatchObject({ ok: false });
    const some = Array.from({ length: 30 }, (_, i) => `<rect x="${i}" y="0" width="1" height="1" stroke="#000"/>`).join('');
    const res = importSvg(wrap(some), 10);
    expect(res.ok && res.elements).toHaveLength(10);
    expect(res.ok && res.skipped).toBe(20);
    expect(PAGE_OBJECT_CAP).toBeGreaterThan(10);
  });

  it('caps the points of one path and clamps wild numbers', () => {
    const long = 'M0 0 ' + Array.from({ length: 5000 }, (_, i) => `L${i} ${i % 50}`).join(' ');
    const res = importSvg(wrap(`<path d="${long}" stroke="#000"/>`));
    expect(res.ok).toBe(true);
    if (res.ok) expect((res.elements[0] as Extract<DrawingElement, { kind: 'stroke' }>).points.length).toBeLessThanOrEqual(SVG_IMPORT_LIMITS.strokePoints);
    const wild = importSvg(wrap('<rect x="1e30" y="0" width="5" height="5" stroke="#000"/><rect x="5" y="5" width="5" height="5" stroke="#000"/>'));
    expect(wild.ok && wild.elements).toHaveLength(1);
  });

  it('reads the typeface from a font list, by its generic family', () => {
    const res = importSvg(wrap(`
      <text x="10" y="30" font-family="Georgia, 'Times New Roman', serif" fill="#000">A</text>
      <text x="10" y="60" font-family="'Courier New', monospace" fill="#000">B</text>
      <text x="10" y="90" font-family="Inter, system-ui, sans-serif" fill="#000">C</text>
      <text x="10" y="120" font-family="Zapfino" fill="#000">D</text>`));
    expect(res.ok && res.elements.map((e) => propsOf(e).font)).toEqual(['serif', 'mono', undefined, undefined]);
  });

  it('ignores group ids that could carry anything but a plain name', () => {
    const res = importSvg(wrap(`
      <g data-kalam-group="a b&lt;c"><rect x="0" y="0" width="5" height="5" stroke="#000"/><rect x="9" y="0" width="5" height="5" stroke="#000"/></g>
      <g data-kalam-group="ok_1"><rect x="20" y="0" width="5" height="5" stroke="#000"/><rect x="29" y="0" width="5" height="5" stroke="#000"/></g>`));
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.elements[0]!.groupId).toBeUndefined();
      expect(res.elements[2]!.groupId).toBeTruthy();
      expect(res.elements[2]!.groupId).toBe(res.elements[3]!.groupId);
      expect(res.elements[2]!.groupId).not.toBe('ok_1');
    }
  });
});

describe('SVG import of hostile files', () => {
  const wrap = (body: string, attrs = 'viewBox="0 0 100 100"') => `<svg xmlns="http://www.w3.org/2000/svg" ${attrs}>${body}</svg>`;
  const good = '<rect x="5" y="5" width="10" height="10" stroke="#000"/>';
  const took = (fn: () => unknown): number => { const t = performance.now(); fn(); return performance.now() - t; };
  /** The bar is far above what linear code needs (milliseconds) and far below what the old patterns took (many seconds). */
  const FAST_MS = 3000;
  const sound = (els: DrawingElement[]) => els.every((e) => Object.values(e).every((v) => typeof v !== 'number' || Number.isFinite(v))
    && (e.kind !== 'stroke' || e.points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))));

  it('finishes quickly on very long attributes that used to take seconds', () => {
    const digits = `${'1'.repeat(40_000)}x`;
    const letters = 'a'.repeat(40_000);
    const spaces = ' '.repeat(40_000);
    for (const body of [
      `<rect x="${digits}" y="0" width="5" height="5" stroke="#000"/>`,
      `<rect x="0" y="0" width="5" height="5" stroke="#000" transform="${letters}"/>`,
      `<rect x="0" y="0" width="5" height="5" stroke="rgb(${spaces}" fill="rgb(1 ${spaces}"/>`,
      `<text x="0" y="10" font-size="${digits}" fill="#000">hi</text>`,
    ]) {
      expect(took(() => importSvg(wrap(body + good)))).toBeLessThan(FAST_MS);
    }
    // Just under the attribute cap the same input is still read, so the patterns themselves must be linear.
    const near = SVG_IMPORT_LIMITS.maxAttrChars - 10;
    expect(took(() => importSvg(wrap(`<rect x="${'1'.repeat(near)}x" y="0" width="5" height="5" stroke="#000"/>${good}`)))).toBeLessThan(FAST_MS);
    expect(took(() => importSvg(wrap(`<rect x="0" y="0" width="5" height="5" stroke="#000" transform="${'a'.repeat(near)}"/>${good}`)))).toBeLessThan(FAST_MS);
    // A value over the cap is the same as no value, so the rectangle falls back to x = 0 and still comes in.
    const res = importSvg(wrap(`<rect x="${digits}" y="0" width="5" height="5" stroke="#000"/>${good}`));
    expect(res.ok && res.elements).toHaveLength(2);
  });

  it('finishes quickly on a file full of long transforms and colours', () => {
    const near = SVG_IMPORT_LIMITS.maxAttrChars - 10;
    const rects = Array.from({ length: 400 }, () => `<rect x="0" y="0" width="5" height="5" stroke="#000" transform="${'a'.repeat(near)}"/>`).join('');
    expect(rects.length).toBeLessThan(SVG_IMPORT_LIMITS.maxChars);
    expect(took(() => importSvg(wrap(rects + good)))).toBeLessThan(FAST_MS);
    expect(took(() => parseSvgColor(`rgb(${' '.repeat(100_000)}`))).toBeLessThan(FAST_MS);
    expect(took(() => parseSvgColor(`rgb(1 2 3${' '.repeat(100_000)}x)`))).toBeLessThan(FAST_MS);
  });

  it('drops a value over its length cap, but keeps long path data and point lists', () => {
    const over = `<rect x="0" y="0" width="5" height="5" stroke="#000" data-note="${'n'.repeat(SVG_IMPORT_LIMITS.maxAttrChars + 1)}"/>`;
    expect(importSvg(wrap(over)).ok).toBe(true);
    const tooWide = `<rect x="0" y="0" width="${'5'.repeat(SVG_IMPORT_LIMITS.maxAttrChars + 1)}" height="5" stroke="#000"/>`;
    expect(importSvg(wrap(tooWide + good))).toMatchObject({ ok: true, skipped: 1 });
    const bigPath = `M0 0 ${Array.from({ length: 3000 }, (_, i) => `L${i % 90} ${(i * 7) % 90}`).join(' ')}`;
    expect(bigPath.length).toBeGreaterThan(SVG_IMPORT_LIMITS.maxAttrChars);
    expect(importSvg(wrap(`<path d="${bigPath}" stroke="#000"/>`)).ok).toBe(true);
    const hugePath = `M0 0 ${'L1 1 '.repeat(SVG_IMPORT_LIMITS.maxLongAttrChars / 4)}`;
    expect(importSvg(wrap(`<path d="${hugePath}" stroke="#000"/>${good}`))).toMatchObject({ ok: true, skipped: 1 });
  });

  it('leaves out shapes whose numbers are infinite, not numbers or far too large', () => {
    const bad = [
      '<polyline points="0,0 1e999,5" stroke="#000"/>',
      '<polygon points="0,0 5,5 -1e999,9" stroke="#000"/>',
      '<path d="M0 0 L1e999 5" stroke="#000"/>',
      '<path d="M0 0 L999999999 5" stroke="#000"/>',
      '<g data-kalam-kind="stroke" data-kalam-points="1e999,0 5,5"/>',
      '<g data-kalam-kind="stroke" data-kalam-points="0,0 5,500000"/>',
      '<g transform="scale(1e200)"><g transform="scale(1e200)"><rect x="1" y="1" width="5" height="5" stroke="#000"/></g></g>',
      '<g transform="scale(1e300)"><rect x="1" y="1" width="5" height="5" stroke="#000"/></g>',
      '<g data-kalam-kind="stamp" data-kalam-component="bigButton" data-kalam-box="0 0 1e999 40"/>',
      '<text x="1" y="9" font-size="16" fill="#000" transform="translate(1e99 0)">far</text>',
    ];
    for (const body of bad) {
      const res = importSvg(wrap(body + good));
      expect(res.ok, body).toBe(true);
      if (!res.ok) continue;
      expect(res.elements, body).toHaveLength(1);
      expect(res.skipped, body).toBeGreaterThanOrEqual(1);
      expect(sound(res.elements), body).toBe(true);
    }
    // Only bad shapes in the file: nothing comes in, and it says so instead of adding broken objects.
    expect(importSvg(wrap(bad[0]!))).toMatchObject({ ok: false });
  });

  it('does not let a hostile view box shrink everything to nothing', () => {
    for (const attrs of ['viewBox="0 0 1e999 1e999"', 'viewBox="0 0 100 1e300"', 'viewBox="-1e999 0 100 100"']) {
      const res = importSvg(wrap(good, attrs));
      expect(res.ok, attrs).toBe(true);
      if (res.ok) {
        expect(sound(res.elements), attrs).toBe(true);
        const r = res.elements[0] as Geo;
        expect(r.w, attrs).toBeGreaterThan(1);
      }
    }
  });

  it('keeps every number it lets through finite and inside the page limits', () => {
    const res = importSvg(wrap('<polyline points="0,0 90000,90000" stroke="#000"/>'));
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(sound(res.elements)).toBe(true);
      const s = res.elements[0] as Extract<DrawingElement, { kind: 'stroke' }>;
      expect(Math.max(...s.points.map((p) => Math.abs(p.x)))).toBeLessThan(PAGE_WIDTH + 5);
    }
  });
});
