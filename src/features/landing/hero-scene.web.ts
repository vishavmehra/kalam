/**
 * WebGL hero (web only, dynamically imported). The story in one take:
 *   1. The five ways in arrive: a typed note, a live voice note, a strip of video frames and a
 *      photo of a paper sketch float onto the desk while a pen draws the app on ruled paper.
 *   2. Everything is pulled into one screen and the finished app prints over the sketch.
 *   3. The phone lifts off the page; the inputs settle beside it, smaller, as "built from".
 * Renders on demand, pauses offscreen and in hidden tabs, stops animating after a short idle,
 * caps DPR and disposes every GPU resource. Reduced motion never loads this file.
 */
import gsap from 'gsap';
import * as THREE from 'three';

import {
  filmStrip, fontsOrTimeout, type Fragment, paperSheet, scenePalette, sketchPhoto, textNote, voiceNote,
} from './scene/fragments.web';
import { APP_UI, buildSketch, DRAW_SECONDS, INK, ribbon, SCREEN, type UIPrim } from './sketch-data';

/** Elapsed seconds that can stop and restart (THREE.Clock is deprecated). */
function stopwatch() {
  let origin = performance.now();
  let stoppedAt: number | null = null;
  return {
    getElapsedTime: () => ((stoppedAt ?? performance.now()) - origin) / 1000,
    stop: () => { if (stoppedAt === null) stoppedAt = performance.now(); },
    start: () => { if (stoppedAt !== null) { origin += performance.now() - stoppedAt; stoppedAt = null; } },
  };
}

export interface HeroScene {
  replay(): void;
  dispose(): void;
}

const U = 100; // sketch units per world unit
const toX = (x: number) => (x - SCREEN.w / 2) / U;
const toY = (y: number) => (SCREEN.h / 2 - y) / U;

const STROKE_VERT = /* glsl */ `
attribute float aDraw;
attribute float aSide;
attribute vec3 aColor;
varying float vDraw;
varying float vSide;
varying vec3 vColor;
void main() {
  vDraw = aDraw; vSide = aSide; vColor = aColor;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const STROKE_FRAG = /* glsl */ `
