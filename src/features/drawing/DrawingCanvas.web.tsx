/**
 * Web canvas (docs/08 §4): HTML Canvas 2D at device-pixel resolution, pointer events with pen
 * pressure and coalesced samples, wheel/pinch zoom, space- or middle-drag pan, a brush-size
 * cursor preview, handle cursors and keyboard shortcuts. Drawing happens in rAF from a store
 * subscription, so strokes never re-render React.
 */
import { useEffect, useRef } from 'react';
import { View } from 'react-native';
import type { StoreApi } from 'zustand/vanilla';
import { useStore } from 'zustand';
import { useKalamTheme } from '@/design';
import { images } from './image-cache.web';
import { DEFAULT_PAGE_COLOR, PAGE_HEIGHT, PAGE_WIDTH, type HandleId } from './model';
import { drawPrimitives } from './render-canvas';
import {
  canvasLabel, currentPage, isInkTool, selectBaseVisible, selectChrome, selectLive, toDocPoint, type StudioState, type Tool,
} from './studio-store';
import { TOOL_KEYS } from './shortcuts';
import { subscribeTextFonts } from './text-fonts';
import { TextEditOverlay } from './TextEditOverlay';

const INK_SCALE: Partial<Record<Tool, number>> = { pen: 1, marker: 1.6, highlighter: 3 };
const HANDLE_CURSOR: Record<HandleId, string> = {
  nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', rotate: 'grab',
};
/** A touch that lands this soon after the pen was seen is a resting palm (docs/08 §8.4). */
const PALM_MS = 1200;

function toolCursor(tool: Tool): string {
  return tool === 'text' ? 'text' : tool === 'stamp' ? 'copy' : tool === 'select' ? 'default' : 'none';
}

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
}

