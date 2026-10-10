import * as THREE from 'three';
import { SITE, toWorld } from '../../data/site';
import { rng } from '../../lib/fft';

/**
 * Stylised woods around the APS (Argonne sits in a forest preserve). Deterministic groves: value-noise
 * clumping, rejecting points on buildings, roads and the ring/LOM footprint. Purely atmospheric.
 */
export function buildTrees(count = 2200): THREE.Group {
  const g = new THREE.Group();
  g.name = 'trees';
  const r = rng(20240417);
  const boxes = SITE.buildings.map((b) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of b.polygon) {
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    }
    return [x0 - 14, y0 - 14, x1 + 14, y1 + 14];
  });
  const segs: [number, number, number, number][] = [];
  for (const rd of SITE.roads ?? []) for (let i = 0; i < rd.polyline.length - 1; i++) segs.push([...rd.polyline[i], ...rd.polyline[i + 1]] as [number, number, number, number]);
  const distSeg = (px: number, py: number, s: [number, number, number, number]) => {
    const [ax, ay, bx, by] = s;
    const dx = bx - ax, dy = by - ay;
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  };
  // smooth value noise for groves
  const grid = new Float32Array(64 * 64).map(() => r());
  const noise = (x: number, y: number) => {
    const fx = (x + 1600) / 90, fy = (y + 1600) / 90;
    const ix = Math.floor(fx), iy = Math.floor(fy);
    const tx = fx - ix, ty = fy - iy;
    const v = (i: number, j: number) => grid[((j & 63) * 64 + (i & 63))];
    const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    return (v(ix, iy) * (1 - sx) + v(ix + 1, iy) * sx) * (1 - sy) + (v(ix, iy + 1) * (1 - sx) + v(ix + 1, iy + 1) * sx) * sy;
  };
  const pts: { x: number; y: number; s: number }[] = [];
  let guard = 0;
  while (pts.length < count && guard++ < count * 30) {
    const a = r() * Math.PI * 2;
    const rad = 215 + Math.pow(r(), 0.8) * 1000;
    const x = Math.cos(a) * rad;
    const y = Math.sin(a) * rad;
    if (noise(x, y) < 0.52) continue;
    if (Math.hypot(x, y) < SITE.hallOuterM + 26) continue;
    if (boxes.some(([x0, y0, x1, y1]) => x > x0 && x < x1 && y > y0 && y < y1)) continue;
    if (segs.some((s) => distSeg(x, y, s) < 9)) continue;
    pts.push({ x, y, s: 0.75 + r() * 0.6 });
  }
  const crownGeo = new THREE.ConeGeometry(3.2, 9, 7);
  crownGeo.translate(0, 8, 0);
  const roundGeo = new THREE.IcosahedronGeometry(3.8, 0);
  roundGeo.translate(0, 7, 0);
  const trunkGeo = new THREE.CylinderGeometry(0.35, 0.45, 4, 5);
  trunkGeo.translate(0, 2, 0);
  const crownMat = new THREE.MeshStandardMaterial({ color: 0x4d6458, roughness: 1, flatShading: true });
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x5b6f55, roughness: 1, flatShading: true });
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x3b3530, roughness: 1 });
  const conifers = pts.filter((_, i) => i % 3 === 0);
  const broad = pts.filter((_, i) => i % 3 !== 0);
  const mk = (geo: THREE.BufferGeometry, mat: THREE.Material, list: typeof pts, yScale = 1) => {
    const im = new THREE.InstancedMesh(geo, mat, list.length);
    const d = new THREE.Object3D();
    list.forEach((p, i) => {
      d.position.copy(toWorld(p.x, p.y, 0));
      d.rotation.y = (i * 2.399) % (Math.PI * 2);
      d.scale.set(p.s, p.s * yScale, p.s);
      d.updateMatrix();
      im.setMatrixAt(i, d.matrix);
    });
    im.castShadow = true;
    im.receiveShadow = true;
    return im;
  };
  g.add(mk(crownGeo, crownMat, conifers), mk(roundGeo, leafMat, broad, 1.05), mk(trunkGeo, trunkMat, pts));
  return g;
}
