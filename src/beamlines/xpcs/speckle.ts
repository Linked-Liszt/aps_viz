import * as THREE from 'three';
import { reducedMotion } from './kit';

/**
 * Live small-angle speckle on the 8-ID-I detector (simulated, for the exhibit).
 *
 * Physics sketch: for Brownian particles the scattered field at wavevector q decorrelates at rate Γ = D q², so the
 * intensity autocorrelation is g2(q, τ) = 1 + β exp(−2 D q² τ). We model the far-field amplitude on each pixel as a complex
 * Ornstein–Uhlenbeck process with that q-dependent rate, convolve it with a Gaussian (the speckle grain, set by
 * λ·distance / beam size), square it, and multiply by the form factor of uniform spheres (rings with a first minimum near
 * the edge). Result: grainy speckle whose outer grains twinkle faster than the inner ones — the essence of SA-XPCS.
 * The 2 × 4 module gaps of an EIGER2 X 4M and the shadow of the in-vacuum beam stop on its rod are overlaid. The rod comes
 * from the outboard side, as in the 3D model; the face texture's +u axis is local +Z (outboard), so the shadow runs to +i.
 */
const N = 128;
const C = N / 2;
const BLUR_SIGMA = 1.5; // px: speckle grain ≈ 4 px
const R_MIN = 27; // px: first form-factor minimum (x = 4.493), so two rings fit on the detector
const GAMMA0 = 1.6; // 1/s at r = 40 px

export interface SpeckleSim {
  /** detector-face texture (pixelated, NearestFilter) */
  texture: THREE.CanvasTexture;
  /** canvas holding the latest frame (for the museum display) */
  canvas: HTMLCanvasElement;
  /** advance the simulation (throttled to 15 Hz); call from the beamline's per-frame hook */
  tick: () => void;
  /** redraw a dependent canvas after each simulation step while `host` is attached to a scene */
  listen: (host: THREE.Object3D, onStep: () => void) => void;
}

let shared: SpeckleSim | null = null;

export function speckleSim(): SpeckleSim {
  if (shared) return shared;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = N;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(N, N);
  const re = new Float32Array(N * N);
  const im = new Float32Array(N * N);
  const tr = new Float32Array(N * N);
  const ti = new Float32Array(N * N);
  const rate = new Float32Array(N * N);
  const env = new Float32Array(N * N);
  const mask = new Uint8Array(N * N);
  let seed = 12345;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const gauss = () => {
    const u = Math.max(1e-9, rnd());
    const v = rnd();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++) {
      const k = j * N + i;
      const r = Math.hypot(i + 0.5 - C, j + 0.5 - C);
      re[k] = gauss() * Math.SQRT1_2;
      im[k] = gauss() * Math.SQRT1_2;
      rate[k] = Math.min(14, Math.max(0.05, GAMMA0 * (r / 40) ** 2));
      const x = Math.max(1e-3, (4.493 * r) / R_MIN);
      const ff = (3 * (Math.sin(x) - x * Math.cos(x))) / x ** 3;
      env[k] = ff * ff + 2e-4;
      // beam-stop disk + its rod (from the top), module gaps (2 × 4 modules)
      const stop = r < 5 || (Math.abs(j + 0.5 - C) < 1.2 && i > C);
      const gap = i === C - 1 || i === C || j === 31 || j === 63 || j === 64 || j === 95;
      mask[k] = stop ? 1 : gap ? 2 : 0;
    }
  // separable Gaussian kernel
  const RAD = 4;
  const ker: number[] = [];
  let ks = 0;
  for (let d = -RAD; d <= RAD; d++) {
    const w = Math.exp(-(d * d) / (2 * BLUR_SIGMA * BLUR_SIGMA));
    ker.push(w);
    ks += w;
  }
  for (let d = 0; d < ker.length; d++) ker[d] /= ks;
  const lut = new Uint8ClampedArray(256 * 3);
  const stops: [number, number, number, number][] = [
    [0, 4, 8, 16],
    [0.3, 10, 45, 95],
    [0.62, 56, 189, 248],
    [0.85, 186, 236, 255],
    [1, 255, 255, 255],
  ];
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    let s = 0;
    while (s < stops.length - 2 && t > stops[s + 1][0]) s++;
    const [t0, r0, g0, b0] = stops[s];
    const [t1, r1, g1, b1] = stops[s + 1];
    const f = (t - t0) / (t1 - t0);
    lut[i * 3] = r0 + (r1 - r0) * f;
    lut[i * 3 + 1] = g0 + (g1 - g0) * f;
    lut[i * 3 + 2] = b0 + (b1 - b0) * f;
  }

  const step = (dt: number) => {
    if (dt > 0) {
      for (let k = 0; k < N * N; k++) {
        const a = Math.exp(-rate[k] * dt);
        const b = Math.sqrt(1 - a * a) * Math.SQRT1_2;
        re[k] = a * re[k] + b * gauss();
        im[k] = a * im[k] + b * gauss();
      }
    }
    // blur rows then columns (clamped edges)
    for (let j = 0; j < N; j++)
      for (let i = 0; i < N; i++) {
        let sr = 0;
        let si = 0;
        for (let d = -RAD; d <= RAD; d++) {
          const ii = Math.min(N - 1, Math.max(0, i + d));
          const w = ker[d + RAD];
          sr += re[j * N + ii] * w;
          si += im[j * N + ii] * w;
        }
        tr[j * N + i] = sr;
        ti[j * N + i] = si;
      }
    const norm = 1 / ker.reduce((a, w) => a + w * w, 0);
    const data = img.data;
    for (let j = 0; j < N; j++)
      for (let i = 0; i < N; i++) {
        let sr = 0;
        let si = 0;
        for (let d = -RAD; d <= RAD; d++) {
          const jj = Math.min(N - 1, Math.max(0, j + d));
          const w = ker[d + RAD];
          sr += tr[jj * N + i] * w;
          si += ti[jj * N + i] * w;
        }
        const k = j * N + i;
        const inten = (sr * sr + si * si) * Math.sqrt(norm) * env[k];
        let v = mask[k] === 1 ? 0 : (Math.log10(inten + 1e-6) + 3.6) / 3.9;
        if (mask[k] === 2) v *= 0.15;
        const li = Math.max(0, Math.min(255, Math.round(v * 255)));
        const o = k * 4;
        data[o] = lut[li * 3];
        data[o + 1] = lut[li * 3 + 1];
        data[o + 2] = lut[li * 3 + 2];
        data[o + 3] = 255;
      }
    ctx.putImageData(img, 0, 0);
  };
  step(0);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;

  // The layout's onFrame hook advances the shared simulation (throttled to 15 Hz; frozen under reduced motion / ?test);
  // listeners redraw dependent canvases while their object is still attached to a scene.
  const listeners: { obj: THREE.Object3D; fn: () => void }[] = [];
  let last = -1;
  const attached = (o: THREE.Object3D) => {
    let p: THREE.Object3D | null = o;
    while (p.parent) p = p.parent;
    return (p as THREE.Scene).isScene === true;
  };
  const still = reducedMotion();
  const tick = () => {
    if (still) return;
    const t = performance.now() / 1000;
    if (last >= 0 && t - last < 1 / 15) return;
    const dt = last < 0 ? 0.05 : Math.min(0.2, t - last);
    last = t;
    step(dt);
    texture.needsUpdate = true;
    for (let i = listeners.length - 1; i >= 0; i--) {
      if (attached(listeners[i].obj)) listeners[i].fn();
      else listeners.splice(i, 1);
    }
  };
  shared = {
    texture,
    canvas,
    tick,
    listen: (host, onStep) => {
      listeners.push({ obj: host, fn: onStep });
    },
  };
  return shared;
}

