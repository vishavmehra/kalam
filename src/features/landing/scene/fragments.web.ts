/**
 * The five ways into Kalam as small 3D objects (web only, loaded with three.js on demand):
 * a typed note, a live voice waveform, a strip of video frames, a photo of a paper sketch and a
 * Drawing Studio page. The landing hero and the creation progress stage both assemble these
 * into an app screen. Everything is painted once into canvas textures (the waveform is a tiny
 * shader) so each fragment is one draw call.
 */
import * as THREE from 'three';

import type { FragmentKind } from './kinds';
export type { FragmentKind };

export interface ScenePalette {
  dark: boolean;
  /** Pen ink used for writing on paper. */
  ink: string;
  /** Kalam primary ink (voice card). */
  brand: string;
  marigold: string;
  paper: string;
  rule: string;
  margin: string;
  /** Near-black for device bodies and the film strip. */
  device: string;
  shadow: string;
}

export function scenePalette(dark: boolean): ScenePalette {
  return {
    dark,
    ink: '#1E2563',
    brand: dark ? '#2B3388' : '#283080',
    marigold: '#F2AE1C',
    paper: dark ? '#DCDEEA' : '#FFFFFF',
    rule: dark ? 'rgba(40,48,128,0.16)' : 'rgba(40,48,128,0.13)',
    margin: dark ? 'rgba(200,80,74,0.55)' : 'rgba(214,92,86,0.55)',
    device: '#171A2B',
    shadow: dark ? 'rgba(0,0,0,0.5)' : 'rgba(22,26,61,0.2)',
  };
}

export interface Fragment {
  kind: FragmentKind;
  /** Move / rotate / scale this. */
  group: THREE.Group;
  /** 0..1 — fades every material of the fragment. */
  opacity: { value: number };
  /** Advance internal animation; returns true when the frame changed. */
  update(time: number): boolean;
  /** Redraws canvas text (after the real fonts arrive). */
  repaint?(): void;
  dispose(): void;
}

/** Logical canvas px per world unit (textures are painted at 2× for sharpness). */
const PX = 200;
const SCALE = 2;
const FONT = { ui: '"Inter", system-ui, sans-serif', semibold: '"Inter_600SemiBold", "Inter", system-ui, sans-serif', serif: '"Fraunces", Georgia, serif' };

/**
 * Waits for the web fonts, but never longer than `maxMs`: a slow font download must not leave the
 * stage blank. Resolves true when the fonts were ready in time; `late` resolves when they arrive.
 */
export async function fontsOrTimeout(maxMs = 1200): Promise<{ ready: boolean; late: Promise<void> }> {
  const late = loadSceneFonts();
  const ready = await Promise.race([late.then(() => true), new Promise<boolean>((r) => setTimeout(() => r(false), maxMs))]);
  return { ready, late };
}

/** Waits for the app's web fonts so canvas text never falls back mid-animation. */
export async function loadSceneFonts(): Promise<void> {
  const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
  if (!fonts) return;
  await Promise.all(['16px "Inter"', '16px "Inter_600SemiBold"', '16px "Inter_700Bold"', '16px "Inter_500Medium"', '16px "Fraunces"']
    .map((f) => fonts.load(f).catch(() => undefined)));
}

interface Painter { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; w: number; h: number }

function painter(w: number, h: number): Painter {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * SCALE);
  canvas.height = Math.round(h * SCALE);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  ctx.scale(SCALE, SCALE);
  return { canvas, ctx, w, h };
}

function texture(p: Painter): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(p.canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Card with a soft drop shadow; returns the inner rect. `pad` leaves room for the shadow. */
function card(p: Painter, pad: number, r: number, fill: string, shadow: string) {
  const { ctx } = p;
  const x = pad, y = pad, w = p.w - pad * 2, h = p.h - pad * 2;
  ctx.save();
  ctx.shadowColor = shadow;
  ctx.shadowBlur = pad * 0.9;
  ctx.shadowOffsetY = pad * 0.35;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.restore();
  return { x, y, w, h };
}

function ruled(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, gap: number, rule: string, margin?: { x: number; color: string }) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.strokeStyle = rule;
  ctx.lineWidth = 1.2;
  for (let ly = y + gap * 1.4; ly < y + h - 4; ly += gap) {
    ctx.beginPath(); ctx.moveTo(x, ly); ctx.lineTo(x + w, ly); ctx.stroke();
  }
  if (margin) {
    ctx.strokeStyle = margin.color;
    ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(margin.x, y); ctx.lineTo(margin.x, y + h); ctx.stroke();
  }
  ctx.restore();
}

