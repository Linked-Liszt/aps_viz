import * as THREE from 'three';

/**
 * Static batching for detailed beamline scenes. Hero models are built from hundreds of small meshes; on
 * integrated GPUs the draw-call count (doubled by the shadow pass) dominates frame time. After an observation
 * window we merge meshes that provably did not move into one mesh per material. Originals are hidden, not
 * removed: references held by layout code stay valid and raycasting (which ignores visibility) still picks them.
 * The work is split into generator steps of a few milliseconds (snapshotJob / batchStaticJob) so a caller can spread it
 * over frames; snapshot() / batchStatic() run the same jobs to completion.
 *
 * Eligible: leaf THREE.Mesh, visible (object and material), not itself pickable, opaque (or order-independent glass),
 * single non-shader material without custom compile hooks, no per-object render callback, no morph targets, unchanged
 * world matrix across the window. Render order (own and inherited from groups) and shadow flags are kept per batch.
 */
export type MatrixSnapshot = Map<THREE.Mesh, Float32Array> & { mats?: Map<THREE.Material, string> };

/** Visual-state fingerprint of a material (to detect animated materials and to find identical ones). */
function matState(m: THREE.Material): string {
  const a = m as THREE.MeshStandardMaterial & THREE.MeshPhysicalMaterial;
  return [
    m.type, a.color?.getHexString(), a.emissive?.getHexString(), a.emissiveIntensity, a.roughness, a.metalness, m.opacity, m.side,
    a.map?.uuid, a.emissiveMap?.uuid, a.normalMap?.uuid, a.roughnessMap?.uuid, a.envMap?.uuid, a.flatShading, m.vertexColors, m.toneMapped,
    a.transmission, a.clearcoat, a.ior, m.depthWrite, m.depthTest, m.blending, m.polygonOffset, m.alphaTest, m.visible,
  ].join('|');
}

const defaultBeforeRender = THREE.Object3D.prototype.onBeforeRender;
const defaultCompile = THREE.Material.prototype.onBeforeCompile;

function eligible(m: THREE.Mesh, root: THREE.Object3D): boolean {
  if (!m.isMesh || (m as unknown as THREE.InstancedMesh).isInstancedMesh || (m as unknown as THREE.SkinnedMesh).isSkinnedMesh) return false;
  if (m.children.length) return false;
  if (m.onBeforeRender !== defaultBeforeRender || m.onAfterRender !== THREE.Object3D.prototype.onAfterRender) return false;
  if (m.userData.u !== undefined || m.userData.noBatch) return false;
  // pickable meshes stay as they are: Stage.pick ignores hidden pickables, so a merged-away original could not be picked
  if (m.userData.pick) return false;
  const mat = m.material as THREE.Material;
  if (!mat || Array.isArray(mat) || (mat as THREE.ShaderMaterial).isShaderMaterial || mat.onBeforeCompile !== defaultCompile) return false;
  // invisible materials (hit volumes) draw nothing: merging them would only hide the original
  if (!mat.visible) return false;
  // transparent: only order-independent "glass" (no depth write, normal blending), e.g. cut-away hutch walls
  if (mat.transparent && (mat.depthWrite || mat.blending !== THREE.NormalBlending)) return false;
  if ((mat as THREE.MeshBasicMaterial).wireframe) return false;
  // merged geometry keeps position / normal / uv only
  const sm = mat as THREE.MeshStandardMaterial;
  if (mat.vertexColors || sm.aoMap || sm.lightMap) return false;
  const g = m.geometry as THREE.BufferGeometry;
  // (face groups of primitives like BoxGeometry are irrelevant with a single material)
  if (!g?.attributes?.position || Object.keys(g.morphAttributes).length) return false;
  if (g.drawRange.start !== 0 || isFinite(g.drawRange.count)) return false;
  let o: THREE.Object3D | null = m;
  while (o && o !== root) {
    if (!o.visible) return false;
    o = o.parent;
  }
  return true;
}

/** Render order a mesh inherits from its nearest Group ancestor (three sorts render items by it first). */
function groupOrder(m: THREE.Object3D, root: THREE.Object3D): number {
  for (let o = m.parent; o; o = o.parent) {
    if ((o as THREE.Group).isGroup) return o.renderOrder;
    if (o === root) break;
  }
  return 0;
}

