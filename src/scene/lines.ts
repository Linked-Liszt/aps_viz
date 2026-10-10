import * as THREE from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';

/** Screen-space fat lines (constant pixel width) for beams seen from far away. */
const registry = new Set<LineMaterial>();
const size = new THREE.Vector2(1, 1);

export function setLineResolution(w: number, h: number): void {
  size.set(w, h);
  for (const m of registry) m.resolution.copy(size);
}

export interface FatLineOpts {
  color: THREE.Color | number;
  intensity?: number;
  width?: number;
  opacity?: number;
  dashed?: boolean;
  dashSize?: number;
  gapSize?: number;
  worldUnits?: boolean;
  depthTest?: boolean;
}

export function fatLine(points: THREE.Vector3[], o: FatLineOpts): Line2 {
  const geo = new LineGeometry();
  const arr: number[] = [];
  for (const p of points) arr.push(p.x, p.y, p.z);
  geo.setPositions(arr);
  const c = new THREE.Color(o.color).multiplyScalar(o.intensity ?? 1);
  const mat = new LineMaterial({
    color: c.getHex(),
    linewidth: o.width ?? 2,
    worldUnits: o.worldUnits ?? false,
    transparent: (o.opacity ?? 1) < 1,
    opacity: o.opacity ?? 1,
    dashed: o.dashed ?? false,
    dashSize: o.dashSize ?? 1,
    gapSize: o.gapSize ?? 1,
    depthTest: o.depthTest ?? true,
  });
  // Beamline groups may be mirrored (scale.z = -1 so +Z is outboard); Line2 quads would then be back-face culled.
  mat.side = THREE.DoubleSide;
  // allow HDR (>1) colour so bloom picks the line up
  mat.color.copy(c);
  mat.toneMapped = false;
  mat.resolution.copy(size);
  registry.add(mat);
  const line = new Line2(geo, mat);
  if (o.dashed) line.computeLineDistances();
  line.frustumCulled = false;
  return line;
}

export function disposeFatLine(line: Line2): void {
  registry.delete(line.material as LineMaterial);
  line.geometry.dispose();
  (line.material as LineMaterial).dispose();
}

export function circlePoints(cx: number, cz: number, r: number, y: number, n = 256): THREE.Vector3[] {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    pts.push(new THREE.Vector3(cx + r * Math.cos(a), y, cz + r * Math.sin(a)));
  }
  return pts;
}

/** Many independent screen-space segments in ONE draw call, with per-segment (HDR) colours. */
export interface FatSegments {
  object: LineSegments2;
  setSegmentColor(i: number, c: THREE.Color): void;
  commitColors(): void;
}

export function fatSegments(segs: [THREE.Vector3, THREE.Vector3][], colors: THREE.Color[], o: Omit<FatLineOpts, 'color'>): FatSegments {
  const geo = new LineSegmentsGeometry();
  const pos: number[] = [];
  for (const [a, b] of segs) pos.push(a.x, a.y, a.z, b.x, b.y, b.z);
  geo.setPositions(pos);
  const col = new Float32Array(segs.length * 6);
  const write = (i: number, c: THREE.Color) => {
    col.set([c.r, c.g, c.b, c.r, c.g, c.b], i * 6);
  };
  colors.forEach((c, i) => write(i, c));
  geo.setColors(col);
  const mat = new LineMaterial({
    color: 0xffffff,
    vertexColors: true,
    linewidth: o.width ?? 1.5,
    worldUnits: o.worldUnits ?? false,
    transparent: (o.opacity ?? 1) < 1,
    opacity: o.opacity ?? 1,
  });
  mat.side = THREE.DoubleSide;
  mat.toneMapped = false;
  mat.resolution.copy(size);
  registry.add(mat);
  const object = new LineSegments2(geo, mat);
  object.frustumCulled = false;
  return {
    object,
    setSegmentColor: write,
    commitColors: () => geo.setColors(col),
  };
}

/** Unregister (and dispose) every fat-line material under a subtree — call when the subtree is discarded. */
export function releaseLines(root: THREE.Object3D): void {
  root.traverse((o) => {
    const m = (o as THREE.Mesh).material;
    if (m instanceof LineMaterial) {
      registry.delete(m);
      m.dispose();
    }
  });
}