/** Seeded wobble so "hand-drawn" lines are identical every run. */
function rng(seed: number) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function handLine(ctx: CanvasRenderingContext2D, pts: Array<[number, number]>, rnd: () => number, jitter = 1.2) {
  ctx.beginPath();
  pts.forEach(([x, y], i) => {
    const jx = (rnd() - 0.5) * jitter, jy = (rnd() - 0.5) * jitter;
    if (i === 0) ctx.moveTo(x + jx, y + jy); else ctx.lineTo(x + jx, y + jy);
  });
  ctx.stroke();
}

function handRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, rnd: () => number) {
  handLine(ctx, [[x, y], [x + w * 0.5, y + 0.6], [x + w, y], [x + w + 0.5, y + h * 0.5], [x + w, y + h], [x + w * 0.5, y + h - 0.5], [x, y + h], [x - 0.4, y + h * 0.5], [x + 1, y - 0.8]], rnd);
}

function scribbleWord(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, rnd: () => number) {
  ctx.beginPath();
  const loops = Math.max(2, Math.round(w / (h * 0.75)));
  const T = loops * Math.PI * 2;
  for (let t = 0; t <= T; t += 0.4) {
    const px = x + (w * t) / T - h * 0.18 * Math.sin(t);
    const py = y - h * (0.5 - 0.5 * Math.cos(t)) * (0.85 + 0.25 * rnd());
    if (t === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.stroke();
}

interface Part { mesh: THREE.Mesh; sync(): boolean; dispose(): void }

/** A plane showing `tex`, sized from the painter in world units, faded by `opacity`. */
function plane(p: Painter, tex: THREE.Texture, opacity: { value: number }, width = p.w / PX): Part {
  const geo = new THREE.PlaneGeometry(width, p.h / PX);
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false });
  return {
    mesh: new THREE.Mesh(geo, mat),
    sync: () => { if (mat.opacity === opacity.value) return false; mat.opacity = opacity.value; return true; },
    dispose: () => { geo.dispose(); mat.dispose(); tex.dispose(); },
  };
}

/** Builds a fragment; `build` receives the shared opacity object every part fades with. */
function fragment(kind: FragmentKind, build: (opacity: { value: number }) => { parts: Part[]; tick?: (t: number) => boolean }): Fragment {
  const opacity = { value: 1 };
  const { parts, tick } = build(opacity);
  const group = new THREE.Group();
  parts.forEach((p, i) => { p.mesh.renderOrder = 10 + i; group.add(p.mesh); });
  let lastT = Number.NaN;
  return {
    kind, group, opacity,
    update: (t) => {
      let changed = false;
      for (const p of parts) changed = p.sync() || changed;
      // Animated content only redraws when time actually moved (a frozen clock stops rendering).
      if (tick && opacity.value > 0.001 && t !== lastT) { lastT = t; changed = tick(t) || changed; }
      return changed;
    },
    dispose: () => parts.forEach((p) => p.dispose()),
  };
}

// ─── Typed note ──────────────────────────────────────────────────────────────

const NOTE_LINES = ['Track what I spend', 'each day, in rupees.'];

export function textNote(pal: ScenePalette, lines: string[] = NOTE_LINES): Fragment & { setTyped(chars: number): void; repaint(): void } {
  const p = painter(520, 250);
  const tex = texture(p);
  const total = lines.join('').length;
  let typed = -1;
  const paint = (chars: number) => {
    const { ctx } = p;
    ctx.clearRect(0, 0, p.w, p.h);
    const r = card(p, 22, 18, pal.paper, pal.shadow);
    ruled(ctx, r.x, r.y, r.w, r.h, 40, pal.rule, { x: r.x + 44, color: pal.margin });
    ctx.fillStyle = pal.ink;
    ctx.font = `30px ${FONT.ui}`;
    let left = chars;
    let caret: [number, number] | null = null;
    lines.forEach((line, i) => {
      const shown = line.slice(0, Math.max(0, left));
      left -= line.length;
      const y = r.y + 47 + 40 * i;
      ctx.fillText(shown, r.x + 62, y);
      if (!caret && (left < 0 || i === lines.length - 1)) caret = [r.x + 62 + ctx.measureText(shown).width + 3, y];
    });
    if (caret) {
      ctx.fillStyle = pal.marigold;
      ctx.fillRect(caret[0], caret[1] - 27, 3.5, 33);
    }
    tex.needsUpdate = true;
  };
  paint(total);
  const frag = fragment('text', (opacity) => ({ parts: [plane(p, tex, opacity)] }));
  return Object.assign(frag, {
    setTyped(chars: number) {
      const c = Math.max(0, Math.min(total, Math.round(chars)));
      if (c !== typed) { typed = c; paint(c); }
    },
    repaint() { paint(typed < 0 ? total : typed); },
  });
}