uniform float uTime;
uniform float uOpacity;
varying float vDraw;
varying float vSide;
varying vec3 vColor;
void main() {
  if (vDraw > uTime) discard;
  float edge = 1.0 - smoothstep(0.82, 1.0, abs(vSide));
  gl_FragColor = vec4(vColor, uOpacity * edge);
  #include <colorspace_fragment>
}`;

const SCREEN_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const SCREEN_FRAG = /* glsl */ `
uniform sampler2D uMap;
uniform float uReveal;
uniform vec3 uGlow;
varying vec2 vUv;
void main() {
  float y = 1.0 - vUv.y;
  float shown = 1.0 - smoothstep(uReveal - 0.05, uReveal, y);
  float line = (1.0 - smoothstep(0.0, 0.01, abs(y - uReveal + 0.004))) * step(0.001, uReveal) * (1.0 - step(1.02, uReveal));
  vec4 c = texture2D(uMap, vUv);
  gl_FragColor = vec4(mix(c.rgb, uGlow, line), max(shown, line));
  #include <colorspace_fragment>
}`;

function roundedRectShape(w: number, h: number, r: number): THREE.Shape {
  const s = new THREE.Shape();
  const x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

/** Remaps ShapeGeometry UVs (raw positions) to 0..1 over the shape's bounds. */
function normalizeUv(geo: THREE.BufferGeometry, w: number, h: number) {
  const pos = geo.getAttribute('position');
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    uv[i * 2] = (pos.getX(i) + w / 2) / w;
    uv[i * 2 + 1] = (pos.getY(i) + h / 2) / h;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

function buildStrokeGeometry(): THREE.BufferGeometry {
  const strokes = buildSketch();
  // Ink is always ink: the sketch lives on a sheet of paper in both colour schemes.
  const ink = new THREE.Color(INK.ink);
  const accent = new THREE.Color(INK.accent);
  const pos: number[] = [], draw: number[] = [], side: number[] = [], col: number[] = [], idx: number[] = [];
  for (const s of strokes) {
    // Slightly bolder than the SVG: the WebGL stage renders the sheet larger and in perspective.
    const { left, right } = ribbon({ ...s, width: s.width * 1.35 });
    const color = s.color === 'accent' ? accent : ink;
    const base = pos.length / 3;
    let acc = 0;
    const lens = s.points.map((p, i) => (acc += i ? Math.hypot(p[0] - s.points[i - 1][0], p[1] - s.points[i - 1][1]) : 0));
    const total = acc || 1;
    // The highlighter sits under the ink, a hair above the paper.
    const z = s.color === 'accent' ? 0.001 : 0.002;
    s.points.forEach((_, i) => {
      const t = s.start + (s.duration * lens[i]) / total;
      pos.push(toX(left[i][0]), toY(left[i][1]), z, toX(right[i][0]), toY(right[i][1]), z);
      draw.push(t, t);
      side.push(-1, 1);
      col.push(color.r, color.g, color.b, color.r, color.g, color.b);
      if (i < s.points.length - 1) {
        const a = base + i * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    });
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('aDraw', new THREE.Float32BufferAttribute(draw, 1));
  geo.setAttribute('aSide', new THREE.Float32BufferAttribute(side, 1));
  geo.setAttribute('aColor', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  return geo;
}

const FAMILY: Record<number, string> = { 400: 'Inter', 500: 'Inter_500Medium', 600: 'Inter_600SemiBold', 700: 'Inter_700Bold' };

function paintApp(ctx: CanvasRenderingContext2D) {
  ctx.clearRect(0, 0, SCREEN.w, SCREEN.h);
  for (const p of APP_UI as UIPrim[]) {
    if (p.kind === 'rect') {
      ctx.beginPath();
      ctx.roundRect(p.x, p.y, p.w, p.h, p.r);
      if (p.fill) { ctx.fillStyle = p.fill; ctx.fill(); }
      if (p.stroke) { ctx.strokeStyle = p.stroke; ctx.lineWidth = 1.5; ctx.stroke(); }
    } else if (p.kind === 'circle') {
      ctx.beginPath(); ctx.arc(p.cx, p.cy, p.r, 0, Math.PI * 2); ctx.fillStyle = p.fill; ctx.fill();
    } else if (p.kind === 'line') {
      ctx.beginPath(); ctx.moveTo(p.x1, p.y1); ctx.lineTo(p.x2, p.y2); ctx.strokeStyle = p.stroke; ctx.lineWidth = 1; ctx.stroke();
    } else {
      ctx.font = `${p.size}px "${FAMILY[p.weight]}", system-ui, sans-serif`;
      ctx.fillStyle = p.fill;
      ctx.textAlign = p.anchor === 'middle' ? 'center' : p.anchor === 'end' ? 'right' : 'left';
      ctx.fillText(p.text, p.x, p.y);
    }
  }
}

/** The finished app as a texture, plus a repaint for when the real fonts arrive. */
function paintAppTexture(): { tex: THREE.CanvasTexture; repaint(): void } {
  const scale = 2;
  const canvas = document.createElement('canvas');
  canvas.width = SCREEN.w * scale;
  canvas.height = SCREEN.h * scale;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  ctx.scale(scale, scale);
  paintApp(ctx);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return { tex, repaint: () => { paintApp(ctx); tex.needsUpdate = true; } };
}

function shadowTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  if (ctx) {
    const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 64);
    g.addColorStop(0, 'rgba(16,19,43,0.5)');
    g.addColorStop(1, 'rgba(16,19,43,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
  }
  return new THREE.CanvasTexture(c);
}

interface Pose { x: number; y: number; z: number; rz: number; s: number }
type InputKey = 'text' | 'voice' | 'photo' | 'video';

/** Where each input floats while the sketch is drawn, and where it rests at the end. */
const COLLAGE: Record<InputKey, Pose> = {
  text: { x: -2.95, y: 2.6, z: 0.6, rz: 0.06, s: 1 },
  voice: { x: -3.05, y: -0.5, z: 0.9, rz: -0.05, s: 1 },
  photo: { x: 3.0, y: 1.95, z: 0.7, rz: -0.08, s: 1 },
  video: { x: 2.95, y: -1.95, z: 0.5, rz: 0.05, s: 1 },
};
const RESTING: Record<InputKey, Pose> = {
  text: { x: -3.15, y: 2.7, z: 1.3, rz: 0.05, s: 0.56 },
  voice: { x: -3.45, y: 1.2, z: 1.4, rz: -0.04, s: 0.56 },
  photo: { x: -3.3, y: -0.45, z: 1.3, rz: -0.07, s: 0.56 },
  video: { x: -3.0, y: -1.95, z: 1.2, rz: 0.04, s: 0.56 },
};
const ORDER: InputKey[] = ['text', 'voice', 'photo', 'video'];

/** Narrow stages (phones) pull the inputs in over the paper's edges so the sheet can be larger. */
function layoutFor(compact: boolean) {
  if (!compact) return { collage: COLLAGE, resting: RESTING, fitW: 10.2, fitH: 10.2 };
  const squeeze = (src: Record<InputKey, Pose>, kx: number, ks: number) =>
    Object.fromEntries(ORDER.map((k) => [k, { ...src[k], x: src[k].x * kx, s: src[k].s * ks }])) as Record<InputKey, Pose>;
  return { collage: squeeze(COLLAGE, 0.76, 0.86), resting: squeeze(RESTING, 0.84, 1.05), fitW: 8.1, fitH: 9.6 };
}

export async function createHeroScene({ container, dark }: { container: HTMLElement; dark: boolean }): Promise<HeroScene> {
  const fonts = await fontsOrTimeout();
  const pal = scenePalette(dark);
  const { collage, resting, fitW, fitH } = layoutFor(container.clientWidth < 560);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x000000, 0);
  const canvas = renderer.domElement;
  Object.assign(canvas.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', display: 'block' });
  canvas.setAttribute('aria-hidden', 'true');

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  const root = new THREE.Group();
  scene.add(root);
  const disposers: Array<() => void> = [];

  // Painter's order, no depth writes: paper, ink, shadow, phone body, screen, then the inputs.
  const sheet = paperSheet(pal, 4.7, 8.6, 0.22);
  sheet.mesh.position.set(0, 0.02, -0.02);
  sheet.mesh.renderOrder = -1;
  root.add(sheet.mesh);
  disposers.push(sheet.dispose);

  const strokeGeo = buildStrokeGeometry();
  const strokeMat = new THREE.ShaderMaterial({
    // DoubleSide: the y-flip from sketch to world space reverses ribbon winding.
    vertexShader: STROKE_VERT, fragmentShader: STROKE_FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    uniforms: { uTime: { value: 0 }, uOpacity: { value: 1 } },
  });
  const strokeMesh = new THREE.Mesh(strokeGeo, strokeMat);
  strokeMesh.renderOrder = 0;
  root.add(strokeMesh);
  disposers.push(() => { strokeGeo.dispose(); strokeMat.dispose(); });

  const shadowTex = shadowTexture();
  const shadowGeo = new THREE.PlaneGeometry(5.4, 9.4);
  const shadowMat = new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, opacity: 0, depthWrite: false });
  const shadow = new THREE.Mesh(shadowGeo, shadowMat);
  shadow.position.z = -0.001;
  shadow.renderOrder = 1;
  root.add(shadow);
  disposers.push(() => { shadowGeo.dispose(); shadowMat.dispose(); shadowTex.dispose(); });

  const phone = new THREE.Group();
  phone.position.z = 0.004;
  root.add(phone);
  const sw = SCREEN.w / U, sh = SCREEN.h / U;
  const bodyGeo = new THREE.ShapeGeometry(roundedRectShape(sw + 0.28, sh + 0.28, 0.54), 12);
  const bodyMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(pal.device), transparent: true, opacity: 0, depthWrite: false });
  const bodyMesh = new THREE.Mesh(bodyGeo, bodyMat);
  bodyMesh.renderOrder = 2;
  phone.add(bodyMesh);
  const screenGeo = new THREE.ShapeGeometry(roundedRectShape(sw, sh, SCREEN.r / U), 12);
  normalizeUv(screenGeo, sw, sh);
  const app = paintAppTexture();
  const appTex = app.tex;
  const screenMat = new THREE.ShaderMaterial({
    vertexShader: SCREEN_VERT, fragmentShader: SCREEN_FRAG, transparent: true, depthWrite: false,
    uniforms: { uMap: { value: appTex }, uReveal: { value: 0 }, uGlow: { value: new THREE.Color(INK.accent) } },
  });
  const screenMesh = new THREE.Mesh(screenGeo, screenMat);
  screenMesh.position.z = 0.003;
  screenMesh.renderOrder = 3;
  phone.add(screenMesh);
  disposers.push(() => { bodyGeo.dispose(); bodyMat.dispose(); screenGeo.dispose(); screenMat.dispose(); appTex.dispose(); });

  // ── The inputs ──
  const note = textNote(pal);
  const voice = voiceNote(pal);
  const frags: Record<InputKey, Fragment> = { text: note, voice, photo: sketchPhoto(pal), video: filmStrip(pal) };
  for (const k of ORDER) {
    scene.add(frags[k].group);
    disposers.push(frags[k].dispose);
  }

  container.appendChild(canvas);

  // ── Render on demand ──
  let needsRender = true;
  const invalidate = () => { needsRender = true; };
  let disposed = false;
  if (!fonts.ready) {
    void fonts.late.then(() => {
      if (disposed) return;
      app.repaint();
      note.repaint();
      invalidate();
    });
  }
  let live = true; // inputs animate (waveform, film) while the story and the short idle run
  const clock = stopwatch();
  let frozenAt = 0;
  const bob = { t: 0, amount: 0 };
  const pointer = { x: 0, y: 0 };
  const tick = () => {
    const t = live ? clock.getElapsedTime() : frozenAt;
    let dirty = needsRender;
    for (const k of ORDER) dirty = frags[k].update(t) || dirty;
    if (!dirty) return;
    needsRender = false;
    // Gentle float + depth parallax on the inputs, applied on top of their tweened pose.
    ORDER.forEach((k, i) => {
      const g = frags[k].group;
      const base = g.userData.pose as Pose | undefined;
      if (!base) return;
      const wob = Math.sin(t * 1.1 + i * 1.7) * 0.05 * bob.amount;
      g.position.set(base.x - pointer.x * 0.12 * base.z, base.y + wob - pointer.y * 0.08 * base.z, base.z);
      g.rotation.set(0, 0, base.rz);
      g.scale.setScalar(base.s);
    });
    renderer.render(scene, camera);
  };

  // ── Story state ──
  const lift = { root: 0, px: 0, py: 0, pz: 0.004, rx: 0, ry: 0, cam: 0, zoom: 0 };
  let baseDist = 20;
  const applyLift = () => {
    root.rotation.x = lift.root;
    phone.position.set(lift.px, lift.py, lift.pz);
    phone.rotation.set(lift.rx, lift.ry, 0);
    shadow.position.set(lift.px * 0.9 + 0.18, lift.py - 0.22, -0.001);
    camera.position.set(lift.cam, 0, baseDist * (1 + lift.zoom));
    camera.lookAt(lift.cam, 0, 0);
    invalidate();
  };

  const fit = () => {
    const w = Math.max(1, container.clientWidth), h = Math.max(1, container.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, w < 640 ? 1.5 : 2));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    const t = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    // Frame the sheet plus the inputs on either side.
    baseDist = Math.max(fitH / (2 * t), fitW / (2 * t * camera.aspect));
    camera.updateProjectionMatrix();
    applyLift();
  };
  fit();

  // Each input carries a mutable pose the tick reads; GSAP tweens the pose.
  const poses = Object.fromEntries(ORDER.map((k) => [k, { ...collage[k] }])) as Record<InputKey, Pose>;
  const resetInputs = () => {
    ORDER.forEach((k) => {
      const c = collage[k];
      Object.assign(poses[k], { x: c.x * 1.7, y: c.y * 1.3, z: -4, rz: c.rz * 4, s: c.s * 0.9 });
      frags[k].group.userData.pose = poses[k];
      frags[k].opacity.value = 0;
    });
    note.setTyped(0);
    voice.amp.value = 1;
    bob.amount = 0;
  };
  resetInputs();

  const D = DRAW_SECONDS;
  const A = 0.35 + D + 0.15; // the moment everything is pulled into the screen
  const tl = gsap.timeline({ onUpdate: invalidate, delay: 0.25, paused: true });
  ORDER.forEach((k, i) => {
    tl.to(poses[k], { ...collage[k], duration: 1.05, ease: 'power3.out' }, 0.1 + i * 0.14)
      .to(frags[k].opacity, { value: 1, duration: 0.5, ease: 'power1.out' }, 0.1 + i * 0.14);
  });
  const typing = { c: 0 };
  tl.to(typing, { c: 40, duration: 1.4, ease: 'none', onUpdate: () => note.setTyped(typing.c) }, 0.45)
    .to(bob, { amount: 1, duration: 0.8 }, 1.2)
    .to(strokeMat.uniforms.uTime, { value: D + 0.1, duration: D, ease: 'none' }, 0.35);
  ORDER.forEach((k, i) => {
    tl.to(poses[k], { x: 0, y: 0.4, z: 0.7, rz: 0, s: 0.14, duration: 0.6, ease: 'power2.in' }, A + i * 0.09)
      .to(frags[k].opacity, { value: 0, duration: 0.25, ease: 'power1.in' }, A + i * 0.09 + 0.38);
  });
  tl.to(bob, { amount: 0, duration: 0.3 }, A)
    .to(voice.amp, { value: 0.25, duration: 0.4 }, A)
    .to(screenMat.uniforms.uReveal, { value: 1.08, duration: 1.15, ease: 'power2.inOut' }, A + 0.45)
    .to(strokeMat.uniforms.uOpacity, { value: 0.45, duration: 0.8 }, A + 0.45)
    .to(bodyMat, { opacity: 1, duration: 0.35, ease: 'power1.out' }, A + 1.35)
    .to(lift, {
      root: -0.42, px: 1.5, py: -0.15, pz: 0.95, rx: 0.42, ry: -0.26, cam: 0.72, zoom: 0.16,
      duration: 1.5, ease: 'power3.inOut', onUpdate: applyLift,
    }, A + 1.55)
    .to(shadowMat, { opacity: 0.6, duration: 1.2, ease: 'power2.out' }, A + 1.75)
    .to(strokeMat.uniforms.uOpacity, { value: 0.85, duration: 1.0 }, A + 1.95);
  ORDER.forEach((k, i) => {
    const at = A + 2.6 + i * 0.1;
    tl.set(poses[k], { ...resting[k], x: resting[k].x - 0.6, s: resting[k].s * 0.75 }, at)
      .to(poses[k], { ...resting[k], duration: 0.8, ease: 'power3.out' }, at)
      .to(frags[k].opacity, { value: 1, duration: 0.5, ease: 'power1.out' }, at);
  });
  tl.to(voice.amp, { value: 0.7, duration: 0.5 }, A + 2.7)
    .to(bob, { amount: 0.6, duration: 0.8 }, A + 2.8)
    // A short idle, then everything comes to rest and rendering stops.
    .to(bob, { amount: 0, duration: 1.2, ease: 'power1.inOut' }, A + 11)
    .to(voice.amp, { value: 0.45, duration: 1.2 }, A + 11)
    .call(() => { frozenAt = clock.getElapsedTime(); live = false; invalidate(); }, undefined, A + 12.3);
  tl.play();

  // ── Pointer parallax after the story (fine pointers only) ──
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  const tiltX = gsap.quickTo(phone.rotation, 'x', { duration: 0.6, ease: 'power3', onUpdate: invalidate });
  const tiltY = gsap.quickTo(phone.rotation, 'y', { duration: 0.6, ease: 'power3', onUpdate: invalidate });
  const toPX = gsap.quickTo(pointer, 'x', { duration: 0.8, ease: 'power3', onUpdate: invalidate });
  const toPY = gsap.quickTo(pointer, 'y', { duration: 0.8, ease: 'power3', onUpdate: invalidate });
  const onMove = (e: PointerEvent) => {
    if (!finePointer) return;
    const r = container.getBoundingClientRect();
    const nx = (e.clientX - r.left) / r.width - 0.5, ny = (e.clientY - r.top) / r.height - 0.5;
    toPX(nx); toPY(-ny);
    if (tl.time() < A + 3.1) return;
    tiltY(-0.26 + nx * 0.3);
    tiltX(0.42 - ny * 0.18);
  };
  container.addEventListener('pointermove', onMove);

  // ── Pause when offscreen or hidden ──
  let onScreen = true;
  const sync = () => {
    const active = onScreen && document.visibilityState === 'visible';
    if (active) { if (tl.progress() < 1) tl.resume(); clock.start(); renderer.setAnimationLoop(tick); invalidate(); }
    else { tl.pause(); clock.stop(); renderer.setAnimationLoop(null); }
  };
  const io = new IntersectionObserver(([entry]) => { onScreen = entry.isIntersecting; sync(); }, { threshold: 0.05 });
  io.observe(container);
  document.addEventListener('visibilitychange', sync);
  const ro = new ResizeObserver(fit);
  ro.observe(container);
  renderer.setAnimationLoop(tick);

  return {
    replay() {
      gsap.killTweensOf(phone.rotation);
      lift.root = 0; lift.px = 0; lift.py = 0; lift.pz = 0.004; lift.rx = 0; lift.ry = 0; lift.cam = 0; lift.zoom = 0;
      typing.c = 0;
      resetInputs();
      live = true;
      clock.start();
      tl.restart(true);
      applyLift();
    },
    dispose() {
      disposed = true;
      tl.kill();
      gsap.killTweensOf([phone.rotation, pointer]);
      io.disconnect();
      ro.disconnect();
      document.removeEventListener('visibilitychange', sync);
      container.removeEventListener('pointermove', onMove);
      renderer.setAnimationLoop(null);
      disposers.forEach((d) => d());
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
    },
  };
}
