import * as THREE from 'three';
import { glowMaterial, COLORS } from '../../scene/palette';
import { fatLine } from '../../scene/lines';
import { box, canvasCard, cm, roundRect, v3 } from './kit';

/**
 * Hero visuals for CSSI: detector faces with plausible patterns, the floating "magnifier" that shows the grazing
 * geometry, and its caption card.
 */

type FaceKind = 'eiger' | 'mmpad' | 'pilatus';

const faceCache = new Map<FaceKind, THREE.MeshStandardMaterial>();

/**
 * Detector-face textures (illustrative, not data):
 *  - eiger: off-specular speckle at larger exit angles (vertical sample → exit angle runs sideways); brightest on the
 *    edge nearest the specular spot, concentrated about the horizontal plane of incidence; 4 × 8 module gaps.
 *  - mmpad: the specular spot itself with a grainy speckle halo (no beam stop needed).
 *  - pilatus: GIWAXS arcs from a textured film lying flat (horizon at the bottom), 2 × 5 module gaps.
 */
export function faceMaterial(kind: FaceKind): THREE.MeshStandardMaterial {
  const hit = faceCache.get(kind);
  if (hit) return hit;
  const N = kind === 'mmpad' ? 48 : 96;
  const H = kind === 'eiger' ? Math.round(N * (328 / 311)) : N;
  const c = document.createElement('canvas');
  c.width = N;
  c.height = H;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(N, H);
  let seed = kind === 'eiger' ? 11 : kind === 'mmpad' ? 29 : 47;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  // speckle grain: exponential intensity statistics on a coarse grid, bilinear-free (pixelated)
  const grain = kind === 'pilatus' ? 1 : 2;
  const gw = Math.ceil(N / grain) + 1;
  const gh = Math.ceil(H / grain) + 1;
  const sp = new Float32Array(gw * gh).map(() => -Math.log(Math.max(1e-6, rnd())));
  const lut = (t: number): [number, number, number] => {
    const x = Math.max(0, Math.min(1, t));
    if (x < 0.35) return [6 + 30 * x, 12 + 110 * x, 30 + 200 * x];
    if (x < 0.75) return [16 + 120 * (x - 0.35), 50 + 400 * (x - 0.35), 100 + 360 * (x - 0.35)];
    return [64 + 760 * (x - 0.75), 210 + 180 * (x - 0.75), 244 + 40 * (x - 0.75)];
  };
  for (let j = 0; j < H; j++)
    for (let i = 0; i < N; i++) {
      const u = (i + 0.5) / N;
      const v = (j + 0.5) / H;
      const s = sp[Math.floor(j / grain) * gw + Math.floor(i / grain)];
      let I = 0;
      if (kind === 'eiger') {
        const band = Math.exp(-(((v - 0.5) / 0.2) ** 2));
        const decay = Math.exp(-u / 0.32);
        const yoneda = 0.6 * Math.exp(-(((u - 0.12) / 0.03) ** 2)) * Math.exp(-(((v - 0.5) / 0.35) ** 2));
        I = (0.85 * band * decay + yoneda + 0.04) * s;
      } else if (kind === 'mmpad') {
        const r = Math.hypot(u - 0.5, v - 0.5);
        I = Math.exp(-r / 0.035) * 6 + Math.exp(-r / 0.16) * 0.7 * s + 0.05 * s;
      } else {
        const r = Math.hypot(u - 0.5, v - 1.05);
        let rings = 0;
        for (const [r0, w, a] of [[0.32, 0.012, 1], [0.48, 0.015, 0.7], [0.66, 0.02, 0.45], [0.8, 0.02, 0.3]] as const) {
          const phi = Math.atan2(1.05 - v, u - 0.5); // 0 along the horizon
          const texture = 0.35 + 0.65 * Math.exp(-(((phi - Math.PI / 2) / 0.35) ** 2)); // out-of-plane (face-on) lobes
          rings += a * texture * Math.exp(-(((r - r0) / w) ** 2));
        }
        I = (rings + 0.05) * (0.7 + 0.3 * s);
      }
      const t = Math.log10(1 + 9 * Math.min(1.6, I)) / Math.log10(1 + 9 * 1.6);
      const [r, g, b] = lut(t);
      const k = (j * N + i) * 4;
      img.data[k] = r;
      img.data[k + 1] = g;
      img.data[k + 2] = b;
      img.data[k + 3] = 255;
    }
  ctx.putImageData(img, 0, 0);
  // module gaps
  ctx.fillStyle = '#0b0f15';
  const cols = kind === 'eiger' ? 4 : kind === 'pilatus' ? 2 : 1;
  const rows = kind === 'eiger' ? 8 : kind === 'pilatus' ? 5 : 1;
  for (let i = 1; i < cols; i++) ctx.fillRect(Math.round((i * N) / cols) - 0.5, 0, 1, H);
  for (let j = 1; j < rows; j++) ctx.fillRect(0, Math.round((j * H) / rows) - 0.5, N, 1);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.LinearFilter;
  const m = new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 1.0, roughness: 0.5 });
  faceCache.set(kind, m);
  return m;
}

