import * as THREE from 'three';
import type { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import type { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { fatLine } from '../../scene/lines';
import { COLORS } from '../../scene/palette';
import type { BuildCtx } from '../../scene/beamline/layout';
import { reducedMotion } from './kit';

/**
 * POLAR's signature, made visible: the X-ray electric field drawn as arrows along the beam.
 * Upstream of the first diamond plate the field oscillates side to side (linear-horizontal, as the planar undulators
 * make it); downstream it rotates as a corkscrew (circular), and the handedness flips periodically like the piezo-driven
 * helicity switching (really ~15 Hz; slowed here, and the wave is drawn 0.32 m long instead of ~1 Å).
 */
export interface WaveOpts {
  linear: [number, number];
  circular: [number, number];
  /** amplitude (m), wavelength (m) of the drawing */
  amp?: number;
  lambda?: number;
  /** seconds between helicity flips (visual) */
  flipEvery?: number;
  onFlip?: (helicity: 1 | -1, strength: number) => void;
}

interface Segment {
  x0: number;
  x1: number;
  kind: 'linear' | 'circular';
  spokes: THREE.InstancedMesh;
  n: number;
  line: ReturnType<typeof fatLine>;
  pts: number;
  spokeMat: THREE.MeshBasicMaterial;
}

export function polarizationWaves(ctx: BuildCtx, o: WaveOpts): THREE.Group {
  const g = new THREE.Group();
  g.name = 'polar-polarization-waves';
  const A = o.amp ?? 0.065;
  const lam = o.lambda ?? 0.32;
  const k = (2 * Math.PI) / lam;
  const omega = 2 * Math.PI * 1.1;
  const flipEvery = o.flipEvery ?? 2.6;
  const violet = new THREE.Color(ctx.color);
  const cyan = new THREE.Color(COLORS.xray);
  const spokeGeo = new THREE.CylinderGeometry(0.0022, 0.0022, 1, 6, 1);
  spokeGeo.translate(0, 0.5, 0);

  const mk = (x0: number, x1: number, kind: 'linear' | 'circular'): Segment => {
    const col = kind === 'linear' ? cyan : violet;
    const spokeMat = new THREE.MeshBasicMaterial({ color: col.clone().multiplyScalar(2.2), toneMapped: false, transparent: true, opacity: 0.75, depthWrite: false });
    const n = Math.max(4, Math.round((x1 - x0) / (lam / 10)));
    const spokes = new THREE.InstancedMesh(spokeGeo, spokeMat, n);
    spokes.frustumCulled = false;
    const pts = Math.max(16, Math.round((x1 - x0) / (lam / 28)));
    const init: THREE.Vector3[] = [];
    for (let i = 0; i < pts; i++) init.push(new THREE.Vector3(x0 + ((x1 - x0) * i) / (pts - 1), 0, 0));
    const line = fatLine(init, { color: col, intensity: 2.6, width: 2.2, opacity: 0.95 });
    g.add(spokes, line);
    return { x0, x1, kind, spokes, n, line, pts, spokeMat };
  };
  const segs = [mk(o.linear[0], o.linear[1], 'linear'), mk(o.circular[0], o.circular[1], 'circular')];

  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();
  let lastHel = 1;

  const update = (t: number) => {
    const cycle = t / flipEvery;
    const hel: 1 | -1 = Math.floor(cycle) % 2 === 0 ? 1 : -1;
    const ph = cycle - Math.floor(cycle);
    // brief fade through each flip so the reversal of the twist reads clearly
    const fade = Math.min(1, Math.min(ph, 1 - ph) / 0.06);
    if (hel !== lastHel) lastHel = hel;
    o.onFlip?.(hel, 1 - fade);
    for (const s of segs) {
      const tip = (x: number): [number, number] => {
        const phi = k * (x - s.x0) - omega * t;
        if (s.kind === 'linear') return [0, A * Math.sin(phi)];
        return [hel * A * Math.sin(phi), A * Math.cos(phi)];
      };
      for (let i = 0; i < s.n; i++) {
        const x = s.x0 + ((s.x1 - s.x0) * (i + 0.5)) / s.n;
        const [ty, tz] = tip(x);
        const len = Math.hypot(ty, tz);
        e.set(Math.atan2(tz, ty), 0, 0);
        q.setFromEuler(e);
        pos.set(x, 0, 0);
        scl.set(1, Math.max(1e-4, len), 1);
        m4.compose(pos, q, scl);
        s.spokes.setMatrixAt(i, m4);
      }
      s.spokes.instanceMatrix.needsUpdate = true;
      // rewrite the line's segment buffer in place (setPositions would allocate a new GPU buffer every frame)
      const attr = (s.line.geometry as LineGeometry).getAttribute('instanceStart') as THREE.InterleavedBufferAttribute;
      const a = attr.data.array as Float32Array;
      let px = s.x0;
      let [py, pz] = tip(px);
      for (let i = 1; i < s.pts; i++) {
        const x = s.x0 + ((s.x1 - s.x0) * i) / (s.pts - 1);
        const [ty, tz] = tip(x);
        const o6 = (i - 1) * 6;
        a[o6] = px;
        a[o6 + 1] = py;
        a[o6 + 2] = pz;
        a[o6 + 3] = x;
        a[o6 + 4] = ty;
        a[o6 + 5] = tz;
        px = x;
        py = ty;
        pz = tz;
      }
      attr.data.needsUpdate = true;
      if (s.kind === 'circular') {
        s.spokeMat.opacity = 0.75 * fade;
        (s.line.material as LineMaterial).opacity = 0.95 * fade;
        (s.line.material as LineMaterial).transparent = true;
      }
    }
  };
  update(0.55);
  if (!reducedMotion()) ctx.onFrame((_dt, t) => update(t + 0.55));
  ctx.group.add(g);
  return g;
}
