import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import type { BuildCtx } from '../../scene/beamline/layout';
import { mats } from '../../scene/palette';
import type { P2 } from './geom';
import { M, box, cached } from './kit';

/**
 * Polygonal hutches. CHEX's D/E and F hutches are rotated ~23° and A, C and G are not rectangles. The engine's outline
 * enclosures can draw polygons but its overview reduces an outline to its bounding box, which for the rotated D/E/F
 * hutches would overlap their neighbours; so the overview keeps per-hutch box overrides (layout) and this module
 * hides the engine's boxes in the exhibit and redraws each enclosure from its plan outline (FDR Fig. 4.2 / 2025
 * as-built plan), in the engine's visual language: cut-away lead-lined walls (back faces only, so the near wall and
 * roof vanish from outside viewpoints), crisp edges, a solid 0.5 m skirt and a tinted floor. The engine's hutch labels
 * are kept and moved onto the new outline, so they still fade out when the camera is far away.
 */

const FLOOR = new THREE.MeshStandardMaterial({ color: 0x223047, roughness: 0.95, side: THREE.DoubleSide });

/** Same as the engine's cut-away hutch glass: translucent, rendered from the inside only. */
const cutaway = () =>
  cached('chex-cutaway', () => {
    const m = (mats.hutchGlass() as THREE.MeshStandardMaterial).clone();
    m.side = THREE.BackSide;
    m.opacity = 0.2;
    return m;
  });

/** Signed area in the local (x, z) plane; > 0 = counter-clockwise (wall normals would point inward). */
const signedArea = (poly: P2[]) => poly.reduce((a, p, i) => { const q = poly[(i + 1) % poly.length]; return a + p.x * q.z - q.x * p.z; }, 0) / 2;

export function polygonHutch(beamY: number, outline: P2[], height = 3.3): THREE.Group {
  // walk the outline clockwise so every wall plane's normal faces outward (required for the back-face cut-away)
  const poly = signedArea(outline) > 0 ? [...outline].reverse() : outline;
  const g = new THREE.Group();
  g.name = 'chex-hutch';
  const y0 = -beamY;
  // floor
  const shape = new THREE.Shape(poly.map((p) => new THREE.Vector2(p.x, -p.z)));
  const floor = new THREE.Mesh(new THREE.ShapeGeometry(shape), FLOOR);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = y0 + 0.035;
  floor.receiveShadow = true;
  g.add(floor);
  const edgePts: number[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    if (len < 1e-3) continue;
    const yaw = -Math.atan2(dz, dx);
    // translucent wall
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(len, height), cutaway());
    wall.position.set((a.x + b.x) / 2, y0 + height / 2, (a.z + b.z) / 2);
    wall.rotation.y = yaw;
    wall.renderOrder = 2;
    g.add(wall);
    // solid low skirt
    const skirt = box(len, 0.5, 0.08, mats.model(), 0);
    skirt.position.set((a.x + b.x) / 2, y0 + 0.25, (a.z + b.z) / 2);
    skirt.rotation.y = yaw;
    skirt.castShadow = true;
    skirt.receiveShadow = true;
    g.add(skirt);
    // edges: bottom, top, vertical corner
    edgePts.push(a.x, y0, a.z, b.x, y0, b.z);
    edgePts.push(a.x, y0 + height, a.z, b.x, y0 + height, b.z);
    edgePts.push(a.x, y0, a.z, a.x, y0 + height, a.z);
  }
  const eg = new THREE.BufferGeometry();
  eg.setAttribute('position', new THREE.Float32BufferAttribute(edgePts, 3));
  g.add(new THREE.LineSegments(eg, mats.hutchEdge()));
  return g;
}

/** All CSS2D hutch labels the engine made (one per drawn enclosure). */
function hutchLabels(root: THREE.Object3D): Map<string, CSS2DObject> {
  const out = new Map<string, CSS2DObject>();
  root.traverse((o) => {
    if (o instanceof CSS2DObject && o.element.classList.contains('lbl-hutch')) out.set(o.element.textContent ?? '', o);
  });
  return out;
}

/**
 * Replace the engine's box for `name` by a polygon outline; move its label to `labelAt` (x, z, y above beam).
 * Returns the new hutch group (already added to the beamline group).
 */
export function replaceEnclosure(ctx: BuildCtx, name: string, poly: P2[], labelAt: P2, height = 3.3): THREE.Group {
  const old = ctx.group.getObjectByName(`enclosure-${name}`);
  if (old) old.visible = false;
  const h = polygonHutch(ctx.beamY, poly, height);
  h.name = `chex-hutch-${name}`;
  ctx.group.add(h);
  const lbl = hutchLabels(ctx.group).get(name);
  if (lbl) lbl.position.copy(ctx.at(labelAt.x, labelAt.z, height - ctx.beamY + 0.3));
  return h;
}

export function moveLabel(ctx: BuildCtx, name: string, x: number, z: number, up: number): void {
  const lbl = hutchLabels(ctx.group).get(name);
  if (lbl) lbl.position.copy(ctx.at(x, z, up));
}

/**
 * The storage-ring shield (ratchet) wall the beams cross between 22.1 and 23.6 m (2025 ray-trace plan): drawn as a
 * section of heavy concrete (translucent, so the wall collimator and front-end pipe inside stay visible).
 */
export function ratchetWall(ctx: BuildCtx, x0: number, x1: number): THREE.Group {
  const g = new THREE.Group();
  g.name = 'chex-ratchet-wall';
  const h = 3.6;
  const geo = new THREE.BoxGeometry(x1 - x0, h, 5.0);
  const mat = new THREE.MeshStandardMaterial({ color: 0x9d9a93, roughness: 0.95, transparent: true, opacity: 0.32, depthWrite: false });
  const slab = new THREE.Mesh(geo, mat);
  slab.position.set((x0 + x1) / 2, -ctx.beamY + h / 2, -0.6);
  slab.renderOrder = 3;
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: 0xb8b4ab, transparent: true, opacity: 0.6 }));
  edges.position.copy(slab.position);
  g.add(slab, edges);
  // the round pass-through the beams use (a dark sleeve through the wall)
  const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, x1 - x0 + 0.02, 24, 1, true), new THREE.MeshStandardMaterial({ color: 0x3a3f46, roughness: 0.6, side: THREE.DoubleSide }));
  sleeve.rotation.z = Math.PI / 2;
  sleeve.position.set((x0 + x1) / 2, 0, -0.012);
  g.add(sleeve);
  ctx.group.add(g);
  return g;
}

/** Floor-standing equipment rack / gas cabinet. */
export function cabinet(beamY: number, w: number, h: number, d: number, m: THREE.Material = M.cabinet()): THREE.Mesh {
  const c = box(w, h, d, m, 0.02);
  c.position.y = -beamY + h / 2;
  c.castShadow = true;
  c.receiveShadow = true;
  return c;
}