// ─── Voice note (live waveform shader) ───────────────────────────────────────

const VOICE_FRAG = /* glsl */ `
uniform sampler2D uMap;
uniform float uTime;
uniform float uAmp;
uniform float uOpacity;
uniform vec3 uBar;
uniform vec4 uBox;
varying vec2 vUv;
void main() {
  vec4 base = texture2D(uMap, vUv);
  float fx = (vUv.x - uBox.x) / (uBox.z - uBox.x);
  float n = 22.0;
  float i = floor(fx * n);
  float local = fract(fx * n);
  float inX = step(0.0, fx) * step(fx, 0.999);
  float env = 0.35 + 0.65 * sin(3.14159 * (i + 0.5) / n);
  float wave = abs(0.62 * sin(uTime * 2.7 + i * 1.37) + 0.38 * sin(uTime * 4.3 + i * 0.61));
  float h = (0.08 + 0.92 * env * wave * uAmp) * (uBox.w - uBox.y);
  float cy = 0.5 * (uBox.y + uBox.w);
  float bar = inX * step(0.22, local) * step(local, 0.78) * step(abs(vUv.y - cy), 0.5 * h + 0.012);
  vec3 col = mix(base.rgb, uBar, bar);
  gl_FragColor = vec4(col, max(base.a, bar) * uOpacity);
  #include <colorspace_fragment>
}`;
const BASIC_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

