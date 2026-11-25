/**
 * SVG export of one page (docs/08 §14.1). The SVG is written from the same display list the canvas and the
 * PNG export draw, so it looks the same. Every object is its own `<g>` with its id, and group members carry
 * `data-kalam-group`, so groups survive export and a re-import. Nothing is flattened into a bitmap except
 * photos, which are embedded as data URIs when their bytes are supplied.
 */
import type { DrawingElement, DrawingPage } from '@/core/contracts';
import { canvasFontStack, needsScriptFont } from './text-script';
import { backdrop, elementPrimitives, type Primitive } from './display';

export interface SvgOptions {
  /** `data:` URI for a stored photo. Without it a photo is drawn as a dashed placeholder box. */
  imageHref?: (blobId: string) => string | undefined;
}

const ENTITIES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };
const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => ENTITIES[c]!);
/** Drops characters XML 1.0 cannot hold at all: most control characters and the two non-characters. */
const xmlSafe = (s: string): string => Array.from(s).filter((c) => {
  const n = c.charCodeAt(0);
  return (n >= 32 || n === 9 || n === 10 || n === 13) && n !== 0xfffe && n !== 0xffff;
}).join('');
const num = (n: number): string => (Number.isFinite(n) ? String(Math.round(n * 100) / 100) : '0');
const idSafe = (s: string): string => s.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64);

const SANS = 'Inter, system-ui, -apple-system, "Segoe UI", sans-serif';
const FONTS = { sans: SANS, serif: 'Fraunces, Georgia, "Times New Roman", serif', mono: 'ui-monospace, Menlo, Consolas, monospace' } as const;

function paintAttrs(fill: string | undefined, stroke: string | undefined, width: number | undefined, dash?: boolean): string {
  const parts = [`fill="${fill ? esc(fill) : 'none'}"`];
  if (stroke) {
    parts.push(`stroke="${esc(stroke)}" stroke-width="${num(width ?? 1)}" stroke-linecap="round" stroke-linejoin="round"`);
    if (dash) parts.push(`stroke-dasharray="${num((width ?? 1) * 4)} ${num((width ?? 1) * 3)}"`);
  }
  return parts.join(' ');
}

function primitiveToSvg(p: Primitive, href: SvgOptions['imageHref']): string {
  switch (p.t) {
    case 'path':
      return p.d ? `<path d="${esc(p.d)}" ${paintAttrs(p.fill, p.stroke, p.width)}${p.opacity !== undefined && p.opacity !== 1 ? ` opacity="${num(p.opacity)}"` : ''}/>` : '';
    case 'rect': {
      const r = Math.max(0, Math.min(p.r ?? 0, p.w / 2, p.h / 2));
      return `<rect x="${num(p.x)}" y="${num(p.y)}" width="${num(p.w)}" height="${num(p.h)}"${r ? ` rx="${num(r)}"` : ''} ${paintAttrs(p.fill, p.stroke, p.width, p.dash)}/>`;
    }
    case 'ellipse':
      return `<ellipse cx="${num(p.cx)}" cy="${num(p.cy)}" rx="${num(Math.max(0, p.rx))}" ry="${num(Math.max(0, p.ry))}" ${paintAttrs(p.fill, p.stroke, p.width)}/>`;
    case 'line':
      return `<line x1="${num(p.x1)}" y1="${num(p.y1)}" x2="${num(p.x2)}" y2="${num(p.y2)}" ${paintAttrs(undefined, p.stroke, p.width, p.dash)}/>`;
    case 'text': {
      const latin = FONTS[p.font ?? 'sans'];
      const stack = needsScriptFont(p.text) ? canvasFontStack(p.text, p.bold ? 'semibold' : 'regular', 'Inter') ?? latin : latin;
      // The display list stores the top of the line; SVG wants the baseline.
      const y = p.y + p.size * 0.82;
      return `<text x="${num(p.x)}" y="${num(y)}" font-family="${esc(stack)}" font-size="${num(p.size)}"${p.bold ? ' font-weight="600"' : ''}${p.align === 'center' ? ' text-anchor="middle"' : ''} fill="${esc(p.color)}" xml:space="preserve">${esc(xmlSafe(p.text))}</text>`;
    }
    case 'image': {
      const uri = href?.(p.blobId);
      if (uri && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(uri)) {
        return `<image x="${num(p.x)}" y="${num(p.y)}" width="${num(p.w)}" height="${num(p.h)}" preserveAspectRatio="none" href="${uri}"/>`;
      }
      return `<rect x="${num(p.x)}" y="${num(p.y)}" width="${num(p.w)}" height="${num(p.h)}" rx="6" fill="none" stroke="#999999" stroke-width="1.5" stroke-dasharray="6 4"/>`;
    }
    case 'push':
      return `<g transform="rotate(${num(p.rot)} ${num(p.cx)} ${num(p.cy)})">`;
    case 'pop':
      return '</g>';
  }
}

/**
 * Extra attributes only Kalam reads back. A pen stroke is drawn as an outline path, which other programs show
 * fine, but only the points can rebuild an editable stroke. Stamps keep what the person meant by them.
 */
function nativeAttrs(el: DrawingElement): string {
  if (el.kind === 'stroke' && el.points.length <= 600) {
    const pts = el.points.map((p) => `${num(p.x)},${num(p.y)}`).join(' ');
    return ` data-kalam-kind="stroke" data-kalam-tool="${el.tool}" data-kalam-size="${num(el.size)}" data-kalam-color="${esc(el.color)}" data-kalam-points="${pts}"`;
  }
  if (el.kind === 'stamp') {
    const label = el.label ? ` data-kalam-label="${esc(xmlSafe(el.label))}"` : '';
    return ` data-kalam-kind="stamp" data-kalam-component="${esc(el.component)}"${label} data-kalam-box="${num(el.x)} ${num(el.y)} ${num(Math.abs(el.w))} ${num(Math.abs(el.h))}"${el.rotation ? ` data-kalam-rotation="${num(el.rotation)}"` : ''}`;
  }
  return '';
}

/** The page as a standalone SVG document. Hidden objects are left out. */
export function pageToSvg(page: DrawingPage, options: SvgOptions = {}): string {
  const out: string[] = [];
  out.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${num(page.width)}" height="${num(page.height)}" viewBox="0 0 ${num(page.width)} ${num(page.height)}" role="img" aria-label="${esc(xmlSafe(page.title))}">`,
  );
  out.push(`<title>${esc(xmlSafe(page.title))}</title>`);
  out.push(`<g id="paper">${backdrop(page).map((p) => primitiveToSvg(p, options.imageHref)).join('')}</g>`);
  for (const el of page.elements) {
    if (el.hidden) continue;
    const body = elementPrimitives(el).map((p) => primitiveToSvg(p, options.imageHref)).join('');
    if (!body) continue;
    const group = el.groupId ? ` data-kalam-group="${esc(idSafe(el.groupId))}"` : '';
    const alt = el.kind === 'image' && el.alt ? ` aria-label="${esc(xmlSafe(el.alt))}" role="img"` : '';
    out.push(`<g id="${esc(idSafe(el.id))}"${group}${alt}${nativeAttrs(el)}>${body}</g>`);
  }
  out.push('</svg>');
  return out.join('\n');
}
