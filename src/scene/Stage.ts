import * as THREE from 'three';
import CameraControls from 'camera-controls';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { FXAAPass } from 'three/addons/postprocessing/FXAAPass.js';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Tweens, ease, lerp } from '../lib/tween';
import { prefersReducedMotion } from '../lib/dom';
import { labelEpoch } from './beamline/labels';
import type { Quality } from '../app/store';

CameraControls.install({ THREE });

export interface Pickable {
  kind: string;
  id: string;
  /** Cursor hint shown near the pointer on hover. */
  hint?: string;
  /** hover-only: clicks pass through to the next pickable behind (e.g. buildings over the hall floor) */
  passThroughClick?: boolean;
}

export type FrameFn = (dt: number, t: number) => void;

/** Pixels of the canvas covered by UI chrome on each side. */
export interface Insets {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

const finite = (v: THREE.Vector3): boolean => Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);

/** Hover picking runs at most this often (ms); clicks always pick at once. */
const HOVER_PICK_MS = 50;
/** Cached pickable bounding boxes used by hover picking are refreshed this often (ms). */
const PICK_BOX_MS = 500;
/** CSS2D labels re-render at least this often (s) even when nothing tracked has changed. */
const LABEL_REFRESH_S = 0.5;

/**
 * Owns the WebGL renderer, camera, controls, post-processing, DOM labels, picking and the frame loop.
 * Everything else registers frame callbacks and pickable meshes.
 */