/** Collect every mesh's pose relative to root (and its material state), a slice at a time. */
export function* snapshotJob(root: THREE.Object3D): Generator<void, MatrixSnapshot> {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const out: MatrixSnapshot = new Map();
  const tmp = new THREE.Matrix4();
  const mats = new Map<THREE.Material, string>();
  const meshes: THREE.Mesh[] = [];
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
  });
  for (let i = 0; i < meshes.length; i++) {
    const m = meshes[i];
    out.set(m, Float32Array.from(tmp.multiplyMatrices(inv, m.matrixWorld).elements));
    const mat = m.material as THREE.Material;
    if (mat && !Array.isArray(mat) && !mats.has(mat)) mats.set(mat, matState(mat));
    if (i % 64 === 63) yield;
  }
  out.mats = mats;
  return out;
}

export interface BatchStats {
  merged: number;
  batches: number;
}

interface Bucket {
  mat: THREE.Material;
  uv: boolean;
  order: number;
  group: number;
  cast: boolean;
  recv: boolean;
  items: { mesh: THREE.Mesh; rel: THREE.Matrix4; flip: boolean; count: number }[];
  vertices: number;
}

/**
 * Merge the meshes that did not move since `before` into one mesh per (material, attributes, render order, shadow
 * flags), a slice at a time. Each mesh's triangles are de-indexed and transformed straight into the merged buffers
 * (no per-mesh copies). Nothing in the scene changes until the last step, which adds the merged meshes and hides the
 * originals together.
 */
export function* batchStaticJob(root: THREE.Object3D, before: MatrixSnapshot): Generator<void, BatchStats> {
  const after = yield* snapshotJob(root);
  const buckets = new Map<string, Bucket>();
  const canonical = new Map<string, THREE.Material>();
  let n = 0;
  for (const [m, a] of after) {
    if (++n % 64 === 0) yield;
    const b = before.get(m);
    if (!b || !eligible(m, root)) continue;
    let moved = false;
    for (let i = 0; i < 16; i++) if (Math.abs(a[i] - b[i]) > 1e-6) { moved = true; break; }
    if (moved) continue;
    const rel = new THREE.Matrix4().fromArray(a);
    const det = rel.determinant();
    if (!isFinite(det) || Math.abs(det) < 1e-12) continue;
    const g = m.geometry as THREE.BufferGeometry;
    const count = g.index ? g.index.count : g.attributes.position.count;
    if (count < 3 || count % 3) continue;
    const own = m.material as THREE.Material;
    // identical-looking, non-animated materials share one canonical instance → one draw call
    const st0 = before.mats?.get(own);
    const st1 = after.mats?.get(own);
    const animated = !st0 || st0 !== st1;
    const key = animated ? own.uuid : st1!;
    let mat = canonical.get(key);
    if (!mat) canonical.set(key, (mat = own));
    const uv = !!g.attributes.uv;
    const go = groupOrder(m, root);
    const sig = `${key}|${uv}|${m.renderOrder}|${go}|${+m.castShadow}${+m.receiveShadow}`;
    let bucket = buckets.get(sig);
    if (!bucket) buckets.set(sig, (bucket = { mat, uv, order: m.renderOrder, group: go, cast: m.castShadow, recv: m.receiveShadow, items: [], vertices: 0 }));
    bucket.items.push({ mesh: m, rel, flip: det < 0, count });
    bucket.vertices += count;
  }
  const done: { node: THREE.Object3D; meshes: THREE.Mesh[] }[] = [];
  let merged = 0;
  for (const bucket of buckets.values()) {
    if (bucket.items.length < 2) continue;
    const geo = yield* mergeJob(bucket);
    const mesh = new THREE.Mesh(geo, bucket.mat);
    mesh.name = 'static-batch';
    mesh.castShadow = bucket.cast;
    mesh.receiveShadow = bucket.recv;
    mesh.renderOrder = bucket.order;
    mesh.userData.noBatch = true;
    let node: THREE.Object3D = mesh;
    if (bucket.group !== 0) {
      // keep the render order the originals inherited from their group
      node = new THREE.Group();
      node.renderOrder = bucket.group;
      node.add(mesh);
    }
    done.push({ node, meshes: bucket.items.map((it) => it.mesh) });
    merged += bucket.items.length;
  }
  for (const d of done) {
    root.add(d.node);
    for (const m of d.meshes) m.visible = false;
  }
  return { merged, batches: done.length };
}

