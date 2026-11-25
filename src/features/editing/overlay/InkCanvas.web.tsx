/**
 * Web ink layer: a Canvas 2D at device-pixel resolution over the running app. Pointer events with
 * coalesced samples and pointer capture; drawing happens in rAF, so a live stroke never
 * re-renders React. Only the primary pointer draws (a second finger is ignored).
 */
import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { drawPrimitives } from '@/features/drawing/render-canvas';
import type { InkPoint } from './gestures';
import { strokePrimitives, type InkCanvasProps } from './ink';

export function InkCanvas({ strokes, style, enabled, tool, onStrokeStart, onStrokeEnd }: InkCanvasProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const live = useRef<InkPoint[] | null>(null);
  const pointer = useRef<number | null>(null);
  const frame = useRef(0);
  const latest = useRef({ strokes, style, tool, onStrokeStart, onStrokeEnd });
  latest.current = { strokes, style, tool, onStrokeStart, onStrokeEnd };

  const draw = useCallback(() => {
    frame.current = 0;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const { strokes: done, style: s, tool: t } = latest.current;
    const prims = done.flatMap((k) => strokePrimitives(k, s));
    if (live.current && t === 'pen') prims.push(...strokePrimitives({ id: 'live', points: live.current }, s, false));
    drawPrimitives(ctx, prims);
  }, []);
  const schedule = useCallback(() => {
    if (!frame.current) frame.current = requestAnimationFrame(draw);
  }, [draw]);

  useEffect(schedule, [strokes, style, schedule]);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return undefined;
    const resize = () => {
      const r = wrap.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(r.width * dpr));
      canvas.height = Math.max(1, Math.round(r.height * dpr));
      canvas.style.width = `${r.width}px`;
      canvas.style.height = `${r.height}px`;
      schedule();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    resize();
    return () => {
      ro.disconnect();
      if (frame.current) cancelAnimationFrame(frame.current);
      frame.current = 0;
    };
  }, [schedule]);

  // A stroke in progress when drawing is switched off is dropped, not committed.
  useEffect(() => {
    if (enabled || !live.current) return;
    live.current = null;
    pointer.current = null;
    schedule();
  }, [enabled, schedule]);

  const local = (e: { clientX: number; clientY: number; timeStamp: number }): InkPoint => {
    const r = canvasRef.current?.getBoundingClientRect();
    return { x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0), t: e.timeStamp };
  };

  const finish = (commit: boolean) => {
    const pts = live.current;
    live.current = null;
    pointer.current = null;
    schedule();
    if (commit && pts?.length) latest.current.onStrokeEnd(pts);
  };

  return (
    <div
      ref={wrapRef}
      aria-hidden
      style={{ position: 'absolute', inset: 0, touchAction: 'none', pointerEvents: enabled ? 'auto' : 'none', userSelect: 'none' }}
    >
      <canvas
        ref={canvasRef}
        style={{ display: 'block', cursor: tool === 'note' ? 'text' : 'crosshair' }}
        onPointerDown={(e: ReactPointerEvent<HTMLCanvasElement>) => {
          if (!enabled || pointer.current !== null || (e.pointerType === 'mouse' && e.button !== 0)) return;
          e.preventDefault();
          e.currentTarget.setPointerCapture(e.pointerId);
          pointer.current = e.pointerId;
          live.current = [local(e)];
          latest.current.onStrokeStart?.();
          schedule();
        }}
        onPointerMove={(e: ReactPointerEvent<HTMLCanvasElement>) => {
          if (e.pointerId !== pointer.current || !live.current) return;
          const samples = e.nativeEvent.getCoalescedEvents?.() ?? [];
          for (const s of samples.length ? samples : [e.nativeEvent]) live.current.push(local(s));
          schedule();
        }}
        onPointerUp={(e: ReactPointerEvent<HTMLCanvasElement>) => {
          if (e.pointerId === pointer.current) finish(true);
        }}
        onPointerCancel={(e: ReactPointerEvent<HTMLCanvasElement>) => {
          if (e.pointerId === pointer.current) finish(false);
        }}
      />
    </div>
  );
}
