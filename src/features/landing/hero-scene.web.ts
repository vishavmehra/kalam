/**
 * WebGL hero (web only, dynamically imported; W4's three.js and GSAP stage, restyled for "Khata and Kalam").
 * The story in one take (timings in story.ts):
 *   1. The ways in arrive around a blank order-book page: a typed note, a live voice note, a photo of the page
 *      and a strip of video frames.
 *   2. A fountain pen writes the Hindi title and field labels on the paper, line by line.
 *   3. Kalam reads each field with a red pen. The inputs fly into the tilted phone and the order-book app
 *      appears in it; the name types in and the balance rolls to ₹350.
 *   4. The Checked stamp lands on the page, the route stamps show, the wifi drops and the app still saves.
 * While the pen writes, the inputs wait beside the page and never over the phone or the writing (owner override 2;
 * story.ts hoverSlots). Renders on demand, pauses offscreen and in hidden tabs, caps DPR and disposes every GPU
 * resource. Reduced motion (or `?still`) never loads this file: the still frame shows the end of the story.
 */
import gsap from 'gsap';
import * as THREE from 'three';

import { filmStrip, fontsOrTimeout, type Fragment, scenePalette, sketchPhoto, textNote, voiceNote } from './scene/fragments.web';
import type { PlayState, StoryStatus } from './HeroField';
import {
  APP_THEME, type AppState, BEZEL, CAMERA_FOV, FIELDS, FONT_FAMILY, type Hover, HOVER_Z, hoverMagnification, hoverSlots, orderAppUI,
  PAPER_TILT_RAD, PEN_RED, penAt, type Prim, READ_SCHEDULE, rolledBalance, SCREEN, STAMP_VIOLET, stageLayout, T, typedName,
  WAY_IN_TILT, wayInScale, wayInScreenSizes, WRITE_SCHEDULE,
} from './story';

export interface HeroSceneOptions {
  container: HTMLElement;
  dark: boolean;
  /** Image URLs: the written page, the same page blank, the stamp frame. */
  images: { sketch: string; blank: string; stamp: string };
  /** Words painted into the scene, in the UI language. */
  labels: { onThisPhone: string; checked: string; stampDate: string };
  onStatus(status: StoryStatus): void;
  onPlayState(state: PlayState): void;
}

export interface HeroScene {
  /** Pause, resume, or replay once the story has ended. */
  toggle(): void;
  replay(): void;
  dispose(): void;
}

/** Elapsed seconds that can stop and restart. */
function stopwatch() {
  let origin = performance.now();
  let stoppedAt: number | null = null;
  return {
    getElapsedTime: () => ((stoppedAt ?? performance.now()) - origin) / 1000,
    stop: () => { if (stoppedAt === null) stoppedAt = performance.now(); },
    start: () => { if (stoppedAt !== null) { origin += performance.now() - stoppedAt; stoppedAt = null; } },
  };
}

const PX = 100; // screen px per world unit at the z = 0 plane

const BASIC_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

