/**
 * Creation progress stage (web only, dynamically imported): the inputs the user actually gave
 * circle a phone, and one at a time each is pulled into the screen, which prints a little more
 * of an app with every input. It echoes the landing hero, loops until unmounted, pauses
 * offscreen and in hidden tabs, caps DPR and disposes every GPU resource.
 */
import * as THREE from 'three';

import {
  drawingPage, filmStrip, fontsOrTimeout, type Fragment, type FragmentKind, scenePalette, sketchPhoto, textNote, voiceNote,
} from '@/features/landing/scene/fragments.web';

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

export interface ProgressScene { dispose(): void }

const SW = 2.3, SH = 4.6; // screen size in world units

const SCREEN_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const SCREEN_FRAG = /* glsl */ `
uniform sampler2D uMap;
uniform float uReveal;
uniform float uOpacity;
uniform vec3 uGlow;
varying vec2 vUv;
void main() {
  float y = 1.0 - vUv.y;
  float shown = 1.0 - smoothstep(uReveal - 0.04, uReveal, y);
  float line = (1.0 - smoothstep(0.0, 0.012, abs(y - uReveal + 0.004))) * step(0.001, uReveal) * (1.0 - step(1.0, uReveal));
  vec4 c = texture2D(uMap, vUv);
  gl_FragColor = vec4(mix(c.rgb, uGlow, line), max(shown, line) * uOpacity);
  #include <colorspace_fragment>
}`;