export function voiceNote(pal: ScenePalette): Fragment & { amp: { value: number } } {
  const p = painter(500, 190);
  const { ctx } = p;
  const r = card(p, 22, 26, pal.brand, pal.shadow);
  // Mic badge.
  const cx = r.x + 62, cy = r.y + r.h / 2;
  ctx.fillStyle = pal.marigold;
  ctx.beginPath(); ctx.arc(cx, cy, 38, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = pal.ink;
  ctx.beginPath(); ctx.roundRect(cx - 9, cy - 22, 18, 30, 9); ctx.fill();
  ctx.strokeStyle = pal.ink; ctx.lineWidth = 4; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.arc(cx, cy - 2, 16, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx, cy + 14); ctx.lineTo(cx, cy + 22); ctx.stroke();
  // Duration.
  ctx.fillStyle = 'rgba(255,255,255,0.72)';
  ctx.font = `20px ${FONT.semibold}`;
  ctx.textAlign = 'right';
  ctx.fillText('0:12', r.x + r.w - 22, r.y + r.h - 16);
  const tex = texture(p);
  const geo = new THREE.PlaneGeometry(p.w / PX, p.h / PX);
  const amp = { value: 1 };
  const box = new THREE.Vector4((r.x + 120) / p.w, 1 - (r.y + r.h - 34) / p.h, (r.x + r.w - 24) / p.w, 1 - (r.y + 28) / p.h);
  const mat = new THREE.ShaderMaterial({
    vertexShader: BASIC_VERT, fragmentShader: VOICE_FRAG, transparent: true, depthWrite: false,
    uniforms: { uMap: { value: tex }, uTime: { value: 0 }, uAmp: { value: 1 }, uOpacity: { value: 1 }, uBar: { value: new THREE.Color(pal.marigold) }, uBox: { value: box } },
  });
  const frag = fragment('voice', (opacity) => ({
    parts: [{
      mesh: new THREE.Mesh(geo, mat),
      sync: () => { if (mat.uniforms.uOpacity.value === opacity.value) return false; mat.uniforms.uOpacity.value = opacity.value; return true; },
      dispose: () => { geo.dispose(); mat.dispose(); tex.dispose(); },
    }],
    tick: (t) => {
      mat.uniforms.uAmp.value = amp.value;
      if (amp.value <= 0.001) return false;
      mat.uniforms.uTime.value = t;
      return true;
    },
  }));
  return Object.assign(frag, { amp });
}

// ─── Video frames (scrolling film strip) ─────────────────────────────────────

function paintFrame(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, kind: number) {
  const sky = ['#F5E9D6', '#E7EEF6', '#EEF3E8', '#F6E6E3'][kind];
  ctx.fillStyle = sky;
  ctx.fillRect(x, y, w, h);
  ctx.save();
  ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  if (kind === 0) {
    // Shop shelves with jars.
    ctx.fillStyle = '#B98A5A';
    for (let s = 0; s < 3; s++) ctx.fillRect(x, y + h * (0.3 + s * 0.3), w, 4);
    const jar = ['#0B6B57', '#FF8C69', '#F2AE1C', '#283080'];
    for (let s = 0; s < 3; s++) for (let j = 0; j < 4; j++) {
      ctx.fillStyle = jar[(s + j) % 4];
      ctx.beginPath(); ctx.roundRect(x + 10 + j * (w - 16) / 4, y + h * (0.3 + s * 0.3) - 22, (w - 40) / 4, 22, 4); ctx.fill();
    }
  } else if (kind === 1) {
    // Open ledger with a pen.
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(x + 12, y + 16, w / 2 - 14, h - 32); ctx.fillRect(x + w / 2 + 2, y + 16, w / 2 - 14, h - 32);
    ctx.strokeStyle = 'rgba(40,48,128,0.35)'; ctx.lineWidth = 2;
    for (let l = 0; l < 5; l++) {
      ctx.beginPath(); ctx.moveTo(x + 18, y + 30 + l * 14); ctx.lineTo(x + w / 2 - 8, y + 30 + l * 14); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x + w / 2 + 8, y + 30 + l * 14); ctx.lineTo(x + w - 18, y + 30 + l * 14); ctx.stroke();
    }
    ctx.strokeStyle = '#1E2563'; ctx.lineWidth = 6; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x + w * 0.62, y + h * 0.78); ctx.lineTo(x + w * 0.9, y + h * 0.3); ctx.stroke();
  } else if (kind === 2) {
    // Counter with a calculator.
    ctx.fillStyle = '#C9B79C'; ctx.fillRect(x, y + h * 0.62, w, h * 0.38);
    ctx.fillStyle = '#2E3248'; ctx.beginPath(); ctx.roundRect(x + w * 0.3, y + h * 0.16, w * 0.4, h * 0.6, 6); ctx.fill();
    ctx.fillStyle = '#9FD8C4'; ctx.fillRect(x + w * 0.34, y + h * 0.22, w * 0.32, h * 0.12);
    ctx.fillStyle = '#DDE0EE';
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) ctx.fillRect(x + w * 0.35 + c * w * 0.105, y + h * 0.4 + r * h * 0.11, w * 0.07, h * 0.07);
  } else {
    // Parcel being packed.
    ctx.fillStyle = '#D9A86C'; ctx.beginPath(); ctx.roundRect(x + w * 0.22, y + h * 0.3, w * 0.56, h * 0.5, 4); ctx.fill();
    ctx.fillStyle = '#F2D29B'; ctx.fillRect(x + w * 0.46, y + h * 0.3, w * 0.08, h * 0.5);
    ctx.fillStyle = '#FFFFFF'; ctx.fillRect(x + w * 0.28, y + h * 0.4, w * 0.14, h * 0.1);
  }
  ctx.restore();
}

export function filmStrip(pal: ScenePalette): Fragment {
  const frameW = 170, w = frameW * 4, h = 170;
  const p = painter(w, h);
  const { ctx } = p;
  ctx.fillStyle = pal.device;
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 4; i++) paintFrame(ctx, i * frameW + 10, 30, frameW - 20, h - 60, i);
  ctx.fillStyle = 'rgba(255,255,255,0.78)';
  for (let x = 6; x < w; x += 28) { ctx.beginPath(); ctx.roundRect(x, 9, 14, 11, 3); ctx.fill(); ctx.beginPath(); ctx.roundRect(x, h - 20, 14, 11, 3); ctx.fill(); }
  const tex = texture(p);
  tex.wrapS = THREE.RepeatWrapping;
  // Show 2.6 frames at a time; the strip scrolls like footage being scrubbed.
  tex.repeat.set(0.65, 1);
  return fragment('video', (opacity) => ({
    parts: [plane(p, tex, opacity, (w * 0.65) / PX)],
    tick: (t) => { tex.offset.x = (t * 0.06) % 1; return true; },
  }));
}

// ─── Photo of a paper sketch (polaroid) ──────────────────────────────────────