/**
 * Floating magnifier above the CSSI chamber: the chip on edge, enlarged ×MAG, with the angles exaggerated ×EXAG so the
 * grazing geometry becomes visible — incoming beam, its long footprint on the surface, the specular reflection at 2α and
 * the faint speckle fan around it, all in the true (horizontal) scattering plane. Local origin = impact point.
 */
export const MAG = 8;
export const EXAG = 24;

export function magnifier(color: string, trueAlpha: number): THREE.Group {
  const g = new THREE.Group();
  const a = trueAlpha * EXAG;
  const accent = new THREE.Color(color);
  const Hd = 0.02 * MAG * 0.5 + 0.04; // disc sits below the chip (chip centred on the beam line of the diorama)
  // glass stage
  const R = 0.36;
  const disc = new THREE.Mesh(
    new THREE.CylinderGeometry(R, R, 0.012, 64),
    new THREE.MeshPhysicalMaterial({ color: 0xbfe9ff, roughness: 0.1, transparent: true, opacity: 0.16, depthWrite: false }),
  );
  disc.position.y = -Hd;
  disc.renderOrder = 5;
  const rim = new THREE.Mesh(new THREE.TorusGeometry(R, 0.006, 8, 96), glowMaterial(accent, 1.6, 0.85));
  rim.rotation.x = Math.PI / 2;
  rim.position.y = -Hd + 0.006;
  g.add(disc, rim);
  // the chip (30 × 20 mm → ×12), on edge; surface plane through the origin along t = (cos a, 0, sin a)
  const chipGroup = new THREE.Group();
  chipGroup.rotation.y = Math.PI + a; // faces inboard (−z), like the real-scale chip in the chamber
  const L = 0.03 * MAG;
  const Hc = 0.02 * MAG;
  const T = 0.0012 * MAG;
  const chip = box(L, Hc, T, cm.silicon(), 0.002);
  chip.position.set(0, 0, -T / 2);
  // lithographic pattern on the face and the stretched beam footprint (beam size / sin α)
  const pat = new THREE.Mesh(new THREE.PlaneGeometry(L * 0.4, Hc * 0.4), new THREE.MeshStandardMaterial({ color: 0xffd479, metalness: 0.9, roughness: 0.25 }));
  pat.position.set(0, 0, 0.0008);
  const foot = new THREE.Mesh(new THREE.PlaneGeometry(L * 0.62, 0.012), glowMaterial(COLORS.xray, 2.4, 0.9));
  foot.position.set(0, 0, 0.0016);
  const holder = box(L * 0.5, Hc * 0.6, 0.03, cm.steel(), 0.004);
  holder.position.set(0, 0, -T - 0.015);
  const post = box(0.03, Hd - 0.04, 0.03, cm.steel(), 0.003);
  post.position.set(0, -Hd + (Hd - 0.04) / 2, -T - 0.03);
  chipGroup.add(chip, pat, foot, holder, post);
  g.add(chipGroup);
  const lines: THREE.Object3D[] = [];
  const inc = [v3(-R * 0.95, 0, 0), v3(0, 0, 0)];
  lines.push(fatLine(inc, { color: COLORS.xray, intensity: 3, width: 3 }));
  const refl = v3(Math.cos(2 * a), 0, -Math.sin(2 * a)).multiplyScalar(R * 0.9);
  lines.push(fatLine([v3(0, 0, 0), refl], { color: COLORS.xray, intensity: 2.6, width: 2.6 }));
  // straight-through reference line (dashed)
  lines.push(fatLine([v3(0, 0, 0), v3(R * 0.9, 0, 0)], { color: new THREE.Color(0x9fb3c8), intensity: 1.0, width: 1.4, dashed: true, dashSize: 0.03, gapSize: 0.022 }));
  g.add(...lines);
  // angle arc between the straight-through line and the surface (α) and between surface and reflection (α)
  const arcPts = (from: number, to: number, r: number) => {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 16; i++) {
      const t = from + ((to - from) * i) / 16;
      pts.push(v3(Math.cos(t) * r, 0.001, -Math.sin(t) * r));
    }
    return pts;
  };
  g.add(fatLine(arcPts(0, a, 0.3), { color: accent, intensity: 1.8, width: 2 }));
  g.add(fatLine(arcPts(a, 2 * a, 0.36), { color: accent, intensity: 1.8, width: 2 }));
  // speckle fan around the reflection: out of the surface only (exit angles > 0), spread up/down in-plane
  const fanLen = R * 0.88;
  const fan = new THREE.Mesh(
    new THREE.ConeGeometry(Math.tan(0.11) * fanLen, fanLen, 40, 1, true),
    new THREE.MeshBasicMaterial({ color: accent.clone().multiplyScalar(1.5), transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, toneMapped: false }),
  );
  fan.geometry.translate(0, -fanLen / 2, 0);
  fan.geometry.rotateZ(Math.PI / 2); // apex at origin, opening toward +x
  fan.rotation.y = 2 * a;
  g.add(fan);
  // mini screen with speckle where the fan lands
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.12), faceMaterial('mmpad'));
  screen.position.copy(refl);
  screen.rotation.y = -Math.PI / 2 + 2 * a;
  g.add(screen);
  return g;
}