/** The page: the blank paper where the pen has not written yet, the written page behind the pen. */
const PAGE_FRAG = /* glsl */ `
uniform sampler2D uBlank;
uniform sampler2D uInk;
uniform float uTime;
uniform vec4 uBox[9];
uniform vec2 uWin[9];
uniform vec4 uLine[8];
uniform vec2 uLineWin[8];
uniform vec3 uRed;
varying vec2 vUv;
void main() {
  vec2 p = vec2(vUv.x, 1.0 - vUv.y);
  vec3 blank = texture2D(uBlank, vUv).rgb;
  vec3 ink = texture2D(uInk, vUv).rgb;
  float hide = 1.0;
  float any = 0.0;
  for (int i = 0; i < 9; i++) {
    vec4 b = uBox[i];
    float inside = step(b.x - 0.025, p.x) * step(p.x, b.x + b.z + 0.025) * step(b.y - 0.016, p.y) * step(p.y, b.y + b.w + 0.008);
    float prog = clamp((uTime - uWin[i].x) / uWin[i].y, 0.0, 1.0);
    float front = (b.x - 0.025) + (b.z + 0.05) * prog;
    float hidden = prog >= 1.0 ? 0.0 : smoothstep(front - 0.006, front + 0.002, p.x);
    hide = min(hide, mix(1.0, hidden, inside));
    any = max(any, inside);
  }
  vec3 col = mix(ink, blank, any * hide);
  for (int i = 0; i < 8; i++) {
    vec4 l = uLine[i];
    float prog = clamp((uTime - uLineWin[i].x) / uLineWin[i].y, 0.0, 1.0);
    float x1 = l.x + l.z * prog;
    float y = l.y + 0.0016 * sin(p.x * 46.0 + float(i)) - 0.0022 * (p.x - l.x) / max(l.z, 0.01);
    float d = abs(p.y - y);
    float on = step(l.x, p.x) * step(p.x, x1) * (1.0 - smoothstep(l.w * 0.45, l.w, d));
    col = mix(col, uRed, on * 0.9);
  }
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

/** The lit, empty phone screen prints the app from the top as it appears; a haldi line marks the edge. */
const SCREEN_FRAG = /* glsl */ `
uniform sampler2D uMap;
uniform float uReveal;
uniform vec3 uGlow;
uniform vec3 uIdle;
varying vec2 vUv;
void main() {
  float y = 1.0 - vUv.y;
  float shown = 1.0 - smoothstep(uReveal - 0.04, uReveal, y);
  float line = (1.0 - smoothstep(0.0, 0.008, abs(y - uReveal + 0.004))) * step(0.001, uReveal) * (1.0 - step(1.02, uReveal));
  vec4 c = texture2D(uMap, vUv);
  gl_FragColor = vec4(mix(mix(uIdle, c.rgb, shown), uGlow, line), 1.0);
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

function normalizeUv(geo: THREE.BufferGeometry, w: number, h: number) {
  const pos = geo.getAttribute('position');
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    uv[i * 2] = (pos.getX(i) + w / 2) / w;
    uv[i * 2 + 1] = (pos.getY(i) + h / 2) / h;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

function canvas2d(w: number, h: number, scale = 2) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  ctx.scale(scale, scale);
  return { canvas, ctx };
}

function canvasTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

const FALLBACK: Record<string, string> = {
  AnekDevanagari_400Regular: 'AnekLatin_400Regular', AnekDevanagari_600SemiBold: 'AnekLatin_600SemiBold',
  AnekDevanagari_700Bold: 'AnekLatin_700Bold', AnekLatin_700Wide: 'AnekLatin_700Bold',
};

/** Paints the order-book app (story.ts primitives) into a 2D canvas. */
function paintApp(ctx: CanvasRenderingContext2D, prims: Prim[]) {
  ctx.clearRect(0, 0, SCREEN.w, SCREEN.h);
  for (const p of prims) {
    if (p.kind === 'rect') {
      ctx.beginPath();
      ctx.roundRect(p.x, p.y, p.w, p.h, p.r);
      if (p.fill) { ctx.fillStyle = p.fill; ctx.fill(); }
      if (p.stroke) { ctx.strokeStyle = p.stroke; ctx.lineWidth = p.lw ?? 1; ctx.stroke(); }
    } else if (p.kind === 'path') {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.scale(p.s, p.s);
      ctx.strokeStyle = p.stroke; ctx.lineWidth = p.lw; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.stroke(new Path2D(p.d));
      ctx.restore();
    } else {
      const family = FONT_FAMILY[p.font];
      ctx.font = `${p.size}px "${family}", "${FALLBACK[family] ?? 'AnekLatin_400Regular'}", system-ui, sans-serif`;
      ctx.fillStyle = p.fill;
      ctx.textAlign = p.anchor === 'middle' ? 'center' : p.anchor === 'end' ? 'right' : 'left';
      ctx.fillText(p.text, p.x, p.y);
    }
  }
}

/** A fountain pen, tip at the left edge: steel nib, charcoal grip, saffron barrel with a marigold band. */
function paintPen(): { canvas: HTMLCanvasElement; w: number; h: number } {
  const w = 320, h = 44;
  const { canvas, ctx } = canvas2d(w, h);
  const cy = h / 2;
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.beginPath(); ctx.roundRect(70, cy + 6, 236, 14, 7); ctx.fill();
  const steel = ctx.createLinearGradient(0, cy - 9, 0, cy + 9);
  steel.addColorStop(0, '#ECE8E2'); steel.addColorStop(0.5, '#B5AEA4'); steel.addColorStop(1, '#857E75');
  ctx.fillStyle = steel;
  ctx.beginPath(); ctx.moveTo(0, cy); ctx.quadraticCurveTo(26, cy - 10, 58, cy - 9); ctx.lineTo(58, cy + 9); ctx.quadraticCurveTo(26, cy + 10, 0, cy); ctx.fill();
  ctx.strokeStyle = '#57534E'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(4, cy); ctx.lineTo(40, cy); ctx.stroke();
  ctx.fillStyle = '#1C1917'; ctx.beginPath(); ctx.roundRect(56, cy - 11, 50, 22, 5); ctx.fill();
  const barrel = ctx.createLinearGradient(0, cy - 14, 0, cy + 14);
  barrel.addColorStop(0, '#F27A60'); barrel.addColorStop(0.45, '#E2583E'); barrel.addColorStop(1, '#B8432C');
  ctx.fillStyle = barrel; ctx.beginPath(); ctx.roundRect(102, cy - 14, 214, 28, 13); ctx.fill();
  ctx.fillStyle = '#F2A541'; ctx.fillRect(214, cy - 14, 9, 28);
  ctx.fillStyle = 'rgba(255,255,255,0.28)'; ctx.beginPath(); ctx.roundRect(110, cy - 10, 196, 4, 2); ctx.fill();
  return { canvas, w, h };
}

/** The Checked impression: the generated stamp frame tinted violet, a tick, the word and the date. */
function paintStamp(frame: HTMLImageElement | null, label: string, date: string) {
  const w = 400, h = Math.round(400 * (573 / 900));
  const { canvas, ctx } = canvas2d(w, h);
  if (frame) {
    ctx.drawImage(frame, 0, 0, w, h);
    ctx.globalCompositeOperation = 'source-in';
    ctx.fillStyle = STAMP_VIOLET;
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'source-over';
  } else {
    ctx.strokeStyle = STAMP_VIOLET; ctx.lineWidth = 9;
    ctx.beginPath(); ctx.roundRect(8, 8, w - 16, h - 16, 18); ctx.stroke();
  }
  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.rotate((-4 * Math.PI) / 180);
  ctx.globalAlpha = 0.88;
  ctx.strokeStyle = STAMP_VIOLET; ctx.fillStyle = STAMP_VIOLET; ctx.lineWidth = 11; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath(); ctx.moveTo(-150, 4); ctx.lineTo(-126, 28); ctx.lineTo(-88, -22); ctx.stroke();
  const size = label.length > 9 ? 40 : 54;
  ctx.font = `${size}px "AnekLatin_700Bold", "AnekDevanagari_700Bold", system-ui, sans-serif`;
  ctx.textAlign = 'left';
  ctx.fillText(label, -70, 10, 230);
  ctx.font = '24px "CourierPrime_700Bold", "Courier New", monospace';
  ctx.fillText(date, -64, 52, 220);
  ctx.restore();
  return { canvas, w, h };
}

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

function shadowTexture(): THREE.CanvasTexture {
  const { canvas, ctx } = canvas2d(128, 128, 1);
  const g = ctx.createRadialGradient(64, 64, 6, 64, 64, 64);
  g.addColorStop(0, 'rgba(0,0,0,0.55)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(canvas);
}

type InputKey = 'text' | 'voice' | 'photo' | 'video';
const ORDER_KEYS: InputKey[] = ['text', 'voice', 'photo', 'video'];
interface Pose { x: number; y: number; z: number; rz: number; s: number }

export async function createHeroScene(opts: HeroSceneOptions): Promise<HeroScene> {
  const { container, labels } = opts;
  const [fonts, blankImg, sketchImg, stampImg] = await Promise.all([
    fontsOrTimeout(),
    loadImage(opts.images.blank),
    loadImage(opts.images.sketch),
    loadImage(opts.images.stamp),
  ]);
  if (!blankImg || !sketchImg) throw new Error('hero images unavailable');
  const pal = scenePalette(opts.dark);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x000000, 0);
  const canvas = renderer.domElement;
  Object.assign(canvas.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', display: 'block' });
  canvas.setAttribute('aria-hidden', 'true');

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(CAMERA_FOV, 1, 0.1, 200);
  const disposers: Array<() => void> = [];
  const tex = (img: HTMLImageElement) => {
    const t = new THREE.Texture(img);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    t.needsUpdate = true;
    disposers.push(() => t.dispose());
    return t;
  };

  // ── The page, with its pen and stamp as children (they move with it) ──
  const page = new THREE.Group();
  scene.add(page);
  const shadowTex = shadowTexture();
  disposers.push(() => shadowTex.dispose());
  const pageShadowMat = new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, opacity: 0.8, depthWrite: false });
  const pageShadow = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 1.24), pageShadowMat);
  pageShadow.position.set(0.03, -0.06, -0.01);
  pageShadow.renderOrder = -2;
  page.add(pageShadow);
  const pageMat = new THREE.ShaderMaterial({
    vertexShader: BASIC_VERT, fragmentShader: PAGE_FRAG, depthWrite: false, transparent: true,
    uniforms: {
      uBlank: { value: tex(blankImg) },
      uInk: { value: tex(sketchImg) },
      uTime: { value: 0 },
      uBox: { value: WRITE_SCHEDULE.map((s) => { const b = FIELDS[s.key]; return new THREE.Vector4(b.x, b.y, b.w, b.h); }) },
      uWin: { value: WRITE_SCHEDULE.map((s) => new THREE.Vector2(s.start, s.duration)) },
      uLine: { value: READ_SCHEDULE.map((r) => { const b = FIELDS[r.key]; return new THREE.Vector4(b.x, b.y + b.h + 0.006, b.w, 0.0042); }) },
      uLineWin: { value: READ_SCHEDULE.map((r) => new THREE.Vector2(r.start, r.duration)) },
      uRed: { value: new THREE.Color(PEN_RED) },
    },
  });
  const pageMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), pageMat);
  pageMesh.renderOrder = -1;
  page.add(pageMesh);
  disposers.push(() => { pageMesh.geometry.dispose(); pageMat.dispose(); pageShadow.geometry.dispose(); pageShadowMat.dispose(); });

  const penPaint = paintPen();
  const penTex = canvasTexture(penPaint.canvas);
  const penMat = new THREE.MeshBasicMaterial({ map: penTex, transparent: true, depthWrite: false, opacity: 0 });
  const penGeo = new THREE.PlaneGeometry(1, penPaint.h / penPaint.w);
  penGeo.translate(0.5, 0, 0); // tip at the origin
  const pen = new THREE.Mesh(penGeo, penMat);
  pen.rotation.z = 0.62;
  pen.renderOrder = 5;
  page.add(pen);
  disposers.push(() => { penGeo.dispose(); penMat.dispose(); penTex.dispose(); });

  const stampPaint = paintStamp(stampImg, labels.checked, labels.stampDate);
  const stampTex = canvasTexture(stampPaint.canvas);
  const stampMat = new THREE.MeshBasicMaterial({ map: stampTex, transparent: true, depthWrite: false, opacity: 0 });
  const stampGeo = new THREE.PlaneGeometry(1, stampPaint.h / stampPaint.w);
  const stamp = new THREE.Mesh(stampGeo, stampMat);
  stamp.renderOrder = 4;
  page.add(stamp);
  disposers.push(() => { stampGeo.dispose(); stampMat.dispose(); stampTex.dispose(); });

  // ── The phone ──
  const phone = new THREE.Group();
  scene.add(phone);
  const sw = SCREEN.w / PX, sh = SCREEN.h / PX, bz = BEZEL / PX;
  const phoneShadowMat = new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, opacity: 0.75, depthWrite: false });
  const phoneShadow = new THREE.Mesh(new THREE.PlaneGeometry(sw * 1.5, sh * 1.25), phoneShadowMat);
  phoneShadow.renderOrder = 0;
  scene.add(phoneShadow);
  const bodyGeo = new THREE.ShapeGeometry(roundedRectShape(sw + bz * 2, sh + bz * 2, (SCREEN.r + BEZEL) / PX), 12);
  const bodyMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(pal.device), transparent: true, depthWrite: false });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.renderOrder = 1;
  phone.add(body);
  const screenGeo = new THREE.ShapeGeometry(roundedRectShape(sw, sh, SCREEN.r / PX), 12);
  normalizeUv(screenGeo, sw, sh);
  const app = canvas2d(SCREEN.w, SCREEN.h);
  const appTex = canvasTexture(app.canvas);
  const appState: AppState = { name: '', balance: 0, offline: false, saved: false, onThisPhone: labels.onThisPhone };
  let painted = '';
  const repaint = () => {
    const key = `${appState.name}|${appState.balance}|${appState.offline}|${appState.saved}`;
    if (key === painted) return;
    painted = key;
    paintApp(app.ctx, orderAppUI(appState));
    appTex.needsUpdate = true;
  };
  repaint();
  const screenMat = new THREE.ShaderMaterial({
    vertexShader: BASIC_VERT, fragmentShader: SCREEN_FRAG, transparent: true, depthWrite: false,
    uniforms: { uMap: { value: appTex }, uReveal: { value: 0 }, uGlow: { value: new THREE.Color(pal.haldi) }, uIdle: { value: new THREE.Color(APP_THEME.bg) } },
  });
  const screenMesh = new THREE.Mesh(screenGeo, screenMat);
  screenMesh.position.z = 0.002;
  screenMesh.renderOrder = 2;
  phone.add(screenMesh);
  disposers.push(() => {
    bodyGeo.dispose(); bodyMat.dispose(); screenGeo.dispose(); screenMat.dispose(); appTex.dispose();
    phoneShadow.geometry.dispose(); phoneShadowMat.dispose();
  });

  // ── The ways in ──
  const note = textNote(pal, ['मेरी सिलाई की दुकान के लिए', 'ऑर्डर बुक, नाप और बाकी']);
  const voice = voiceNote(pal);
  const frags: Record<InputKey, Fragment> = { text: note, voice, photo: sketchPhoto(pal, sketchImg), video: filmStrip(pal) };
  for (const k of ORDER_KEYS) {
    scene.add(frags[k].group);
    disposers.push(frags[k].dispose);
  }

  container.appendChild(canvas);

  // ── Layout: world units are stage px / 100 at z = 0, so the 3D frame lines up with the still frame ──
  const L = { w: 1, h: 1, chip: 0.5, phoneX: 0, phoneY: 0, hover: null as Record<InputKey, Hover> | null };
  const toWorld = (x: number, y: number) => ({ x: (x - L.w / 2) / PX, y: (L.h / 2 - y) / PX });
  const pointer = { x: 0, y: 0 };
  const tilt = { rx: 0.07, ry: -0.2 };
  const placePhone = () => {
    phone.position.set(L.phoneX - pointer.x * 0.06, L.phoneY + pointer.y * 0.04, 0.1);
    phone.rotation.set(tilt.rx, tilt.ry, -0.015);
    phoneShadow.position.set(L.phoneX + 0.35, L.phoneY - 0.3, -0.02);
  };
  const fit = () => {
    const w = Math.max(1, container.clientWidth), h = Math.max(1, container.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, w < 640 ? 1.5 : 2));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.position.set(0, 0, h / PX / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))));
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    L.w = w; L.h = h;
    const { paper, phone: ph, stamp: sp } = stageLayout(w, h);
    const pc = toWorld(paper.x + paper.w / 2, paper.y + paper.h / 2);
    page.position.set(pc.x, pc.y, 0);
    page.rotation.z = PAPER_TILT_RAD;
    page.scale.set(paper.w / PX, paper.h / PX, 1);
    // The pen and stamp are children of a non-uniformly scaled page; undo the squash for them.
    pen.scale.set(0.42, (0.42 * paper.w) / paper.h, 1);
    stamp.scale.set(sp.w, (sp.w * paper.w) / paper.h, 1);
    stamp.position.set(sp.cx - 0.5, 0.5 - sp.cy, 0.01);
    stamp.rotation.z = (-sp.rotate * Math.PI) / 180;
    const phc = toWorld(ph.x + ph.w / 2, ph.y + ph.h / 2);
    L.phoneX = phc.x; L.phoneY = phc.y;
    phone.scale.setScalar(ph.w / (SCREEN.w + BEZEL * 2));
    phoneShadow.scale.setScalar(ph.w / (SCREEN.w + BEZEL * 2));
    L.chip = wayInScale(w);
    L.hover = hoverSlots(w, h, wayInScreenSizes(w, h));
    placePhone();
    invalidate();
  };

  // ── Render on demand ──
  let needsRender = true;
  const invalidate = () => { needsRender = true; };
  let disposed = false;
  if (!fonts.ready) {
    void fonts.late.then(() => {
      if (disposed) return;
      painted = '';
      repaint();
      note.repaint();
      invalidate();
    });
  }
  const story = { t: 0 };
  const clock = stopwatch();
  let live = true; // the voice waveform and film strip move while they are on screen
  const tick = () => {
    const t = live ? clock.getElapsedTime() : 0;
    let dirty = needsRender;
    for (const k of ORDER_KEYS) dirty = frags[k].update(t) || dirty;
    if (!dirty) return;
    needsRender = false;
    ORDER_KEYS.forEach((k, i) => {
      const g = frags[k].group;
      const base = g.userData.pose as Pose | undefined;
      if (!base) return;
      const bob = Math.sin(t * 1.2 + i * 1.7) * 0.04;
      g.position.set(base.x - pointer.x * 0.1 * base.z, base.y + bob - pointer.y * 0.07 * base.z, base.z);
      g.rotation.set(0, 0, base.rz);
      g.scale.setScalar(base.s);
    });
    renderer.render(scene, camera);
  };

  // ── Story state, driven by one GSAP timeline over `story.t` ──
  const poses = Object.fromEntries(ORDER_KEYS.map((k) => [k, { x: 0, y: 0, z: 0, rz: 0, s: 0 }])) as Record<InputKey, Pose>;
  // Each input waits in its slot beside the page, clear of the phone and the writing (story.ts hoverSlots).
  // Things at the hover depth look bigger, so the slot's screen position is divided back to world units.
  const hoverPose = (k: InputKey): Pose => {
    const slot = L.hover![k];
    const p = toWorld(slot.cx, slot.cy);
    const m = hoverMagnification(L.h);
    return { x: p.x / m, y: p.y / m, z: HOVER_Z, rz: WAY_IN_TILT[k], s: L.chip * slot.k };
  };
  const apply = () => {
    const t = story.t;
    pageMat.uniforms.uTime.value = t;
    const pose = penAt(t);
    pen.position.set(pose.x - 0.5, 0.5 - pose.y, pose.down ? 0.02 : 0.05);
    penMat.opacity = pose.shown;
    screenMat.uniforms.uReveal.value = 1.08 * Math.min(1, Math.max(0, (t - T.reveal) / 1.0));
    appState.name = typedName((t - T.typeName) / 0.7);
    appState.balance = rolledBalance((t - T.roll) / 0.7);
    appState.offline = t >= T.offline;
    appState.saved = t >= T.offline + 0.25;
    repaint();
    invalidate();
  };
  let status: StoryStatus | null = null;
  const report = (next: StoryStatus) => {
    if (status && next.step === status.step && next.route === status.route && next.offline === status.offline) return;
    status = next;
    opts.onStatus(next);
  };
  const reset = () => {
    story.t = 0;
    ORDER_KEYS.forEach((k) => {
      const h = hoverPose(k);
      Object.assign(poses[k], { x: h.x * 1.6, y: h.y * 1.4, z: -3, rz: h.rz * 4, s: L.chip * 0.8 });
      frags[k].group.userData.pose = poses[k];
      frags[k].opacity.value = 0;
    });
    note.setTyped(0);
    voice.amp.value = 1;
    stampMat.opacity = 0;
    live = true;
    report({ step: 0, route: false, offline: false });
    apply();
  };

  fit();
  reset();

  const tl = gsap.timeline({ paused: true, onUpdate: invalidate });
  tl.to(story, { t: T.end, duration: T.end, ease: 'none', onUpdate: apply }, 0);
  ORDER_KEYS.forEach((k, i) => {
    const at = T.inputsIn + i * 0.14;
    tl.to(poses[k], { x: () => hoverPose(k).x, y: () => hoverPose(k).y, z: HOVER_Z, rz: WAY_IN_TILT[k], s: () => hoverPose(k).s, duration: 1.0, ease: 'power3.out' }, at)
      .to(frags[k].opacity, { value: 1, duration: 0.45, ease: 'power1.out' }, at);
  });
  const typing = { c: 0 };
  tl.to(typing, { c: 48, duration: 1.6, ease: 'none', onUpdate: () => note.setTyped(typing.c) }, 0.5);
  ORDER_KEYS.forEach((k, i) => {
    const at = T.pull + i * 0.1;
    tl.to(poses[k], {
      x: () => L.phoneX, y: () => L.phoneY + 0.4, z: 0.6, rz: 0, s: () => L.chip * 0.12, duration: 0.6, ease: 'power2.in',
    }, at).to(frags[k].opacity, { value: 0, duration: 0.22, ease: 'power1.in' }, at + 0.4);
  });
  tl.to(voice.amp, { value: 0.2, duration: 0.4 }, T.pull)
    .call(() => report({ step: 1, route: false, offline: false }), undefined, T.pull)
    .call(() => { live = false; }, undefined, T.pull + 1.0)
    // The stamp is the one ease-in: it drops (power3.in, 260 ms), then settles (80 ms).
    .fromTo(stamp.position, { z: 0.6 }, { z: 0.01, duration: 0.26, ease: 'power3.in' }, T.stamp)
    .fromTo(stampMat, { opacity: 0 }, { opacity: 0.92, duration: 0.2, ease: 'power1.in' }, T.stamp)
    .to(stamp.rotation, { z: stamp.rotation.z - 0.02, duration: 0.08, ease: 'power1.out' }, T.stamp + 0.26)
    .call(() => report({ step: 2, route: false, offline: false }), undefined, T.stamp)
    .call(() => report({ step: 3, route: true, offline: false }), undefined, T.route)
    .call(() => report({ step: 3, route: true, offline: true }), undefined, T.offline);

  let userPaused = false;
  let ended = false;
  tl.eventCallback('onComplete', () => { ended = true; opts.onPlayState('done'); });

  // ── Pointer parallax (fine pointers only); the phone follows the pointer gently ──
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  const toPX = gsap.quickTo(pointer, 'x', { duration: 0.8, ease: 'power3', onUpdate: () => { placePhone(); invalidate(); } });
  const toPY = gsap.quickTo(pointer, 'y', { duration: 0.8, ease: 'power3', onUpdate: () => { placePhone(); invalidate(); } });
  const onMove = (e: PointerEvent) => {
    if (!finePointer) return;
    const r = container.getBoundingClientRect();
    toPX((e.clientX - r.left) / r.width - 0.5);
    toPY(-((e.clientY - r.top) / r.height - 0.5));
  };
  container.addEventListener('pointermove', onMove);

  // ── Pause when offscreen, hidden, or paused by the person ──
  let onScreen = true;
  const sync = () => {
    const active = onScreen && document.visibilityState === 'visible';
    if (active && !userPaused) {
      if (!ended) tl.resume();
      clock.start();
      renderer.setAnimationLoop(tick);
      invalidate();
    } else {
      tl.pause();
      clock.stop();
      // A paused story on screen keeps its (idle) loop, so a resize redraws the frozen frame.
      renderer.setAnimationLoop(active ? tick : null);
      if (active) invalidate();
    }
  };
  const io = new IntersectionObserver(([entry]) => { onScreen = !!entry?.isIntersecting; sync(); }, { threshold: 0.05 });
  io.observe(container);
  document.addEventListener('visibilitychange', sync);
  const ro = new ResizeObserver(() => { fit(); apply(); });
  ro.observe(container);
  renderer.setAnimationLoop(tick);
  tl.play();
  opts.onPlayState('playing');

  const replay = () => {
    ended = false;
    userPaused = false;
    reset();
    tl.invalidate().restart();
    clock.start();
    renderer.setAnimationLoop(tick);
    opts.onPlayState('playing');
  };

  return {
    toggle() {
      if (ended) { replay(); return; }
      userPaused = !userPaused;
      sync();
      opts.onPlayState(userPaused ? 'paused' : 'playing');
    },
    replay,
    dispose() {
      disposed = true;
      tl.kill();
      gsap.killTweensOf(pointer);
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