export function sketchPhoto(pal: ScenePalette): Fragment {
  const p = painter(330, 390);
  const { ctx } = p;
  const r = card(p, 24, 6, pal.dark ? '#E9EAF2' : '#FFFFFF', pal.shadow);
  const ix = r.x + 16, iy = r.y + 16, iw = r.w - 32, ih = r.w - 32;
  // The photographed sheet: warm paper under a desk lamp.
  const g = ctx.createRadialGradient(ix + iw * 0.45, iy + ih * 0.4, 10, ix + iw / 2, iy + ih / 2, iw * 0.8);
  g.addColorStop(0, '#F4F0E6'); g.addColorStop(1, '#C9C3B4');
  ctx.fillStyle = g; ctx.fillRect(ix, iy, iw, ih);
  ctx.save();
  ctx.translate(ix + iw / 2, iy + ih / 2); ctx.rotate(-0.05); ctx.translate(-(ix + iw / 2), -(iy + ih / 2));
  ctx.fillStyle = '#FBF9F3';
  ctx.fillRect(ix + 22, iy + 14, iw - 44, ih - 22);
  const rnd = rng(7);
  ctx.strokeStyle = '#2A2F5E'; ctx.lineWidth = 2.6; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  scribbleWord(ctx, ix + 40, iy + 50, 110, 16, rnd);
  for (let row = 0; row < 4; row++) {
    const y = iy + 78 + row * 38;
    handRect(ctx, ix + 40, y, 18, 18, rnd);
    if (row < 2) handLine(ctx, [[ix + 43, y + 9], [ix + 48, y + 15], [ix + 57, y + 2]], rnd, 0.6);
    scribbleWord(ctx, ix + 70, y + 15, 70 + rnd() * 50, 10, rnd);
  }
  handRect(ctx, ix + 40, iy + ih - 50, iw - 80, 28, rnd);
  ctx.restore();
  // Caption strip of the polaroid stays blank on purpose: no labels on objects.
  const tex = texture(p);
  return fragment('photo', (opacity) => ({ parts: [plane(p, tex, opacity)] }));
}

// ─── Drawing Studio page (used by the progress stage) ────────────────────────

export function drawingPage(pal: ScenePalette): Fragment {
  const p = painter(300, 380);
  const { ctx } = p;
  const r = card(p, 22, 16, pal.paper, pal.shadow);
  ruled(ctx, r.x, r.y, r.w, r.h, 30, pal.rule, { x: r.x + 30, color: pal.margin });
  const rnd = rng(11);
  ctx.strokeStyle = pal.ink; ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const fx = r.x + 62, fy = r.y + 24, fw = r.w - 100, fh = r.h - 48;
  handRect(ctx, fx, fy, fw, fh, rnd);
  handLine(ctx, [[fx, fy + 44], [fx + fw, fy + 42]], rnd);
  scribbleWord(ctx, fx + 14, fy + 32, 80, 12, rnd);
  handRect(ctx, fx + 14, fy + 64, fw - 28, 40, rnd);
  handRect(ctx, fx + 14, fy + 116, fw - 28, 30, rnd);
  ctx.strokeStyle = pal.marigold; ctx.lineWidth = 7; ctx.globalAlpha = 0.9;
  handRect(ctx, fx + 14, fy + fh - 54, fw - 28, 34, rnd);
  ctx.globalAlpha = 1;
  const tex = texture(p);
  return fragment('drawing', (opacity) => ({ parts: [plane(p, tex, opacity)] }));
}

// ─── Ruled paper sheet under the hero sketch ─────────────────────────────────

/** A sheet of ruled notebook paper `w × h` world units with a soft shadow. */
export function paperSheet(pal: ScenePalette, w: number, h: number, marginFromLeft: number): { mesh: THREE.Mesh; dispose(): void } {
  const pad = 40;
  const p = painter(w * PX * 0.5 + pad * 2, h * PX * 0.5 + pad * 2);
  const r = card(p, pad, 10, pal.paper, pal.shadow);
  ruled(p.ctx, r.x, r.y, r.w, r.h, 26, pal.rule, { x: r.x + marginFromLeft * PX * 0.5, color: pal.margin });
  const tex = texture(p);
  const geo = new THREE.PlaneGeometry(w + (pad * 4) / PX, h + (pad * 4) / PX);
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false });
  const mesh = new THREE.Mesh(geo, mat);
  return { mesh, dispose: () => { geo.dispose(); mat.dispose(); tex.dispose(); } };
}

/** Ease helpers for per-frame maths outside GSAP. */
export const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
