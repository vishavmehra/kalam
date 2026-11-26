/** Skia renderer for the drawing display list (Android canvas, page thumbnails and Android PNG export). */
import {
  matchFont, PaintStyle, Skia, StrokeCap, StrokeJoin, type SkCanvas, type SkFont, type SkPath,
} from '@shopify/react-native-skia';
import { palette } from '@/design/tokens';
import { images } from './image-cache.native';
import type { Primitive } from './model';
import { drawShapedText } from './skia-text';

const fonts = new Map<string, SkFont>();
/** System families for the typefaces a person can pick for text. */
const FAMILY = { sans: 'sans-serif', serif: 'serif', mono: 'monospace' } as const;
function font(size: number, bold?: boolean, face: keyof typeof FAMILY = 'sans'): SkFont {
  const key = `${size}:${bold ? 1 : 0}:${face}`;
  let f = fonts.get(key);
  if (!f) {
    f = matchFont({ fontFamily: FAMILY[face], fontSize: size, fontWeight: bold ? 'bold' : 'normal' });
    fonts.set(key, f);
  }
  return f;
}

const paths = new Map<string, SkPath | null>();
function svgPath(d: string): SkPath | null {
  if (!paths.has(d)) {
    if (paths.size > 4000) paths.clear();
    paths.set(d, Skia.Path.MakeFromSVGString(d));
  }
  return paths.get(d) ?? null;
}

function paint(color: string, style: 'fill' | 'stroke', width = 1, opacity = 1, dash = false) {
  const p = Skia.Paint();
  p.setAntiAlias(true);
  p.setColor(Skia.Color(color));
  p.setAlphaf(opacity);
  p.setStyle(style === 'fill' ? PaintStyle.Fill : PaintStyle.Stroke);
  if (style === 'stroke') {
    p.setStrokeWidth(width);
    p.setStrokeCap(StrokeCap.Round);
    p.setStrokeJoin(StrokeJoin.Round);
    if (dash) p.setPathEffect(Skia.PathEffect.MakeDash([width * 4, width * 3], 0));
  }
  return p;
}

export function drawPrimitivesSkia(canvas: SkCanvas, prims: readonly Primitive[]): void {
  for (const p of prims) {
    switch (p.t) {
      case 'path': {
        const path = p.d ? svgPath(p.d) : null;
        if (!path) break;
        if (p.fill) canvas.drawPath(path, paint(p.fill, 'fill', 1, p.opacity ?? 1));
        if (p.stroke) canvas.drawPath(path, paint(p.stroke, 'stroke', p.width ?? 1, p.opacity ?? 1));
        break;
      }
      case 'rect': {
        const rrect = Skia.RRectXY(Skia.XYWHRect(p.x, p.y, p.w, p.h), p.r ?? 0, p.r ?? 0);
        if (p.fill) canvas.drawRRect(rrect, paint(p.fill, 'fill'));
        if (p.stroke) canvas.drawRRect(rrect, paint(p.stroke, 'stroke', p.width ?? 1, 1, p.dash));
        break;
      }
      case 'ellipse': {
        const oval = Skia.XYWHRect(p.cx - p.rx, p.cy - p.ry, p.rx * 2, p.ry * 2);
        if (p.fill) canvas.drawOval(oval, paint(p.fill, 'fill'));
        if (p.stroke) canvas.drawOval(oval, paint(p.stroke, 'stroke', p.width ?? 1));
        break;
      }
      case 'line':
        canvas.drawLine(p.x1, p.y1, p.x2, p.y2, paint(p.stroke, 'stroke', p.width, 1, p.dash));
        break;
      case 'text': {
        // Indic scripts need a shaper; the paragraph path draws them once their fonts are registered.
        if (drawShapedText(canvas, p)) break;
        const f = font(p.size, p.bold, p.font);
        const w = p.align === 'center' ? f.measureText(p.text).width : 0;
        // Display-list text y is the top of the line; Skia draws from the baseline.
        canvas.drawText(p.text, p.x - w / 2, p.y + p.size * 0.82, paint(p.color, 'fill'), f);
        break;
      }
      case 'image': {
        const img = images.get(p.blobId);
        if (img) {
          canvas.drawImageRect(img, Skia.XYWHRect(0, 0, img.width(), img.height()), Skia.XYWHRect(p.x, p.y, p.w, p.h), paint(palette.neutral[0], 'fill'));
        } else {
          const rrect = Skia.RRectXY(Skia.XYWHRect(p.x, p.y, p.w, p.h), 6, 6);
          canvas.drawRRect(rrect, paint(palette.neutral[100], 'fill'));
          canvas.drawRRect(rrect, paint(palette.neutral[300], 'stroke', 1.5, 1, true));
        }
        break;
      }
      case 'push':
        canvas.save();
        canvas.rotate(p.rot, p.cx, p.cy);
        break;
      case 'pop':
        canvas.restore();
        break;
    }
  }
}
