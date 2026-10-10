import * as THREE from 'three';
import type { BuildCtx } from '../../scene/beamline/layout';
import { fatLine } from '../../scene/lines';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { mats } from '../../scene/palette';
import { D4_DET, E, ENVELOPE_2THETA, FLOOR, HALL_EXIT_X, MONO_OFFSET, RINGS_70KEV_DEG, SAMPLE_X, ST1, ST2, D3_DET, WN3_X, deg } from './geom';
import { M, boxSpan, pedestal, pipeX, shadowed } from './kit';

const AX = MONO_OFFSET;

// ------------------------------------------------------------------ long shielded transports (absolute frame)

/**
 * White-beam shielded transport: a square lead-lined box around the evacuated beam pipe, on stands (the poster renders it
 * as a box section on posts). Drawn museum-style: floor and outboard wall solid, roof and inboard wall as faint glass so the
 * beam inside stays visible from the default (inboard, above) viewpoints. Joint collars and stands every ~3 m (spacing
 * schematic); box section 0.3 m (as-built size not published). x0..x1 in metres from the source.
 */
export function shieldedTransport(x0: number, x1: number, opts: { half?: number; every?: number; z?: number } = {}): THREE.Group {
  const g = new THREE.Group();
  const a = opts.half ?? 0.15;
  const z = opts.z ?? AX;
  const t = 0.03;
  const len = x1 - x0;
  g.add(boxSpan(x0, x1, -a, -a + t, z - a, z + a, M.lead(), 0));
  g.add(boxSpan(x0, x1, -a + t, a, z + a - t, z + a, M.lead(), 0));
  const glass = new THREE.Group();
  glass.add(boxSpan(x0, x1, a - 0.006, a, z - a, z + a - t, M.vessel(), 0));
  glass.add(boxSpan(x0, x1, -a + t, a - 0.006, z - a, z - a + 0.006, M.vessel(), 0));
  glass.traverse((o) => ((o as THREE.Mesh).renderOrder = 3));
  g.add(glass);
  const edges: number[] = [];
  for (const [y, zz] of [[a, z - a], [a, z + a], [-a, z - a]] as const) edges.push(x0, y, zz, x1, y, zz);
  const eg = new THREE.BufferGeometry();
  eg.setAttribute('position', new THREE.Float32BufferAttribute(edges, 3));
  g.add(new THREE.LineSegments(eg, M.vesselEdge()));
  // evacuated pipe inside (translucent so the beam reads through it)
  const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, len, 20, 1, true), M.vessel());
  pipe.rotation.z = Math.PI / 2;
  pipe.position.set((x0 + x1) / 2, 0, z);
  pipe.renderOrder = 3;
  g.add(pipe);
  const every = opts.every ?? 3;
  const n = Math.max(1, Math.round(len / every));
  for (let i = 0; i <= n; i++) {
    const x = x0 + (i / n) * len;
    const c = 0.025;
    const k = a + 0.02;
    g.add(
      boxSpan(x - c, x + c, a, k, z - k, z + k, M.steel(), 0),
      boxSpan(x - c, x + c, -k, -a, z - k, z + k, M.steel(), 0),
      boxSpan(x - c, x + c, -a, a, z + a, z + k, M.steel(), 0),
      boxSpan(x - c, x + c, -a, a, z - k, z - a, M.steel(), 0),
    );
    g.add(boxSpan(x - 0.006, x + 0.006, -0.08, 0.08, z - 0.08, z + 0.08, M.steel(), 0)); // pipe flange
    if (i > 0 && i < n) {
      g.add(pedestal(x, z, FLOOR, -k, 0.08, 0.2, M.darkSteel()));
      g.add(boxSpan(x - 0.12, x + 0.12, FLOOR, FLOOR + 0.02, z - 0.16, z + 0.16, M.darkSteel(), 0));
    }
  }
  return shadowed(g);
}