export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: CameraControls;
  readonly labels: CSS2DRenderer;
  readonly tweens = new Tweens();
  readonly sun: THREE.DirectionalLight;
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private fxaa: FXAAPass;
  private clock = new THREE.Timer();
  private frameFns = new Set<FrameFn>();
  private pickables: THREE.Object3D[] = [];
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2(-9, -9);
  private pointerDirty = false;
  private hoverPickAt = 0;
  private downAt = { x: 0, y: 0, t: 0 };
  private hovered: { obj: THREE.Object3D; info: Pickable } | null = null;
  private flight: { cancel: () => void } | null = null;
  private quality: Quality = 'balanced';
  private elapsed = 0;
  private running = true;
  private paused = false;
  /** a paused stage still redraws once after its canvas was resized (resizing clears it) */
  private pausedRedraw = false;
  private shadowHz = 0;
  private shadowAt = 0;
  onHover: (info: Pickable | null, obj: THREE.Object3D | null) => void = () => {};
  onPick: (info: Pickable | null, obj: THREE.Object3D | null, ev: PointerEvent) => void = () => {};
  /** Fires when the user manually starts dragging/zooming the camera (pointer or keyboard). */
  onUserCamera: () => void = () => {};
  /**
   * Which pickables take part in hover and click right now (e.g. only the open beamline's components). Pickables it
   * rejects are ignored entirely, so they neither show a pointer cursor nor block what lies behind them.
   */
  pickFilter: (info: Pickable) => boolean = () => true;

  constructor(host: HTMLElement, labelHost: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: /[?&]test\b/.test(location.search) });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    this.renderer.setSize(host.clientWidth, host.clientHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    // The shadow casters are static apart from a few animated parts: the shadow map is redrawn on request
    // (requestShadowUpdate) and, while something animates, at a few Hz (setShadowRate) instead of every frame.
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.shadowMap.needsUpdate = true;
    host.appendChild(this.renderer.domElement);
    const el = this.renderer.domElement;
    // keyboard-operable (arrows rotate, Shift+arrows pan, +/- zoom, Home re-frames: see App)
    el.tabIndex = 0;
    el.setAttribute('role', 'application');
    el.setAttribute('aria-roledescription', '3D model');
    el.setAttribute('aria-keyshortcuts', 'ArrowLeft ArrowRight ArrowUp ArrowDown Shift+ArrowLeft Shift+ArrowRight Shift+ArrowUp Shift+ArrowDown + - PageUp PageDown Home');
    this.setLabel('3D model of the Advanced Photon Source');

    this.camera = new THREE.PerspectiveCamera(42, host.clientWidth / host.clientHeight, 0.05, 6000);
    this.camera.position.set(0, 420, 520);

    this.scene.background = new THREE.Color(0x070b12);
    this.scene.fog = new THREE.FogExp2(0x070b12, 0.00085);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.35;

    const hemi = new THREE.HemisphereLight(0xcfe3ff, 0x1a1f29, 0.55);
    this.scene.add(hemi);
    this.sun = new THREE.DirectionalLight(0xfff2e0, 1.35);
    this.sun.position.set(-260, 420, 180);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.6;
    this.fitShadow(new THREE.Vector3(0, 0, 0), 330);
    this.scene.add(this.sun, this.sun.target);

    this.controls = new CameraControls(this.camera, this.renderer.domElement);
    this.controls.smoothTime = 0.35;
    this.controls.draggingSmoothTime = 0.08;
    this.controls.maxPolarAngle = Math.PI * 0.47;
    this.controls.minDistance = 1.2;
    this.controls.maxDistance = 1500;
    this.controls.dollyToCursor = true;
    this.controls.dollySpeed = 0.6;
    this.controls.addEventListener('controlstart', () => this.userCamera());
    this.controls.setLookAt(0, 420, 520, 0, 0, 0, false);

    this.labels = new CSS2DRenderer({ element: labelHost });
    this.labels.setSize(host.clientWidth, host.clientHeight);

    this.composer = new EffectComposer(this.renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 0 }));
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(host.clientWidth, host.clientHeight), 0.7, 0.45, 1.25);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.fxaa = new FXAAPass();
    this.composer.addPass(this.fxaa);
    this.resize(host);

    const ro = new ResizeObserver(() => this.resize(host));
    ro.observe(host);

    el.addEventListener('pointermove', (e) => {
      const r = el.getBoundingClientRect();
      this.pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      this.pointerDirty = true;
    });
    el.addEventListener('pointerleave', () => {
      this.pointer.set(-9, -9);
      this.pointerDirty = true;
    });
    el.addEventListener('pointerdown', (e) => {
      this.downAt = { x: e.clientX, y: e.clientY, t: performance.now() };
    });
    el.addEventListener('pointerup', (e) => {
      const moved = Math.hypot(e.clientX - this.downAt.x, e.clientY - this.downAt.y);
      if (moved > 6 || performance.now() - this.downAt.t > 600) return;
      const r = el.getBoundingClientRect();
      this.pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      const hit = this.pick(true);
      this.onPick(hit?.info ?? null, hit?.obj ?? null, e);
    });

    document.addEventListener('visibilitychange', () => {
      this.running = !document.hidden;
      if (this.running) this.clock.reset();
    });

    this.renderer.setAnimationLoop(() => this.frame());
  }

  /** Accessible name of the 3D canvas (kept in step with the view by the app). */
  setLabel(text: string): void {
    this.renderer.domElement.setAttribute('aria-label', text);
  }

  setQuality(q: Quality): void {
    this.quality = q;
    const dpr = window.devicePixelRatio;
    this.renderer.setPixelRatio(q === 'high' ? Math.min(dpr, 2) : q === 'balanced' ? Math.min(dpr, 1.25) : 0.85);
    this.renderer.shadowMap.enabled = q !== 'low';
    this.sun.castShadow = q !== 'low';
    this.bloom.enabled = q !== 'low';
    // MSAA on the float target is the dominant cost on integrated GPUs: only in "high"; FXAA otherwise.
    const samples = q === 'high' ? 4 : 0;
    for (const rt of [this.composer.renderTarget1, this.composer.renderTarget2]) {
      if (rt.samples !== samples) {
        rt.samples = samples;
        rt.dispose();
      }
    }
    this.fxaa.enabled = q === 'balanced';
    this.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | undefined;
      if (m) m.needsUpdate = true;
    });
    this.requestShadowUpdate();
    const host = this.renderer.domElement.parentElement;
    if (host) this.resize(host);
  }

  getQuality(): Quality {
    return this.quality;
  }

  /** Keep the shadow frustum tight around the area of interest for crisp shadows. */
  fitShadow(center: THREE.Vector3, radius: number): void {
    const cam = this.sun.shadow.camera as THREE.OrthographicCamera;
    cam.left = -radius;
    cam.right = radius;
    cam.top = radius;
    cam.bottom = -radius;
    cam.near = 1;
    cam.far = 2000;
    cam.updateProjectionMatrix();
    const dir = new THREE.Vector3(-0.5, 0.82, 0.3).normalize();
    this.sun.position.copy(center).addScaledVector(dir, 800);
    this.sun.target.position.copy(center);
    this.sun.target.updateMatrixWorld();
    this.sun.shadow.needsUpdate = true;
    this.requestShadowUpdate();
  }

  /**
   * Redraw the shadow map on the next frame. Call after anything that adds, removes, shows, hides or moves a shadow
   * caster (entering or leaving a beamline, tour scenery, static batching…).
   */
  requestShadowUpdate(): void {
    this.renderer.shadowMap.needsUpdate = true;
  }

  /** Also redraw the shadow map `hz` times a second (0: only on request), e.g. while parts of a scene animate. */
  setShadowRate(hz: number): void {
    this.shadowHz = Math.max(0, hz);
  }

  /**
   * Stop rendering (and updating) the scene, e.g. while a full-screen dialog covers it. The last frame stays on the
   * canvas; it is redrawn once if the canvas is resized meanwhile.
   */
  setPaused(paused: boolean): void {
    if (this.paused === paused) return;
    this.paused = paused;
    if (!paused) {
      this.clock.reset();
      this.labelsDirty = true;
      this.pointerDirty = true;
    }
  }

  get isPaused(): boolean {
    return this.paused;
  }

  private insets: Insets = { left: 0, right: 0, top: 0, bottom: 0 };
  private insetCur = { x: 0, y: 0 };
  private insetTarget = { x: 0, y: 0 };

  /**
   * Shift the projection centre so the 3D focus sits in the visible area between UI panels
   * (pixels covered on each side). Animated smoothly in the frame loop.
   */
  setInsets(i: Partial<Insets>): void {
    this.insets = { left: 0, right: 0, top: 0, bottom: 0, ...i };
    this.insetTarget = { x: (this.insets.right - this.insets.left) / 2, y: (this.insets.bottom - this.insets.top) / 2 };
    // deterministic projection for automated tests (no easing)
    if (/[?&]test\b/.test(location.search)) {
      this.insetCur = { ...this.insetTarget };
      this.applyViewOffset();
    }
  }

  /** The UI insets last set (the area camera shots and pin layouts keep clear of). */
  getInsets(): Insets {
    return { ...this.insets };
  }

  private applyViewOffset(w = this.renderer.domElement.clientWidth || 1, hgt = this.renderer.domElement.clientHeight || 1): void {
    // setViewOffset/clearViewOffset recompute the projection (and setViewOffset sets aspect = fullWidth / fullHeight),
    // so they must always see the canvas size the renderer is about to use
    this.camera.aspect = w / hgt;
    if (Math.abs(this.insetCur.x) < 0.5 && Math.abs(this.insetCur.y) < 0.5) this.camera.clearViewOffset();
    else this.camera.setViewOffset(w, hgt, this.insetCur.x, this.insetCur.y, w, hgt);
  }

  private resize(host: HTMLElement): void {
    const w = Math.max(1, host.clientWidth);
    const hgt = Math.max(1, host.clientHeight);
    this.renderer.setSize(w, hgt);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, hgt);
    this.labels.setSize(w, hgt);
    this.applyViewOffset(w, hgt);
    this.labelsDirty = true;
    this.pausedRedraw = true;
  }

  onFrame(fn: FrameFn): () => void {
    this.frameFns.add(fn);
    return () => this.frameFns.delete(fn);
  }

  addPickable(obj: THREE.Object3D, info: Pickable): void {
    obj.userData.pick = info;
    this.pickables.push(obj);
  }

  removePickables(pred: (info: Pickable) => boolean): void {
    this.pickables = this.pickables.filter((o) => {
      const gone = pred(o.userData.pick as Pickable);
      if (gone) this.pickBoxes.delete(o);
      return !gone;
    });
    if (this.hovered && !this.pickables.includes(this.hovered.obj)) this.pointerDirty = true;
  }

  /** Re-evaluate what is under the pointer on the next frame (e.g. after the view, and so pickFilter, changed). */
  refreshHover(): void {
    this.pointerDirty = true;
    this.hoverPickAt = 0;
  }

  private pickBoxes = new Map<THREE.Object3D, { box: THREE.Box3; at: number; margin: number }>();
  private pickCands: { obj: THREE.Object3D; d: number }[] = [];
  private pickCandPool: { obj: THREE.Object3D; d: number }[] = [];
  private pickHits: THREE.Intersection[] = [];
  private pickPoint = new THREE.Vector3();

  /** World bounding box of a pickable (hidden descendants included: raycasting tests them too), cached. */
  private pickBox(o: THREE.Object3D, fresh: boolean, now: number, margin: number): THREE.Box3 {
    let e = this.pickBoxes.get(o);
    if (!e) this.pickBoxes.set(o, (e = { box: new THREE.Box3(), at: -Infinity, margin: 0 }));
    if (fresh || now - e.at > PICK_BOX_MS) {
      e.box.setFromObject(o);
      // lines and points are hit within the raycaster's threshold of their geometry
      if (!e.box.isEmpty()) e.box.expandByScalar(margin);
      e.at = now;
      e.margin = margin;
    } else if (margin > e.margin) {
      // zooming out widens the line tolerance: grow the cached box rather than measure it again
      if (!e.box.isEmpty()) e.box.expandByScalar(margin - e.margin);
      e.margin = margin;
    }
    return e.box;
  }

  /**
   * The pickable under the pointer. Broad phase: the ray against each active pickable's bounding box; narrow phase:
   * exact raycasts of the candidates, nearest box first, stopping once no remaining box can hold a nearer hit.
   * `fresh` re-measures the boxes first (clicks); hover uses boxes up to PICK_BOX_MS old.
   */
  private pick(fresh = false): { obj: THREE.Object3D; info: Pickable } | null {
    if (this.pointer.x < -2) return null;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    // Thin lines (edge outlines) and points count as hit within ~4 px at the distance the camera looks at, not three's
    // default of 1 m, which from across a beamline lets a neighbour's outline win over the part under the pointer.
    const el = this.renderer.domElement;
    const tol = (4 * 2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2) * this.controls.distance) / (el.clientHeight || 1);
    this.raycaster.params.Line.threshold = tol;
    this.raycaster.params.Points.threshold = tol;
    const margin = 0.02 + tol;
    const ray = this.raycaster.ray;
    const now = performance.now();
    const cands = this.pickCands;
    cands.length = 0;
    for (const o of this.pickables) {
      if (!this.pickFilter(o.userData.pick as Pickable) || !isVisibleInTree(o)) continue;
      const box = this.pickBox(o, fresh, now, margin);
      if (box.isEmpty() || !ray.intersectBox(box, this.pickPoint)) continue;
      const c = (this.pickCandPool[cands.length] ??= { obj: o, d: 0 });
      c.obj = o;
      c.d = box.containsPoint(ray.origin) ? 0 : ray.origin.distanceTo(this.pickPoint);
      cands.push(c);
    }
    cands.sort((a, b) => a.d - b.d);
    // hover and click agree: hover-only objects (buildings) yield to whatever clickable lies behind them
    let best: { dist: number; obj: THREE.Object3D; info: Pickable } | null = null;
    let first: { dist: number; obj: THREE.Object3D; info: Pickable } | null = null;
    for (const c of cands) {
      if (best && c.d > best.dist) break;
      const hits = this.pickHits;
      hits.length = 0;
      this.raycaster.intersectObject(c.obj, true, hits);
      for (const hit of hits) {
        if (best && hit.distance >= best.dist) break;
        let o: THREE.Object3D | null = hit.object;
        while (o && !o.userData.pick) o = o.parent;
        if (!o) continue;
        const info = o.userData.pick as Pickable;
        if (!this.pickFilter(info)) continue;
        if (!first || hit.distance < first.dist) first = { dist: hit.distance, obj: o, info };
        if (!info.passThroughClick) {
          best = { dist: hit.distance, obj: o, info };
          break;
        }
      }
    }
    for (const c of cands) c.obj = this.scene; // drop references to (possibly disposed) objects
    const r = best ?? first;
    return r ? { obj: r.obj, info: r.info } : null;
  }

  /** Cinematic camera flight with an arc, after which user control resumes. Resolves true if it arrived. */
  flyTo(pos: THREE.Vector3, target: THREE.Vector3, opts: { duration?: number; arc?: number } = {}): Promise<boolean> {
    if (!finite(pos) || !finite(target)) {
      console.warn('flyTo: ignoring a non-finite camera pose', pos, target);
      return Promise.resolve(false);
    }
    this.cancelFlight();
    const p0 = this.controls.getPosition(new THREE.Vector3());
    const t0 = this.controls.getTarget(new THREE.Vector3());
    // a camera that somehow lost its pose is put back, not interpolated from NaN
    if (!finite(p0) || !finite(t0)) {
      this.jumpTo(pos, target);
      return Promise.resolve(true);
    }
    const dist = p0.distanceTo(pos) + t0.distanceTo(target);
    const reduced = prefersReducedMotion() || /[?&]test\b/.test(location.search);
    const duration = reduced ? 0.01 : (opts.duration ?? Math.min(3.2, 1.1 + Math.sqrt(dist) * 0.07));
    const arc = reduced ? 0 : (opts.arc ?? Math.min(260, dist * 0.22));
    const p = new THREE.Vector3();
    const t = new THREE.Vector3();
    const run = this.tweens.run(
      duration,
      (k) => {
        p.lerpVectors(p0, pos, k);
        p.y += Math.sin(Math.PI * k) * arc;
        // ease target slightly ahead of the camera so the view "leads" into the destination
        const kt = Math.min(1, k * 1.15);
        t.set(lerp(t0.x, target.x, kt), lerp(t0.y, target.y, kt), lerp(t0.z, target.z, kt));
        this.controls.setLookAt(p.x, p.y, p.z, t.x, t.y, t.z, false);
      },
      ease.inOutQuint,
    );
    this.flight = run;
    return run.done.then((arrived) => {
      if (this.flight === run) this.flight = null;
      return arrived;
    });
  }

  /** Place the camera at once (no flight). Non-finite poses are ignored so one bad value cannot poison the controls. */
  jumpTo(pos: THREE.Vector3, target: THREE.Vector3): boolean {
    if (!finite(pos) || !finite(target)) {
      console.warn('jumpTo: ignoring a non-finite camera pose', pos, target);
      return false;
    }
    this.controls.setLookAt(pos.x, pos.y, pos.z, target.x, target.y, target.z, false);
    return true;
  }

  cancelFlight(): void {
    if (this.flight) {
      this.flight.cancel();
      this.flight = null;
    }
  }

  /** The user took the camera (drag, wheel, keys): flights and scripted moves stop. */
  private userCamera(): void {
    this.cancelFlight();
    this.onUserCamera();
  }

  /** Keyboard orbit around the target (radians), eased. Positive `polar` tilts down towards the horizon. */
  orbitBy(azimuth: number, polar: number): void {
    this.userCamera();
    void this.controls.rotate(azimuth, polar, true);
  }

  /**
   * Keyboard pan over the ground, as fractions of the camera–target distance: +fx to the right on screen, +fy
   * forward (away from the viewer, level with the ground, like a map), eased.
   */
  panBy(fx: number, fy: number): void {
    this.userCamera();
    const d = this.controls.distance;
    if (fx) void this.controls.truck(fx * d, 0, true);
    if (fy) void this.controls.forward(fy * d, true);
  }

  /** Keyboard zoom: move a fraction of the camera–target distance towards (+) or away from (−) the target, eased. */
  zoomBy(f: number): void {
    this.userCamera();
    void this.controls.dolly(this.controls.distance * f, true);
  }

  /**
   * Camera pose looking from direction `dir` (target → camera) at the centre of `points`, at the distance where all
   * of them fit inside the canvas area left free by the UI insets, with `pad` px to spare on every side. `labels`
   * reserve screen room for DOM labels: a w × h px box centred on each anchor must fit as well. `target` keeps a given
   * look-at point instead of the centre.
   */
  framePoints(
    points: THREE.Vector3[],
    dir: THREE.Vector3,
    opts: { pad?: number; labels?: { at: THREE.Vector3; w: number; h: number }[]; target?: THREE.Vector3 } = {},
  ): { pos: THREE.Vector3; target: THREE.Vector3 } {
    const pad = opts.pad ?? 24;
    const labels = opts.labels ?? [];
    const target = opts.target?.clone() ?? new THREE.Box3().setFromPoints([...points, ...labels.map((l) => l.at)]).getCenter(new THREE.Vector3());
    const w = dir.clone().normalize();
    const right = new THREE.Vector3(0, 1, 0).cross(w);
    if (right.lengthSq() < 1e-8) right.set(1, 0, 0);
    right.normalize();
    const up = new THREE.Vector3().crossVectors(w, right);
    const el = this.renderer.domElement;
    const W = el.clientWidth || 1;
    const H = el.clientHeight || 1;
    const i = this.insets;
    const visW = Math.max(80, W - i.left - i.right - 2 * pad);
    const visH = Math.max(80, H - i.top - i.bottom - 2 * pad);
    // half-extent of the free area in tan units (screen offset / depth); one pixel is 2t/H of them
    const t = Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2);
    const perPx = (2 * t) / H;
    const tanX = (visW / 2) * perPx;
    const tanY = (visH / 2) * perPx;
    const q = new THREE.Vector3();
    const need = (p: THREE.Vector3, hw: number, hh: number): number => {
      q.subVectors(p, target);
      const depth = q.dot(w);
      return Math.max(depth + Math.abs(q.dot(right)) / Math.max(0.05 * tanX, tanX - hw * perPx), depth + Math.abs(q.dot(up)) / Math.max(0.05 * tanY, tanY - hh * perPx));
    };
    let D = 1;
    for (const p of points) D = Math.max(D, need(p, 0, 0));
    // label room is best effort: it may pull the camera back by a quarter at most (on a phone a wide label would
    // otherwise shrink the whole scene to make room for itself)
    let DL = D;
    for (const l of labels) DL = Math.max(DL, need(l.at, l.w / 2, l.h / 2));
    D = Math.min(DL, D * 1.25);
    return { pos: target.clone().addScaledVector(w, D), target };
  }

  get time(): number {
    return this.elapsed;
  }

  /** Force the CSS2D label layer to re-render on the next frame (labels added, removed or restyled). */
  invalidateLabels(): void {
    this.labelsDirty = true;
  }

  private labelsDirty = true;
  private labelsAt = -Infinity;
  private labelEpochSeen = -1;
  private labelCam = new THREE.Matrix4();
  private labelProj = new THREE.Matrix4();

  /**
   * The CSS2D layer only needs a pass when something it shows changed: the camera (view or projection, which includes
   * the inset offset and canvas size), a label shown, hidden or moved (labelEpoch), or an explicit invalidation.
   * A slow periodic pass catches anything untracked.
   */
  private renderLabels(): void {
    const cam = this.camera;
    const epoch = labelEpoch();
    if (
      !this.labelsDirty &&
      epoch === this.labelEpochSeen &&
      this.elapsed - this.labelsAt < LABEL_REFRESH_S &&
      cam.matrixWorld.equals(this.labelCam) &&
      cam.projectionMatrix.equals(this.labelProj)
    )
      return;
    this.labels.render(this.scene, cam);
    this.labelsDirty = false;
    this.labelEpochSeen = epoch;
    this.labelsAt = this.elapsed;
    this.labelCam.copy(cam.matrixWorld);
    this.labelProj.copy(cam.projectionMatrix);
  }

  private renderScene(dt: number): void {
    if (this.quality === 'low') this.renderer.render(this.scene, this.camera);
    else this.composer.render(dt);
  }

  private frame(): void {
    if (!this.running) return;
    if (this.paused) {
      if (this.pausedRedraw) {
        this.pausedRedraw = false;
        this.renderScene(0);
        this.labels.render(this.scene, this.camera);
      }
      return;
    }
    this.pausedRedraw = false;
    this.clock.update();
    const dt = Math.min(0.05, this.clock.getDelta());
    this.elapsed += dt;
    this.tweens.update(this.elapsed);
    const kx = this.insetTarget.x - this.insetCur.x;
    const ky = this.insetTarget.y - this.insetCur.y;
    if (Math.abs(kx) > 0.3 || Math.abs(ky) > 0.3) {
      const a = 1 - Math.exp(-dt * 5);
      this.insetCur.x += kx * a;
      this.insetCur.y += ky * a;
      this.applyViewOffset();
    }
    this.controls.update(dt);
    for (const fn of this.frameFns) fn(dt, this.elapsed);
    const now = performance.now();
    if (this.pointerDirty && now - this.hoverPickAt >= HOVER_PICK_MS) {
      this.pointerDirty = false;
      this.hoverPickAt = now;
      const hit = this.pick();
      if (hit?.obj !== this.hovered?.obj) {
        this.hovered = hit;
        this.renderer.domElement.style.cursor = hit ? 'pointer' : '';
        this.onHover(hit?.info ?? null, hit?.obj ?? null);
      }
    }
    if (this.shadowHz > 0 && this.elapsed - this.shadowAt >= 1 / this.shadowHz) {
      this.shadowAt = this.elapsed;
      this.requestShadowUpdate();
    }
    this.renderScene(dt);
    this.renderLabels();
  }
}

function isVisibleInTree(o: THREE.Object3D): boolean {
  let c: THREE.Object3D | null = o;
  while (c) {
    if (!c.visible) return false;
    c = c.parent;
  }
  return true;
}
