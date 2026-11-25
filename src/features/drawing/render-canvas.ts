/** Canvas 2D renderer for the drawing display list (web canvas, page thumbnails and web PNG export). */
import { palette } from '@/design/tokens';
import { images } from './image-cache.web';
import type { Primitive } from './model';

const FONT = 'Inter, system-ui, -apple-system, "Segoe UI", sans-serif';
const pathCache = new Map<string, Path2D>();

function path2d(d: string): Path2D {
  let p = pathCache.get(d);
  if (!p) {
    if (pathCache.size > 4000) pathCache.clear();
    p = new Path2D(d);
    pathCache.set(d, p);
  }
  return p;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** Stand-in while a photo loads, or if its bytes are gone. */
function drawImagePlaceholder(ctx: CanvasRenderingContext2D, p: Extract<Primitive, { t: 'image' }>) {
  roundRect(ctx, p.x, p.y, p.w, p.h, 6);
  ctx.fillStyle = palette.neutral[100];
  ctx.fill();
  ctx.strokeStyle = palette.neutral[300];
  ctx.lineWidth = 1.5;
  ctx.setLineDash([6, 4]);
  ctx.stroke();
}

export function drawPrimitives(ctx: CanvasRenderingContext2D, prims: readonly Primitive[]): void {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const p of prims) {
    ctx.globalAlpha = 1;
    ctx.setLineDash([]);
    switch (p.t) {
      case 'path': {
        if (!p.d) break;
        const path = path2d(p.d);
        ctx.globalAlpha = p.opacity ?? 1;
        if (p.fill) { ctx.fillStyle = p.fill; ctx.fill(path); }
        if (p.stroke) { ctx.strokeStyle = p.stroke; ctx.lineWidth = p.width ?? 1; ctx.stroke(path); }
        break;
      }
      case 'rect':
        roundRect(ctx, p.x, p.y, p.w, p.h, p.r ?? 0);
        if (p.fill) { ctx.fillStyle = p.fill; ctx.fill(); }
        if (p.stroke) {
          if (p.dash) ctx.setLineDash([(p.width ?? 1) * 4, (p.width ?? 1) * 3]);
          ctx.strokeStyle = p.stroke; ctx.lineWidth = p.width ?? 1; ctx.stroke();
        }
        break;
      case 'ellipse':
        ctx.beginPath();
        ctx.ellipse(p.cx, p.cy, Math.max(0, p.rx), Math.max(0, p.ry), 0, 0, Math.PI * 2);
        if (p.fill) { ctx.fillStyle = p.fill; ctx.fill(); }
        if (p.stroke) { ctx.strokeStyle = p.stroke; ctx.lineWidth = p.width ?? 1; ctx.stroke(); }
        break;
      case 'line':
        ctx.beginPath();
        ctx.moveTo(p.x1, p.y1);
        ctx.lineTo(p.x2, p.y2);
        if (p.dash) ctx.setLineDash([p.width * 4, p.width * 3]);
        ctx.strokeStyle = p.stroke; ctx.lineWidth = p.width; ctx.stroke();
        break;
      case 'text':
        ctx.font = `${p.bold ? 600 : 400} ${p.size}px ${FONT}`;
        ctx.textBaseline = 'top';
        ctx.textAlign = p.align ?? 'left';
        ctx.fillStyle = p.color;
        ctx.fillText(p.text, p.x, p.y);
        break;
      case 'image': {
        const img = images.get(p.blobId);
        if (img) ctx.drawImage(img, p.x, p.y, p.w, p.h);
        else drawImagePlaceholder(ctx, p);
        break;
      }
      case 'push':
        ctx.save();
        ctx.translate(p.cx, p.cy);
        ctx.rotate((p.rot * Math.PI) / 180);
        ctx.translate(-p.cx, -p.cy);
        break;
      case 'pop':
        ctx.restore();
        break;
    }
  }
  ctx.globalAlpha = 1;
  ctx.setLineDash([]);
}