/** Window in a short flanged spool where an evacuated section ends (WN-3 at 77.0 m inside 20-ID-D). */
export function windowSpool(x: number): THREE.Group {
  const g = new THREE.Group();
  g.add(pipeX(x - 0.2, x + 0.3, 0.035, M.steel(), 0, AX));
  for (const dx of [-0.012, 0.012]) g.add(boxSpan(x + dx - 0.008, x + dx + 0.008, -0.08, 0.08, AX - 0.08, AX + 0.08, M.steel(), 0.004));
  g.add(pedestal(x + 0.1, AX, FLOOR, -0.035, 0.1, 0.12, M.darkSteel()));
  return shadowed(g);
}

/** Concrete sleeve where the transport passes through the experiment-hall outer wall (~91 m, computed from site radii). */
export function wallSleeve(): THREE.Group {
  const g = new THREE.Group();
  g.add(boxSpan(HALL_EXIT_X - 0.45, HALL_EXIT_X + 0.45, -0.6, 0.6, AX - 0.6, AX - 0.25, mats.concrete(), 0.02));
  g.add(boxSpan(HALL_EXIT_X - 0.45, HALL_EXIT_X + 0.45, -0.6, 0.6, AX + 0.25, AX + 0.6, mats.concrete(), 0.02));
  g.add(boxSpan(HALL_EXIT_X - 0.45, HALL_EXIT_X + 0.45, 0.25, 0.6, AX - 0.25, AX + 0.25, mats.concrete(), 0.02));
  g.add(boxSpan(HALL_EXIT_X - 0.45, HALL_EXIT_X + 0.45, FLOOR, -0.25, AX - 0.6, AX + 0.6, mats.concrete(), 0.02));
  return shadowed(g);
}

// ------------------------------------------------------------------ X-ray paths in 20-ID-E

/** Hollow Debye–Scherrer cone from `apex` along +X with half-angle 2θ, fading toward its base (additive glow). */
export function debyeCone(apex: THREE.Vector3, twoTheta: number, len: number, color: THREE.ColorRepresentation, o: { near?: number; far?: number; thetaStart?: number; thetaLength?: number } = {}): THREE.Mesh {
  const r = Math.tan(twoTheta) * len;
  const geo = new THREE.ConeGeometry(r, len, 72, 8, true, o.thetaStart ?? 0, o.thetaLength ?? Math.PI * 2);
  geo.translate(0, -len / 2, 0);
  geo.rotateZ(Math.PI / 2); // apex at origin, opening toward +X
  const pos = geo.getAttribute('position');
  const cols = new Float32Array(pos.count * 3);
  const base = new THREE.Color(color);
  const near = o.near ?? 0.5;
  const far = o.far ?? 0.08;
  for (let i = 0; i < pos.count; i++) {
    const t = Math.max(0, Math.min(1, pos.getX(i) / len));
    const k = near + (far - near) * t;
    cols[i * 3] = base.r * k;
    cols[i * 3 + 1] = base.g * k;
    cols[i * 3 + 2] = base.b * k;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  const mat = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
    blending: THREE.AdditiveBlending,
  });
  const m = new THREE.Mesh(geo, mat);
  m.position.copy(apex);
  m.renderOrder = 4;
  return m;
}

/**
 * Snapshot of a far-field HEDM experiment at 70 keV (see geom.ts): the
 * 111/200/220/311 Debye cones of a Ni-base superalloy (the 220 cone intercepted by D3 at 6 m), one 220 Bragg spot sent
 * to D4 on the back wall, and the ESD design envelope (2θ = 17.8°, 1 Å at 40 keV) that sets the hutch's shape.
 */