/** Emissive material showing the live speckle (detector faces). */
export function speckleFaceMaterial(): THREE.MeshStandardMaterial {
  const { texture } = speckleSim();
  return new THREE.MeshStandardMaterial({ map: texture, emissive: 0xffffff, emissiveMap: texture, emissiveIntensity: 1.0, roughness: 0.6 });
}

/**
 * Museum "magnifier" for the 8-ID-I detector: a fixed-size HTML card (constant on screen at any zoom, unlike a sprite)
 * showing the live speckle at a readable size, drawn just above the label anchor with a short leader line down to it.
 * `host` is the element returned by ctx.addLabel (the engine positions and distance-hides it); `owner` is any object
 * in the beamline group, used to stop redrawing once the beamline is disposed.
 */
export function speckleCard(host: HTMLElement, owner: THREE.Object3D, title: string, caption: string): void {
  const sim = speckleSim();
  const GAP = 30; // px between the card and the anchor point
  Object.assign(host.style, { background: 'none', padding: '0', borderRadius: '0' });
  const card = document.createElement('div');
  Object.assign(card.style, {
    position: 'relative',
    transform: `translateY(calc(-50% - ${GAP}px))`,
    background: 'rgba(7, 11, 18, 0.9)',
    border: '1px solid rgba(56, 189, 248, 0.85)',
    borderRadius: '10px',
    padding: '7px 7px 6px',
    boxShadow: '0 4px 18px rgba(0, 0, 0, 0.45)',
    textAlign: 'center',
    fontFamily: 'var(--font)',
  });
  const c = document.createElement('canvas');
  c.width = c.height = sim.canvas.width;
  Object.assign(c.style, { display: 'block', width: '128px', height: '128px', imageRendering: 'pixelated', borderRadius: '4px' });
  const t = document.createElement('div');
  t.textContent = title;
  Object.assign(t.style, { marginTop: '5px', fontSize: '11.5px', fontWeight: '600', color: '#e6f6ff', letterSpacing: '0.01em' });
  const cap = document.createElement('div');
  cap.textContent = caption;
  Object.assign(cap.style, { fontSize: '10px', color: 'rgba(190, 220, 240, 0.85)' });
  const lead = document.createElement('div');
  Object.assign(lead.style, {
    position: 'absolute',
    left: '50%',
    bottom: `-${GAP}px`,
    width: '1.5px',
    height: `${GAP}px`,
    background: 'rgba(56, 189, 248, 0.85)',
  });
  card.append(c, t, cap, lead);
  host.append(card);
  const g = c.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  const draw = () => g.drawImage(sim.canvas, 0, 0);
  draw();
  sim.listen(owner, draw);
}