/** A neutral app skeleton: the shape of "an app", not a promise of the user's exact app. */
function skeletonTexture(dark: boolean): THREE.CanvasTexture {
  const w = 230, h = 460, s = 2;
  const c = document.createElement('canvas');
  c.width = w * s; c.height = h * s;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  ctx.scale(s, s);
  const bg = dark ? '#E9EAF3' : '#FFFFFF', soft = '#E6E8F5', mid = '#C9CDE6', ink = '#283080', mari = '#F2AE1C';
  ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = ink; ctx.fillRect(0, 0, w, 74);
  ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.beginPath(); ctx.roundRect(16, 40, 110, 14, 7); ctx.fill();
  ctx.fillStyle = soft; ctx.beginPath(); ctx.roundRect(14, 90, w - 28, 74, 12); ctx.fill();
  ctx.fillStyle = mid; ctx.beginPath(); ctx.roundRect(28, 106, 70, 10, 5); ctx.fill();
  ctx.fillStyle = ink; ctx.beginPath(); ctx.roundRect(28, 128, 112, 20, 6); ctx.fill();
  for (let i = 0; i < 2; i++) {
    ctx.strokeStyle = mid; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.roundRect(14, 180 + i * 46, w - 28, 36, 9); ctx.stroke();
    ctx.fillStyle = mid; ctx.beginPath(); ctx.roundRect(26, 194 + i * 46, 60, 8, 4); ctx.fill();
  }
  ctx.fillStyle = mari; ctx.beginPath(); ctx.roundRect(14, 276, w - 28, 38, 10); ctx.fill();
  ctx.fillStyle = 'rgba(22,26,61,0.75)'; ctx.beginPath(); ctx.roundRect(w / 2 - 34, 291, 68, 8, 4); ctx.fill();
  for (let i = 0; i < 3; i++) {
    const y = 336 + i * 40;
    ctx.fillStyle = soft; ctx.beginPath(); ctx.arc(30, y + 12, 11, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = mid; ctx.beginPath(); ctx.roundRect(50, y + 7, 90, 9, 4); ctx.fill();
    ctx.beginPath(); ctx.roundRect(w - 60, y + 7, 44, 9, 4); ctx.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function roundedRect(w: number, h: number, r: number): THREE.ShapeGeometry {
  const s = new THREE.Shape();
  const x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  const geo = new THREE.ShapeGeometry(s, 10);
  const pos = geo.getAttribute('position');
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) { uv[i * 2] = (pos.getX(i) + w / 2) / w; uv[i * 2 + 1] = (pos.getY(i) + h / 2) / h; }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
}

const smooth = (a: number, b: number, v: number) => { const t = Math.max(0, Math.min(1, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

export async function createProgressScene(
  { container, dark, kinds }: { container: HTMLElement; dark: boolean; kinds: FragmentKind[] },
): Promise<ProgressScene> {
  const fonts = await fontsOrTimeout();
  const pal = scenePalette(dark);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x000000, 0);
  const canvas = renderer.domElement;
  Object.assign(canvas.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', display: 'block' });
  canvas.setAttribute('aria-hidden', 'true');
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);

  const bodyGeo = roundedRect(SW + 0.2, SH + 0.2, 0.36);
  const bodyMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(pal.device), transparent: true, depthWrite: false });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.renderOrder = 5;
  const screenGeo = roundedRect(SW, SH, 0.28);
  const skel = skeletonTexture(dark);
  const screenMat = new THREE.ShaderMaterial({
    vertexShader: SCREEN_VERT, fragmentShader: SCREEN_FRAG, transparent: true, depthWrite: false,
    uniforms: { uMap: { value: skel }, uReveal: { value: 0 }, uOpacity: { value: 1 }, uGlow: { value: new THREE.Color(pal.marigold) } },
  });
  const screen = new THREE.Mesh(screenGeo, screenMat);
  screen.position.z = 0.01;
  screen.renderOrder = 6;
  const phone = new THREE.Group();
  phone.add(body, screen);
  phone.rotation.set(0.06, -0.22, 0);
  scene.add(phone);

  const make: Record<FragmentKind, () => Fragment> = {
    text: () => textNote(pal, ['A ledger for my', 'shop, in rupees.']),
    voice: () => voiceNote(pal),
    video: () => filmStrip(pal),
    photo: () => sketchPhoto(pal),
    drawing: () => drawingPage(pal),
  };
  const unique = Array.from(new Set(kinds.length ? kinds : (['text'] as FragmentKind[])));
  const frags = unique.map((k) => make[k]());
  frags.forEach((f) => scene.add(f.group));
  container.appendChild(canvas);
  let disposed = false;
  if (!fonts.ready) void fonts.late.then(() => { if (!disposed) frags.forEach((f) => f.repaint?.()); });

  const fit = () => {
    const w = Math.max(1, container.clientWidth), h = Math.max(1, container.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    const t = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const dist = Math.max(6.6 / (2 * t), 7.2 / (2 * t * camera.aspect));
    camera.position.set(0, 0.1, dist);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
  };
  fit();

  const n = frags.length;
  const CYCLE = 2.2;
  const clock = stopwatch();
  const tick = () => {
    const t = clock.getElapsedTime();
    const cycleIndex = Math.floor(t / CYCLE);
    const local = (t % CYCLE) / CYCLE;
    const step = cycleIndex % (n + 1); // n cycles of inputs going in, then one "done" beat
    // Screen: each absorbed input prints another band; the last beat holds, then wipes.
    if (step < n) {
      screenMat.uniforms.uReveal.value = (step + smooth(0.45, 0.95, local)) / n;
      screenMat.uniforms.uOpacity.value = step === 0 ? smooth(0, 0.15, local) : 1;
    } else {
      screenMat.uniforms.uReveal.value = 1.05;
      screenMat.uniforms.uOpacity.value = 1 - smooth(0.7, 1, local);
    }
    frags.forEach((f, i) => {
      const angle = (i / n) * Math.PI * 2 + t * 0.32;
      const ox = Math.cos(angle) * 2.55, oz = Math.sin(angle) * 1.4, oy = Math.sin(angle * 2 + i) * 0.55 + (i % 2 ? -0.6 : 0.6);
      let x = ox, y = oy, z = oz, s = 0.5, o = 1;
      if (step === i && step < n) {
        // This input dives into the screen, then reappears on its orbit.
        const dive = smooth(0.05, 0.55, local);
        x = ox * (1 - dive); y = oy * (1 - dive) + 0.6 * dive; z = oz * (1 - dive) + 0.6 * dive;
        s = 0.5 * (1 - dive * 0.8);
        o = local < 0.55 ? 1 - smooth(0.4, 0.55, local) : smooth(0.75, 0.95, local);
        if (local >= 0.55) { x = ox; y = oy; z = oz; s = 0.5; }
      }
      f.group.position.set(x, y, z);
      f.group.scale.setScalar(s);
      f.group.rotation.set(0, 0, Math.sin(angle) * 0.06);
      f.opacity.value = o;
      // Behind the phone when on the far side of the orbit.
      f.group.children.forEach((m) => { m.renderOrder = z < 0 ? 1 : 20; });
      f.update(t);
    });
    renderer.render(scene, camera);
  };

  let onScreen = true;
  const sync = () => {
    const active = onScreen && document.visibilityState === 'visible';
    if (active) { clock.start(); renderer.setAnimationLoop(tick); } else { clock.stop(); renderer.setAnimationLoop(null); }
  };
  const io = new IntersectionObserver(([e]) => { onScreen = e.isIntersecting; sync(); }, { threshold: 0.05 });
  io.observe(container);
  document.addEventListener('visibilitychange', sync);
  const ro = new ResizeObserver(fit);
  ro.observe(container);
  renderer.setAnimationLoop(tick);

  return {
    dispose() {
      disposed = true;
      io.disconnect();
      ro.disconnect();
      document.removeEventListener('visibilitychange', sync);
      renderer.setAnimationLoop(null);
      frags.forEach((f) => f.dispose());
      [bodyGeo, screenGeo].forEach((g) => g.dispose());
      [bodyMat, screenMat].forEach((m) => m.dispose());
      skel.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
    },
  };
}