export function endStationRays(ctx: BuildCtx, color: string): void {
  const g = ctx.group;
  const S = new THREE.Vector3(SAMPLE_X, 0, AX);
  // (the transmitted beam to the D6 beamstop is the engine beam: layout.beamEndM)
  // Debye cones
  const tint = new THREE.Color(color);
  const L3 = D3_DET.x - SAMPLE_X;
  for (const [hkl, tt] of Object.entries(RINGS_70KEV_DEG)) {
    const is220 = hkl === '220';
    g.add(debyeCone(S, deg(tt), is220 ? L3 : 2.6, tint, { near: is220 ? 0.16 : 0.1, far: is220 ? 0.05 : 0.0 }));
  }
  // ring trace where the 220 cone meets the D3 plane
  {
    const r = Math.tan(deg(RINGS_70KEV_DEG['220'])) * L3;
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 96; i++) {
      const a = (i / 96) * Math.PI * 2;
      pts.push(new THREE.Vector3(D3_DET.x, Math.sin(a) * r, AX + Math.cos(a) * r));
    }
    g.add(fatLine(pts, { color: tint, intensity: 1.6, width: 1.4, opacity: 0.55 }));
  }
  // single 220 Bragg spot from one grain → D4 on the back wall (vff-HEDM)
  const D4 = new THREE.Vector3(D4_DET.x, D4_DET.up, AX + D4_DET.side);
  g.add(fatLine([S, D4], { color: tint, intensity: 2.6, width: 2.2 }));
  // ESD design envelope: dashed generators and the ring where it meets the back wall, above the floor only
  const env = ENVELOPE_2THETA;
  const Lw = E.x1 - 0.05 - SAMPLE_X;
  const R = Math.tan(env) * Lw;
  const dash = { color: new THREE.Color(0xffd7a8), intensity: 0.9, width: 1.2, opacity: 0.6, dashed: true, dashSize: 0.35, gapSize: 0.25 };
  for (const azDeg of [0, 30, 60, 120, 150, 180]) {
    const a = deg(azDeg);
    g.add(fatLine([S, new THREE.Vector3(E.x1 - 0.05, Math.sin(a) * R, AX + Math.cos(a) * R)], dash));
  }
  const ring: THREE.Vector3[] = [];
  const aMin = -Math.asin(Math.min(1, (-FLOOR - 0.05) / R));
  for (let i = 0; i <= 90; i++) {
    const a = aMin + (i / 90) * (Math.PI - 2 * aMin);
    ring.push(new THREE.Vector3(E.x1 - 0.05, Math.sin(a) * R, AX + Math.cos(a) * R));
  }
  g.add(fatLine(ring, dash));
}

// ------------------------------------------------------------------ hall / building context

/** Hide engine-drawn enclosure groups (and their floating name labels) that this layout redraws itself. */
export function hideEngineEnclosures(ctx: BuildCtx, names: string[]): void {
  for (const name of names) {
    const grp = ctx.group.getObjectByName(`enclosure-${name}`);
    if (grp) grp.visible = false;
  }
  ctx.group.traverse((o) => {
    if (o instanceof CSS2DObject && names.includes(o.element.textContent ?? '')) o.visible = false;
  });
}

/** Shielded transports, hall-wall sleeve, corridor floor strip and context labels (engine-managed labels). */
export function transports(ctx: BuildCtx): void {
  const g = ctx.group;
  hideEngineEnclosures(ctx, ['Shielded transport ST-1', 'Shielded transport ST-2 and HEXM corridor']);
  g.add(shieldedTransport(ST1.x0, ST1.x1));
  // ST-2 starts after the WN-3 window spool inside 20-ID-D and ends at the 20-ID-E upstream wall (WN-4 is drawn inside)
  g.add(windowSpool(WN3_X));
  g.add(shieldedTransport(WN3_X + 0.3, ST2.x1));
  g.add(wallSleeve());
  // floor strip marking the transport corridor through LOM 436 and the new HEXM office corridor
  const strip = new THREE.Mesh(new THREE.PlaneGeometry(ST2.x1 - HALL_EXIT_X, 2.4), new THREE.MeshStandardMaterial({ color: 0x1b2433, roughness: 0.95 }));
  strip.rotation.x = -Math.PI / 2;
  strip.position.set((HALL_EXIT_X + ST2.x1) / 2, FLOOR + 0.02, AX);
  strip.receiveShadow = true;
  g.add(strip);
  ctx.addLabel('Shielded pipe ST-1 through unused 20-ID-B and -C', ctx.at(51.0, -1.4, 1.1), { maxDist: 45 });
  ctx.addLabel('Leaves the experiment hall (~91 m)', ctx.at(HALL_EXIT_X + 0.6, -0.8, 1.9), { maxDist: 70 });
  ctx.addLabel('HEXM corridor (new offices) · LOM 436', ctx.at(130, -1.2, 1.6), { maxDist: 70 });
  ctx.addLabel('Long Beamline Building (Bldg 444)', ctx.at(170.5, -3.0, 5.2), { maxDist: 110 });
}