export function DrawingCanvas({ store }: { store: StoreApi<StudioState> }) {
  const { colors, scheme } = useKalamTheme();
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cursorRef = useRef<HTMLDivElement>(null);
  // Re-run the render effect only when the workspace palette changes.
  const tool = useStore(store, (s) => s.tool);
  const workspace = colors.surfaceAlt;
  const border = colors.borderStrong;
  // Tinted to the ink with a y-offset, never a glow (DIRECTION §2.4): at ink night the shadow is darker, not light.
  const shadow = `rgb(${colors.shadowRgb} / ${scheme === 'dark' ? 0.55 : 0.22})`;

  // Size + render loop.
  useEffect(() => {
    const wrap = wrapRef.current; const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    let frame = 0;
    const draw = () => {
      frame = 0;
      const s = store.getState();
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const dpr = window.devicePixelRatio || 1;
      const { scale, tx, ty } = s.view;
      const page = currentPage(s);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = workspace;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * tx, dpr * ty);
      ctx.save();
      ctx.shadowColor = shadow;
      ctx.shadowBlur = 18 * dpr;
      ctx.shadowOffsetY = 4 * dpr;
      ctx.fillStyle = page.backgroundColor ?? DEFAULT_PAGE_COLOR;
      ctx.fillRect(0, 0, PAGE_WIDTH, PAGE_HEIGHT);
      ctx.restore();
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, PAGE_WIDTH, PAGE_HEIGHT);
      ctx.clip();
      drawPrimitives(ctx, selectBaseVisible(s));
      drawPrimitives(ctx, selectLive(s));
      ctx.restore();
      ctx.strokeStyle = border;
      ctx.lineWidth = 1 / scale;
      ctx.strokeRect(0, 0, PAGE_WIDTH, PAGE_HEIGHT);
      drawPrimitives(ctx, selectChrome(s));
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(draw); };
    const resize = () => {
      const r = wrap.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(r.width * dpr));
      canvas.height = Math.max(1, Math.round(r.height * dpr));
      canvas.style.width = `${r.width}px`;
      canvas.style.height = `${r.height}px`;
      store.getState().setViewport(r.width, r.height);
      schedule();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    resize();
    const unsub = store.subscribe(schedule);
    const unsubImages = images.subscribe(schedule);
    // Hindi, Tamil and the other scripts draw again once their Noto font has loaded.
    const unsubFonts = subscribeTextFonts(schedule);
    return () => { ro.disconnect(); unsub(); unsubImages(); unsubFonts(); if (frame) cancelAnimationFrame(frame); };
  }, [store, workspace, border, shadow]);

  // Spoken description: page, tool, selection (docs/10 §10.4). Set on the element, not through React.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let last = '';
    const update = () => {
      const label = canvasLabel(store.getState());
      if (label !== last) { last = label; canvas.setAttribute('aria-label', label); }
    };
    update();
    return store.subscribe(update);
  }, [store]);

  // Pointer, wheel and keyboard input.
  useEffect(() => {
    const canvas = canvasRef.current; const cursor = cursorRef.current;
    if (!canvas || !cursor) return;
    const pointers = new Map<number, { x: number; y: number }>();
    // Pan and pinch state lives in the store's gesture (docs/08 §8.2); only raw pointer bookkeeping stays here.
    const viewGesture = () => store.getState().gesture?.kind;
    let space = false;
    let drawing = false;
    let lastPenAt = -Infinity;
    let hover = '';

    const applyCursor = () => {
      canvas.style.cursor = viewGesture() === 'pan' ? 'grabbing' : space ? 'grab' : hover || toolCursor(store.getState().tool);
    };
    const local = (e: PointerEvent | WheelEvent) => {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const docPoint = (e: PointerEvent) => {
      const { x, y } = local(e);
      return toDocPoint(store.getState().view, x, y, e.pointerType === 'pen' ? e.pressure : undefined);
    };
    const pinchState = () => {
      const [a, b] = [...pointers.values()];
      return { dist: Math.hypot(a!.x - b!.x, a!.y - b!.y), cx: (a!.x + b!.x) / 2, cy: (a!.y + b!.y) / 2 };
    };
    const updateCursor = (e: PointerEvent) => {
      const s = store.getState();
      const show = e.pointerType !== 'touch' && (isInkTool(s.tool) || s.tool === 'eraser') && viewGesture() !== 'pan' && !space;
      cursor.style.display = show ? 'block' : 'none';
      if (!show) return;
      const d = s.tool === 'eraser' ? Math.max(12, s.size * 4) : s.size * (INK_SCALE[s.tool] ?? 1) * s.view.scale;
      const { x, y } = local(e);
      cursor.style.width = `${d}px`; cursor.style.height = `${d}px`;
      cursor.style.transform = `translate(${x - d / 2}px, ${y - d / 2}px)`;
    };

    const down = (e: PointerEvent) => {
      if (e.pointerType === 'touch' && pointers.size === 0 && performance.now() - lastPenAt < PALM_MS) return;
      if (e.pointerType === 'pen') lastPenAt = performance.now();
      canvas.setPointerCapture(e.pointerId);
      canvas.focus({ preventScroll: true });
      pointers.set(e.pointerId, local(e));
      if (pointers.size === 2) {
        // A second finger turns whatever was happening into a pinch, so it never draws a second stroke.
        if (drawing) { drawing = false; }
        const p = pinchState();
        store.getState().beginPinch(p.cx, p.cy, p.dist);
        return;
      }
      if (pointers.size > 2) return;
      if (e.button === 1 || space) { const l = local(e); store.getState().beginPan(l.x, l.y); applyCursor(); return; }
      if (e.button !== 0) return;
      e.preventDefault();
      drawing = true;
      store.getState().pointerDown(docPoint(e), { additive: e.shiftKey || e.ctrlKey || e.metaKey });
    };
    const move = (e: PointerEvent) => {
      if (e.pointerType === 'pen') lastPenAt = performance.now();
      updateCursor(e);
      if (!pointers.has(e.pointerId)) {
        const h = e.pointerType === 'mouse' || e.pointerType === 'pen' ? store.getState().handleAt(docPoint(e)) : undefined;
        const next = h ? HANDLE_CURSOR[h] : '';
        if (next !== hover) { hover = next; applyCursor(); }
        return;
      }
      pointers.set(e.pointerId, local(e));
      const s = store.getState();
      const kind = s.gesture?.kind;
      if (kind === 'pinch' && pointers.size >= 2) {
        const next = pinchState();
        s.pinchTo(next.cx, next.cy, next.dist);
      } else if (kind === 'pan') {
        const p = local(e);
        s.panTo(p.x, p.y);
      } else if (drawing) {
        const events = e.getCoalescedEvents?.() ?? [];
        for (const ce of events.length ? events : [e]) s.pointerMove(docPoint(ce), { constrain: e.shiftKey });
      }
    };
    const up = (e: PointerEvent) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.delete(e.pointerId);
      const kind = viewGesture();
      if (kind === 'pinch') { if (pointers.size < 2) store.getState().endView(); return; }
      if (kind === 'pan') { store.getState().endView(); applyCursor(); return; }
      if (drawing) {
        drawing = false;
        if (e.type === 'pointercancel') store.getState().cancelPointer(); else store.getState().pointerUp();
      }
    };
    const leave = () => { cursor.style.display = 'none'; };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const s = store.getState();
      const { x, y } = local(e);
      if (e.ctrlKey || e.metaKey) s.zoomBy(Math.exp(-e.deltaY * 0.01), x, y);
      else s.panBy(-e.deltaX, -e.deltaY);
    };
    /** Editing keys apply when the canvas or the page body has focus, never on a focused control or while typing. */
    const canvasFocused = (t: EventTarget | null) => t === document.body || t === canvas || t === null;
    const key = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      const s = store.getState();
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      const focused = canvasFocused(e.target);
      if (mod && k === 'z') { e.preventDefault(); if (e.shiftKey) s.redo(); else s.undo(); return; }
      if (mod && k === 'y') { e.preventDefault(); s.redo(); return; }
      if (mod && (k === '=' || k === '+')) { e.preventDefault(); s.zoomBy(1.2); return; }
      if (mod && k === '-') { e.preventDefault(); s.zoomBy(1 / 1.2); return; }
      if (mod && k === '0') { e.preventDefault(); s.fitPage(); return; }
      if (mod && focused) {
        if (k === 'c') { e.preventDefault(); s.copySelected(); }
        else if (k === 'x') { e.preventDefault(); s.cutSelected(); }
        else if (k === 'v') { e.preventDefault(); s.paste(); }
        else if (k === 'd') { e.preventDefault(); s.duplicateSelected(); }
        else if (k === 'g') { e.preventDefault(); if (e.shiftKey) s.ungroupSelected(); else s.groupSelected(); }
        else if (k === 'a') { e.preventDefault(); s.setTool('select'); store.getState().selectAll(); }
        else if (k === ']' || k === '[') { e.preventDefault(); s.reorderSelected(k === ']' ? 'front' : 'back'); }
        return;
      }
      if (mod || e.altKey) return;
      if (e.key === 'Escape') { s.clearSelection(); s.cancelPointer(); return; }
      if (focused) {
        if (e.key === 'Delete' || e.key === 'Backspace') { if (s.selectedIds.length) { e.preventDefault(); s.deleteSelected(); } return; }
        if (e.key === ' ') { space = true; applyCursor(); e.preventDefault(); return; }
        if (e.key.startsWith('Arrow') && s.selectedIds.length) {
          e.preventDefault();
          const step = e.shiftKey ? 10 : 1;
          s.nudgeSelected(e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0, e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0);
          return;
        }
      }
      if (k === '+' || k === '=') { s.zoomBy(1.2); return; }
      if (k === '-') { s.zoomBy(1 / 1.2); return; }
      if (k === '0') { s.fitPage(); return; }
      if (k === ']') { s.reorderSelected('forward'); return; }
      if (k === '[') { s.reorderSelected('backward'); return; }
      const t = TOOL_KEYS[k];
      if (t) s.setTool(t);
    };
    const keyUp = (e: KeyboardEvent) => { if (e.key === ' ') { space = false; applyCursor(); } };

    applyCursor();
    const unsubTool = store.subscribe((s, prev) => { if (s.tool !== prev.tool) applyCursor(); });
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('pointerleave', leave);
    canvas.addEventListener('wheel', wheel, { passive: false });
    window.addEventListener('keydown', key);
    window.addEventListener('keyup', keyUp);
    return () => {
      unsubTool();
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', up);
      canvas.removeEventListener('pointerleave', leave);
      canvas.removeEventListener('wheel', wheel);
      window.removeEventListener('keydown', key);
      window.removeEventListener('keyup', keyUp);
    };
  }, [store]);

  return (
    <View style={{ flex: 1, overflow: 'hidden', backgroundColor: workspace }}>
      <div ref={wrapRef} style={{ position: 'absolute', inset: 0 }}>
        <canvas
          ref={canvasRef}
          role="img"
          aria-label="Drawing canvas. Choose a tool from the toolbar. Keys: P pen, E eraser, V select, T text."
          data-tool={tool}
          tabIndex={0}
          style={{ display: 'block', touchAction: 'none', outline: 'none' }}
        />
        <div
          ref={cursorRef}
          aria-hidden
          style={{
            position: 'absolute', left: 0, top: 0, display: 'none', pointerEvents: 'none', borderRadius: '50%',
            border: `1.5px solid ${colors.text}`, boxShadow: `0 0 0 1px ${colors.surface}`,
          }}
        />
      </div>
      <TextEditOverlay store={store} />
    </View>
  );
}