/** Flat view of a vertex attribute: value j of vertex v is `array[v * stride + offset + j]`. */
function flat(attr: THREE.BufferAttribute | THREE.InterleavedBufferAttribute): { array: ArrayLike<number>; stride: number; offset: number } | null {
  if (attr.normalized) return null;
  const il = attr as THREE.InterleavedBufferAttribute;
  if (il.isInterleavedBufferAttribute) return { array: il.data.array as ArrayLike<number>, stride: il.data.stride, offset: il.offset };
  return { array: attr.array as ArrayLike<number>, stride: attr.itemSize, offset: 0 };
}

/** Write every bucket member's triangles, transformed into root space, into one geometry (a few thousand per slice). */
function* mergeJob(bucket: Bucket): Generator<void, THREE.BufferGeometry> {
  const N = bucket.vertices;
  const pos = new Float32Array(N * 3);
  const nrm = new Float32Array(N * 3);
  const uvs = bucket.uv ? new Float32Array(N * 2) : null;
  const nm = new THREE.Matrix3();
  let o = 0;
  let work = 0;
  for (const { mesh, rel, flip, count } of bucket.items) {
    let g = mesh.geometry as THREE.BufferGeometry;
    if (!g.attributes.normal) {
      g = g.clone();
      g.computeVertexNormals();
    }
    // normalized (quantized) attributes go through a de-quantizing copy first
    if (!flat(g.attributes.position) || !flat(g.attributes.normal) || (uvs && !flat(g.attributes.uv))) {
      g = g.clone();
      for (const name of ['position', 'normal', 'uv']) {
        const at = g.attributes[name];
        if (!at || !at.normalized) continue;
        const out = new Float32Array(at.count * at.itemSize);
        for (let i = 0; i < at.count; i++) for (let j = 0; j < at.itemSize; j++) out[i * at.itemSize + j] = at.getComponent(i, j);
        g.setAttribute(name, new THREE.BufferAttribute(out, at.itemSize));
      }
    }
    const P = flat(g.attributes.position)!;
    const Nn = flat(g.attributes.normal)!;
    const U = uvs ? flat(g.attributes.uv) : null;
    const pa = P.array, ps = P.stride, po = P.offset;
    const na = Nn.array, ns = Nn.stride, no = Nn.offset;
    const idx = g.index ? (g.index.array as ArrayLike<number>) : null;
    const e = rel.elements;
    const q = nm.getNormalMatrix(rel).elements;
    for (let t = 0; t < count; t += 3) {
      for (let k = 0; k < 3; k++) {
        // mirrored transforms flip the winding: emit each triangle as (0, 2, 1)
        const c = t + (flip && k ? 3 - k : k);
        const v = idx ? idx[c] : c;
        let i = v * ps + po;
        const x = pa[i], y = pa[i + 1], z = pa[i + 2];
        pos[o * 3] = e[0] * x + e[4] * y + e[8] * z + e[12];
        pos[o * 3 + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
        pos[o * 3 + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
        i = v * ns + no;
        const nx = na[i], ny = na[i + 1], nz = na[i + 2];
        const tx = q[0] * nx + q[3] * ny + q[6] * nz;
        const ty = q[1] * nx + q[4] * ny + q[7] * nz;
        const tz = q[2] * nx + q[5] * ny + q[8] * nz;
        const l = 1 / (Math.sqrt(tx * tx + ty * ty + tz * tz) || 1);
        nrm[o * 3] = tx * l;
        nrm[o * 3 + 1] = ty * l;
        nrm[o * 3 + 2] = tz * l;
        if (uvs && U) {
          i = v * U.stride + U.offset;
          uvs[o * 2] = U.array[i];
          uvs[o * 2 + 1] = U.array[i + 1];
        }
        o++;
      }
    }
    work += count;
    if (work > 12000) {
      work = 0;
      yield;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  if (uvs) geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  return geo;
}

function runSync<T>(job: Generator<void, T>): T {
  for (;;) {
    const r = job.next();
    if (r.done) return r.value;
  }
}

export function snapshot(root: THREE.Object3D): MatrixSnapshot {
  return runSync(snapshotJob(root));
}

export function batchStatic(root: THREE.Object3D, before: MatrixSnapshot): BatchStats {
  return runSync(batchStaticJob(root, before));
}