/** Caption card for the magnifier. */
export function magnifierCaption(color: string): THREE.Sprite {
  return canvasCard(
    360,
    132,
    (ctx, W, H) => {
      roundRect(ctx, 2, 2, W - 4, H - 4, 12);
      ctx.fillStyle = 'rgba(8,14,22,0.82)';
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.font = '600 13px Inter, system-ui, sans-serif';
      ctx.fillText('MAGNIFIED: THE CHIP STANDS ON EDGE', 16, 26);
      ctx.fillStyle = '#e6edf5';
      ctx.font = '13px Inter, system-ui, sans-serif';
      const lines = [
        'X-rays graze its surface at ~0.5°, bounce',
        'sideways and scatter a faint speckle fan.',
        `Drawn ×${MAG} larger, angles ×${EXAG} steeper (top view).`,
      ];
      lines.forEach((l, i) => ctx.fillText(l, 16, 52 + i * 22));
      void H;
    },
    0.4,
  );
}

/** Thin vertical leader line (plain mesh, never culled). */
export function leader(a: THREE.Vector3, b: THREE.Vector3, color: string): THREE.Mesh {
  const d = b.clone().sub(a);
  const m = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, d.length(), 6), glowMaterial(color, 1.2, 0.7));
  m.position.copy(a).addScaledVector(d, 0.5);
  m.quaternion.setFromUnitVectors(v3(0, 1, 0), d.normalize());
  return m;
}

/** Faint scattering cone from a point to a point (same look as the engine's scatter cones). */
export function cone(from: THREE.Vector3, to: THREE.Vector3, spread: number, color: string, opacity = 0.14): THREE.Mesh {
  const dir = to.clone().sub(from);
  const len = dir.length();
  const r = Math.max(0.01, Math.tan(spread) * len);
  const geo = new THREE.ConeGeometry(r, len, 32, 1, true);
  geo.translate(0, -len / 2, 0);
  geo.rotateX(Math.PI);
  const mat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(color).multiplyScalar(1.6),
    transparent: true,
    opacity,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
    blending: THREE.AdditiveBlending,
  });
  const m = new THREE.Mesh(geo, mat);
  m.position.copy(from);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  return m;
}
