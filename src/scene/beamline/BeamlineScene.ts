import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import type { Stage, Pickable } from '../Stage';
import type { Beamline, BeamlineComponent, BeamlineMeta, Enclosure } from '../../data/types';
import { sectorFrame, SITE, type SectorFrame } from '../../data/site';
import { buildPart, scalePerson } from './parts';
import { mats, COLORS, glowMaterial, isShared, markShared } from '../palette';
import { fatLine, releaseLines } from '../lines';
import { batchStaticJob, snapshotJob, type BatchStats, type MatrixSnapshot } from './batch';
import { branchSide, compBranch, type BeamlineLayout, type BuildCtx, type ScatterSpec } from './layout';
import { showLabel, hideLabelNow, touchLabels, overlaps, safeRect, inside, stageInsets, type Rect, type SafeInsets } from './labels';
import { MotionClock } from './motion';

const WHITE_BEAM = new THREE.Color(1.0, 0.93, 0.82);
const PINK_BEAM = new THREE.Color(1.0, 0.62, 0.78);

export interface PlacedComponent {
  data: BeamlineComponent;
  index: number;
  object: THREE.Object3D;
  /** local position (beamline frame) */
  local: THREE.Vector3;
  pin: CSS2DObject;
  branch: string | null;
}

interface PulseTrack {
  curve: THREE.CurvePath<THREE.Vector3>;
  length: number;
  /** phase offset of each pulse along the track (0..1) */
  phase: Float32Array;
  speed: number;
  /** the beam lines this track rides on: pulses vanish with their beam (layouts may hide engine beams) */
  lines: THREE.Object3D[];
}

/** Per-pin data fixed at build time (declutter runs every few frames and must not allocate or parse names). */
interface PinInfo {
  /** declutter priority: layout pinPriority, else by category (1 plumbing … 3 headline) */
  base: number;
  minor: boolean;
  quiet: boolean;
  headline: boolean;
  /** estimated full-label width (px) */
  width: number;
  /** pin anchor (local) above the component */
  home: THREE.Vector3;
  /** local height of the component's top (bounding box), measured on first need */
  top?: number | null;
  leader?: HTMLElement;
}

/** Pin box relative to its anchor point (px): the button sits up and to the right of the anchor. */
const PIN_BOX = { left: -10, top: -34, bottom: -8 };
const COMPACT_W = 24;
/** extra clearance kept from UI chrome and canvas edges (px) */
const SAFE_PAD = 6;

/**
 * Detailed, explorable model of one beamline, built from its dossier + layout at its true position
 * on the APS floor. Everything lives in a group whose local +X is the beam direction.
 */
export class BeamlineScene {
  readonly group = new THREE.Group();
  readonly frame: SectorFrame;
  readonly placed: PlacedComponent[] = [];
  private labels = new THREE.Group();
  private tracks: PulseTrack[] = [];
  private pulseMesh: THREE.InstancedMesh | null = null;
  private pulsesDirty = false;
  private motion = new MotionClock();
  private enclosureLabels: CSS2DObject[] = [];
  private rulerLabels: CSS2DObject[] = [];
  private pinsVisible = true;
  private pinMode: 'normal' | 'tour' = 'normal';
  private pinInfo: PinInfo[] = [];
  private activeIdx = -1;
  /** the camera, canvas size and safe frame of the last pin layout (the active pin follows them every frame) */
  private pinView: { camera: THREE.Camera; width: number; height: number; frame: Rect } | null = null;
  private lengthM: number;
  private readonly noBatch = typeof location !== 'undefined' && /[?&]nobatch\b/.test(location.search);
  readonly beamY = SITE.beamHeightM;
  private prepared: Promise<void> | null = null;
  private built = false;
  private disposed = false;
  private pickables = new Set<THREE.Object3D>();
  private pickablesRegistered = true;

  constructor(
    private stage: Stage,
    readonly data: Beamline,
    readonly meta: BeamlineMeta,
    readonly layout: BeamlineLayout,
    private onPinClick: (componentId: string) => void,
    deferBuild = false,
  ) {
    this.frame = sectorFrame(meta.sectorNumber, layout.cantMrad ?? 0, layout.sourceShiftM ?? 0);
    this.group.name = `beamline-${data.id}`;
    this.group.position.copy(this.frame.source);
    this.group.quaternion.copy(this.frame.quat);
    if (layout.sideOffsetM) this.group.position.addScaledVector(this.frame.right, layout.sideOffsetM);
    // local +Z must point outboard: our basis has Z = dir × up; flip handled by sign
    // Mirror the local frame if needed so that local +Z is ALWAYS outboard (away from the ring centre).
    // Layout authors can then think in one consistent frame: +X downstream, +Y up, +Z outboard.
    const zIsOut = this.frame.right.dot(new THREE.Vector3(0, 0, 1).applyQuaternion(this.frame.quat)) >= 0;
    if (!zIsOut) this.group.scale.z = -1;
    this.outSign = 1;
    this.lengthM = Math.max(
      data.totalLengthM || 0,
      ...data.enclosures.map((e) => e.endM || 0),
      ...data.components.map((c) => c.distanceM ?? 0),
    );
    this.group.add(this.labels);
    this.group.visible = !deferBuild;
    if (!deferBuild) {
      for (const _ of this.build()) { /* Complete synchronous construction. */ }
      this.stripTransmission();
      this.built = true;
    }
    stage.scene.add(this.group);
  }

  /** Build a few components per task so input and camera animation continue during the first visit. */
  async buildAsync(signal: AbortSignal): Promise<void> {
    const job = this.build();
    for (;;) {
      signal.throwIfAborted();
      const end = performance.now() + 6;
      let done = false;
      do {
        done = !!job.next().done;
      } while (!done && performance.now() < end);
      if (done) break;
      await yieldTask();
    }
    signal.throwIfAborted();
    this.stripTransmission();
    this.built = true;
  }

  /** Hide cached models and their labels immediately. Their geometry remains available for the next visit. */
  hide(): void {
    this.group.visible = false;
    this.stage.removePickables((_, obj) => this.pickables.has(obj));
    this.pickablesRegistered = false;
    this.group.traverse((o) => {
      if (o instanceof CSS2DObject) o.element.style.display = 'none';
    });
  }

  show(): void {
    if (!this.pickablesRegistered) {
      for (const obj of this.pickables) this.stage.addPickable(obj, obj.userData.pick as Pickable);
      this.pickablesRegistered = true;
    }
    this.group.visible = true;
  }

  /**
   * Compile every shader this scene needs ahead of its first render (in parallel where the GPU driver supports
   * KHR_parallel_shader_compile). Reveal the detailed model once they are ready. The camera can move meanwhile.
   */
  prepare(): Promise<void> {
    return (this.prepared ??= this.stage.compileShaders(this.group).then(
      () => undefined,
      () => undefined,
    ));
  }

  private outSign = 1;

  /** Local position: x along beam, side (+outboard), up above beam centre. */
  at(x: number, side = 0, up = 0): THREE.Vector3 {
    return new THREE.Vector3(x, up, side * this.outSign);
  }

  sideAt(branch: string | null | undefined, x: number): number {
    return branchSide(this.layout, branch, x);
  }

  get length(): number {
    return this.lengthM;
  }

  /** World position of a local point. */
  toWorld(local: THREE.Vector3): THREE.Vector3 {
    return this.group.localToWorld(local.clone());
  }

  private ctx!: BuildCtx;
  private frameFns: ((dt: number, t: number) => void)[] = [];

  /** true when the layout registered per-frame animation (moving parts → shadows need periodic refresh) */
  get animated(): boolean {
    return this.frameFns.length > 0;
  }
  private customLabels: CSS2DObject[] = [];

  private *build(): Generator<void> {
    const ctx: BuildCtx = (this.ctx = {
      group: this.group,
      data: this.data,
      color: this.meta.color,
      beamY: this.beamY,
      at: (x, s, u) => this.at(x, s, u),
      sideAt: (b, x) => this.sideAt(b, x),
      addPickable: (obj, id) => this.addPickable(obj, id, id),
      onFrame: (fn) => {
        this.frameFns.push(fn);
      },
      addLabel: (text, local, opts = {}) => {
        const el = document.createElement('div');
        el.className = opts.bare ? `lbl ${opts.className ?? ''}` : `lbl lbl-hutch ${opts.className ?? ''}`;
        el.textContent = text;
        const lbl = new CSS2DObject(el);
        lbl.position.copy(local);
        lbl.userData.maxDist = opts.maxDist ?? 60;
        this.labels.add(lbl);
        this.customLabels.push(lbl);
        return el;
      },
      addBeam: (points, kind = 'mono', opts = {}) => {
        const color = kind === 'white' ? WHITE_BEAM : kind === 'pink' ? PINK_BEAM : kind === 'scatter' ? new THREE.Color(this.meta.color) : COLORS.xray;
        const line = fatLine(points, {
          color,
          intensity: kind === 'mono' ? 2.6 : kind === 'scatter' ? 1.6 : 1.8,
          width: opts.width ?? 2.4,
          dashed: opts.dashed,
          dashSize: 0.4,
          gapSize: 0.3,
          opacity: opts.opacity ?? 1,
        });
        this.group.add(line);
        if (opts.pulses !== false && kind !== 'scatter') this.addPulses(points, [line]);
        return line;
      },
    });
    yield* this.buildEnclosures();
    yield* this.buildComponents();
    this.buildBeams();
    yield;
    this.buildRuler();
    this.buildPeople();
    yield;
    this.layout.custom?.(ctx);
    yield;
    this.syncPulseMesh();
    // If a layout hides or detaches an engine label during construction, it controls that label afterward. The
    // distance and declutter passes below must never bring it back (e.g. HEXM's redrawn transport enclosures)
    const managed = (l: CSS2DObject) => l.visible && !!l.parent;
    this.enclosureLabels = this.enclosureLabels.filter(managed);
    this.rulerLabels = this.rulerLabels.filter(managed);
    this.customLabels = this.customLabels.filter(managed);
  }

  /**
   * Guard: a material with `transmission` makes three.js re-render every opaque object into an extra buffer each
   * frame (it roughly halves the frame rate). Draw any that slipped into a layout as plain alpha-blended glass.
   */
  private stripTransmission(): void {
    const seen = new Set<THREE.Material>();
    this.group.traverse((o) => {
      for (const m of materialsOf(o)) {
        const pm = m as THREE.MeshPhysicalMaterial;
        if (seen.has(m) || !(pm.transmission > 0)) continue;
        seen.add(m);
        if (import.meta.env.DEV) {
          let c: THREE.Object3D | null = o;
          while (c && !c.name.startsWith('comp-')) c = c.parent;
          const where = c ? `component ${c.name.slice(5)}` : `custom geometry${o.name ? ` "${o.name}"` : ''}`;
          console.warn(`[${this.data.id}] ${where}: material uses transmission (a full extra scene pass every frame); drawn as plain transparency instead`);
        }
        const t = pm.transmission;
        pm.transmission = 0;
        pm.transparent = true;
        pm.opacity = Math.min(pm.opacity, 1 - 0.45 * t);
        pm.depthWrite = false;
        pm.needsUpdate = true;
      }
    });
  }

  // ---------------------------------------------------------------- enclosures

  private *buildEnclosures(): Generator<void> {
    const defaults = this.layout.enclosureDefaults ?? {};
    for (const e of this.data.enclosures) {
      const o = this.layout.enclosure?.[e.name] ?? {};
      if (o.hidden) continue;
      const start = o.startM ?? e.startM;
      const end = o.endM ?? e.endM;
      if (!(end > start) && !o.outline) continue;
      const isTunnel = /front end|storage ring|tunnel/i.test(e.role) && start < 20;
      if (isTunnel) continue;
      const width = o.widthM ?? e.widthM ?? defaults.widthM ?? (/(foe|first optics|optics)/i.test(e.role + e.name) ? 3.4 : 4.2);
      const height = o.heightM ?? defaults.heightM ?? 3.3;
      const side = o.side ?? this.sideAt(e.branch, (start + end) / 2);
      const style = o.style ?? (TRANSPORT_RE.test(`${e.name} ${e.role}`) ? 'transport' : 'hutch');
      if (o.outline && o.outline.length > 2) this.addOutlineEnclosure(e, o.outline, height, style);
      else this.addEnclosure(e, start, end, width, height, side, style);
      yield;
    }
  }

  /** Polygonal hutch (stepped / tapered footprints) from local [x, z] points. */
  private addOutlineEnclosure(e: Enclosure, outlineIn: [number, number][], height: number, style: string): void {
    // cut-away walls need outward-facing quads: normalise to clockwise winding in local (x, z)
    let area = 0;
    for (let i = 0; i < outlineIn.length; i++) {
      const [x0, z0] = outlineIn[i];
      const [x1, z1] = outlineIn[(i + 1) % outlineIn.length];
      area += x0 * z1 - x1 * z0;
    }
    const outline = area > 0 ? [...outlineIn].reverse() : outlineIn;
    const g = new THREE.Group();
    g.name = `enclosure-${e.name}`;
    const shape = new THREE.Shape(outline.map(([x, z]) => new THREE.Vector2(x, -z)));
    const floor = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshStandardMaterial({ color: style === 'room' ? 0x1b2433 : 0x223047, roughness: 0.95 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -this.beamY + 0.035;
    floor.receiveShadow = true;
    g.add(floor);
    const h = style === 'room' ? 0.6 : style === 'ghost' ? 0.05 : height;
    const pts = [...outline, outline[0]];
    const edgePos: number[] = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, z0] = pts[i];
      const [x1, z1] = pts[i + 1];
      const len = Math.hypot(x1 - x0, z1 - z0);
      if (len < 1e-3) continue;
      if (style === 'hutch') {
        const wall = new THREE.Mesh(new THREE.PlaneGeometry(len, h), mats.hutchWall());
        wall.position.set((x0 + x1) / 2, -this.beamY + h / 2, (z0 + z1) / 2);
        wall.rotation.y = -Math.atan2(z1 - z0, x1 - x0);
        wall.renderOrder = 2;
        g.add(wall);
      }
      if (style !== 'ghost') {
        const skirt = new THREE.Mesh(new THREE.BoxGeometry(len, style === 'room' ? 0.6 : 0.5, 0.08), mats.model());
        skirt.position.set((x0 + x1) / 2, -this.beamY + (style === 'room' ? 0.3 : 0.25), (z0 + z1) / 2);
        skirt.rotation.y = -Math.atan2(z1 - z0, x1 - x0);
        skirt.castShadow = true;
        g.add(skirt);
      }
      for (const y of style === 'hutch' ? [0, h] : [0]) edgePos.push(x0, -this.beamY + y + 0.01, z0, x1, -this.beamY + y + 0.01, z1);
      if (style === 'hutch') edgePos.push(x0, -this.beamY, z0, x0, -this.beamY + h, z0);
    }
    const eg = new THREE.BufferGeometry();
    eg.setAttribute('position', new THREE.Float32BufferAttribute(edgePos, 3));
    g.add(new THREE.LineSegments(eg, style === 'ghost' ? ghostEdge : mats.hutchEdge()));
    this.group.add(g);
    const minX = Math.min(...outline.map((p) => p[0]));
    const maxZ = Math.max(...outline.map((p) => p[1]));
    this.addHutchLabel(e, this.at(minX + 0.8, maxZ - 0.4, h - this.beamY + 0.3));
  }

  private addHutchLabel(e: Enclosure, pos: THREE.Vector3): void {
    const el = document.createElement('div');
    el.className = 'lbl lbl-hutch';
    el.textContent = e.name;
    el.title = e.role;
    const lbl = new CSS2DObject(el);
    lbl.position.copy(pos);
    lbl.center.set(0, 1);
    // experiment-station hutches (from META stations, or the layout) keep their name through decluttering
    const o = this.layout.enclosure?.[e.name];
    lbl.userData.always = o?.label === 'always' || (o?.label !== 'auto' && this.stationNames().some((st) => e.name.startsWith(st)));
    if (o?.label === 'hidden') return;
    this.labels.add(lbl);
    this.enclosureLabels.push(lbl);
  }

  private stationCache: string[] | null = null;
  /** '4-ID-B, G, H' → ['4-ID-B', '4-ID-G', '4-ID-H'] */
  private stationNames(): string[] {
    if (this.stationCache) return this.stationCache;
    const raw = (this.meta as { stations?: string }).stations ?? '';
    const parts = raw.split(',').map((x) => x.trim()).filter(Boolean);
    const first = parts[0] ?? '';
    const prefix = first.replace(/[A-Z]$/, '');
    this.stationCache = parts.map((p, i) => (i === 0 || p.includes('-') ? p : prefix + p));
    return this.stationCache;
  }

  private addEnclosure(e: Enclosure, start: number, end: number, width: number, height: number, side: number, style: string): void {
    const transport = style === 'transport';
    const len = end - start;
    const g = new THREE.Group();
    g.name = `enclosure-${e.name}`;
    const c = this.at((start + end) / 2, side, -this.beamY);
    g.position.copy(c);
    // floor tint
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(len, width),
      new THREE.MeshStandardMaterial({ color: transport ? 0x1b2433 : 0x223047, roughness: 0.95 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0.035;
    floor.receiveShadow = true;
    g.add(floor);
    if (style === 'room' || style === 'ghost') {
      // support room / legacy enclosure: low outline only, never hides the beamline
      const h = style === 'room' ? 0.6 : 0.05;
      const geo = new THREE.BoxGeometry(len, h, width);
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), style === 'ghost' ? ghostEdge : mats.hutchEdge());
      edges.position.y = h / 2;
      g.add(edges);
    } else if (!transport) {
      // lead-lined walls drawn as a translucent cut-away shell: back faces only, so the near wall and the
      // roof vanish from any outside viewpoint while far walls, skirts and edges stay readable
      const wallGeo = new THREE.BoxGeometry(len, height, width);
      const shell = new THREE.Mesh(wallGeo, mats.hutchWall());
      shell.position.y = height / 2;
      shell.renderOrder = 2;
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(wallGeo), mats.hutchEdge());
      edges.position.y = height / 2;
      g.add(shell, edges);
      // solid low skirt so hutches read as rooms
      for (const s of [-1, 1]) {
        const skirt = new THREE.Mesh(new THREE.BoxGeometry(len, 0.5, 0.08), mats.model());
        skirt.position.set(0, 0.25, (s * width) / 2);
        skirt.castShadow = true;
        g.add(skirt);
      }
      for (const s of [-1, 1]) {
        const end = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.5, width), mats.model());
        end.position.set((s * len) / 2, 0.25, 0);
        g.add(end);
      }
    } else {
      // transport line: shielded pipe on stands, drawn simply
      const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, len, 16), mats.steel());
      pipe.rotation.z = Math.PI / 2;
      pipe.position.y = this.beamY;
      g.add(pipe);
    }
    this.group.add(g);
    this.addHutchLabel(e, this.at(start + 0.8, side + width / 2 - 0.4, (style === 'hutch' ? height : 0.6) - this.beamY + 0.3));
  }

  // ---------------------------------------------------------------- components

  private *buildComponents(): Generator<void> {
    let idx = 0;
    for (const c of this.data.components) {
      const o = this.layout.comp?.[c.id] ?? {};
      if (o.hidden) continue;
      const d = o.distanceM ?? c.distanceM;
      if (d === null || d === undefined || !isFinite(d)) continue;
      const branch = compBranch(c, this.layout);
      const side = o.side ?? this.sideAt(branch, d);
      const local = this.at(d, side, o.dy ?? 0);
      const isUnd = c.category === 'undulator';
      const und = isUnd ? this.data.source.insertionDevices[0] : undefined;
      const obj = o.build ? o.build(this.ctx) : buildPart(String(c.category), c.name, {
        beamY: this.beamY + (o.dy ?? 0),
        color: this.meta.color,
        deflection: c.deflection,
        specs: c.specs,
        name: c.name,
        lengthM: isUnd ? (und?.lengthM ?? 4.6) : undefined,
        periodMm: isUnd ? (und?.periodMm ?? undefined) : undefined,
        ...(o.props ?? {}),
      });
      obj.position.copy(local);
      // components downstream of a straight angled deflection stay coaxial with the deflected beam
      const bl = branch ? this.layout.branches?.[branch] : undefined;
      if (bl?.angleMrad !== undefined && d > bl.divergeAtM && o.rotY === undefined && !o.rot) obj.rotation.y = -Math.atan(bl.angleMrad / 1000);
      if (o.rotY) obj.rotation.y = o.rotY;
      if (o.rot) obj.rotation.set(o.rot[0], o.rot[1], o.rot[2]);
      if (o.scale) obj.scale.setScalar(o.scale);
      obj.name = `comp-${c.id}`;
      this.group.add(obj);
      idx += 1;
      const pin = this.makePin(c, idx);
      pin.position.copy(local).add(new THREE.Vector3(0, o.pinUp ?? pinHeight(String(c.category)), 0));
      this.labels.add(pin);
      this.placed.push({ data: c, index: idx, object: obj, local, pin, branch });
      const base = o.pinPriority ?? categoryPriority(String(c.category));
      this.pinInfo.push({
        base,
        minor: base <= 1,
        quiet: !!this.layout.quietPins?.includes(c.id),
        headline: base >= 3,
        width: 34 + Math.min(34, shortName(c.name).length) * 6.6,
        home: pin.position.clone(),
      });
      this.addPickable(obj, c.id, c.name);
      yield;
    }
  }

  private addPickable(obj: THREE.Object3D, id: string, hint: string): void {
    this.pickables.add(obj);
    if (this.pickablesRegistered) this.stage.addPickable(obj, { kind: 'component', id, hint });
  }

  private makePin(c: BeamlineComponent, idx: number): CSS2DObject {
    const anchor = document.createElement('div');
    anchor.className = 'lbl-anchor';
    const el = document.createElement('button');
    anchor.appendChild(el);
    el.className = 'lbl lbl-pin';
    el.style.setProperty('--c', this.meta.color);
    el.dataset.id = c.id;
    el.innerHTML = `<span class="pin-dot">${idx}</span><span class="pin-text"></span>`;
    (el.querySelector('.pin-text') as HTMLElement).textContent = shortName(c.name);
    el.setAttribute('aria-label', `${idx}. ${c.name}`);
    el.addEventListener('click', (ev) => {
      ev.stopPropagation();
      this.onPinClick(c.id);
    });
    const obj = new CSS2DObject(anchor);
    obj.center.set(0, 1);
    return obj;
  }

  // ---------------------------------------------------------------- beams

  private monoAt(branch: string | null): number {
    const m = this.layout.monoAtM;
    if (typeof m === 'number') return m;
    if (m && branch && m[branch] !== undefined) return m[branch];
    const firstMono = this.data.components
      .filter((c) => /monochromator|multilayerMono/.test(String(c.category)) && (c.distanceM ?? 0) > 0)
      .filter((c) => !branch || compBranch(c, this.layout) === branch || compBranch(c, this.layout) === null)
      .sort((a, b) => (a.distanceM ?? 0) - (b.distanceM ?? 0))[0];
    return firstMono?.distanceM ?? Infinity;
  }

  /** First reflecting optic upstream of the monochromator on this branch (mirror-filtered "pink" beam begins). */
  private firstMirrorAt(branch: string | null, monoX: number): number {
    const m = this.data.components
      .filter((c) => /^(mirror|kbMirror)$/.test(String(c.category)) && (c.distanceM ?? Infinity) < monoX)
      .filter((c) => !branch || compBranch(c, this.layout) === branch || compBranch(c, this.layout) === null)
      .map((c) => c.distanceM as number)
      .sort((a, b) => a - b)[0];
    return m ?? Infinity;
  }

  private buildBeams(): void {
    const branches: (string | null)[] = this.layout.branches ? Object.keys(this.layout.branches) : [null];
    if (!branches.length) branches.push(null);
    for (const b of branches) {
      // beam ends at the last component of this branch that sits on the beam
      const comps = this.placed
        .filter((p) => p.branch === b || p.branch === null || b === null)
        .filter((p) => !/detector|flightTube|spectrometer|analyzer/.test(String(p.data.category)) || true);
      const sampleLike = comps.filter((p) => /sample|diffractometer|goniometer|sampleEnvironment/.test(String(p.data.category)));
      const endOverride = typeof this.layout.beamEndM === 'number' ? this.layout.beamEndM : b && this.layout.beamEndM ? this.layout.beamEndM[b] : undefined;
      const endX = endOverride ?? Math.max(
        ...(sampleLike.length ? sampleLike.map((p) => p.local.x) : comps.map((p) => p.local.x)),
        10,
      );
      const partner = !!b && (this.layout.partnerBranches ?? []).includes(b);
      const monoX = this.monoAt(b);
      const pts: THREE.Vector3[] = [];
      const step = 1.0;
      for (let x = 0; x <= endX + 0.001; x += step) pts.push(this.at(x, this.sideAt(b, x), x > monoX ? 0.0 : 0));
      if (pts[pts.length - 1].x < endX) pts.push(this.at(endX, this.sideAt(b, endX)));
      // white beam → (first mirror) pink beam → (monochromator) monochromatic beam
      const mirrorX = this.firstMirrorAt(b, monoX);
      const seg = (a: number, z: number) => {
        const out = pts.filter((p) => p.x >= a - 1e-6 && p.x <= z + 1e-6);
        if (out.length && out[0].x > a + 1e-6) out.unshift(this.at(a, this.sideAt(b, a)));
        if (out.length && out[out.length - 1].x < z - 1e-6 && z <= endX) out.push(this.at(z, this.sideAt(b, z)));
        return out;
      };
      const whiteEnd = Math.min(mirrorX, monoX, endX);
      const pinkEnd = Math.min(monoX, endX);
      const pieces: [THREE.Vector3[], THREE.Color, number, number][] = [
        [seg(0, whiteEnd), WHITE_BEAM, 1.7, 2.6],
        [whiteEnd < pinkEnd ? seg(whiteEnd, pinkEnd) : [], PINK_BEAM, 1.9, 2.5],
        [pinkEnd < endX ? seg(pinkEnd, endX) : [], COLORS.xray, 2.6, 2.4],
      ];
      const lines: THREE.Object3D[] = [];
      for (const [arr, color, intensity, width] of pieces) {
        if (arr.length < 2) continue;
        const line = fatLine(arr, { color, intensity: partner ? intensity * 0.45 : intensity, width: partner ? width * 0.7 : width, opacity: partner ? 0.6 : 1 });
        this.group.add(line);
        lines.push(line);
      }
      if (!partner) this.addPulses(pts, lines);
    }
    // scattered / emitted radiation from sample to detector(s)
    for (const s of this.layout.scatter ?? this.autoScatter()) {
      const from = this.placed.find((p) => p.data.id === s.from);
      const to = this.placed.find((p) => p.data.id === s.to);
      if (!from || !to) continue;
      this.group.add(scatterCone(from.local, to.local, s.spread ?? 0.08, this.meta.color, s.kind ?? 'cone', s.minRadius ?? 0.05, s.opacity ?? 0.14));
    }
  }

  /** Travelling X-ray "pulses" along a local polyline (slowed enormously so the eye can follow them). */
  private addPulses(pts: THREE.Vector3[], lines: THREE.Object3D[]): void {
    if (pts.length < 2) return;
    const curve = new THREE.CurvePath<THREE.Vector3>();
    for (let i = 0; i < pts.length - 1; i++) if (pts[i].distanceTo(pts[i + 1]) > 1e-4) curve.add(new THREE.LineCurve3(pts[i], pts[i + 1]));
    if (!curve.curves.length) return;
    const length = curve.getLength();
    const n = Math.max(4, Math.round(length / 6));
    const phase = new Float32Array(n);
    for (let i = 0; i < n; i++) phase[i] = i / n;
    this.tracks.push({ curve, length, phase, speed: 9, lines });
    this.pulsesDirty = true;
  }

  /** All pulses of the scene are instances of one mesh: a single draw call however many beams there are. */
  private syncPulseMesh(): void {
    this.pulsesDirty = false;
    let total = 0;
    for (const tr of this.tracks) total += tr.phase.length;
    if (this.pulseMesh && this.pulseMesh.instanceMatrix.count >= total) {
      this.pulseMesh.count = total;
      return;
    }
    if (this.pulseMesh) {
      this.pulseMesh.removeFromParent();
      this.pulseMesh.dispose();
      this.pulseMesh = null;
    }
    if (!total) return;
    const mesh = new THREE.InstancedMesh(pulseGeo, pulseMat(), total);
    mesh.name = 'beam-pulses';
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // instances travel every frame: a precomputed bounding sphere would be stale
    mesh.frustumCulled = false;
    mesh.userData.noBatch = true;
    this.group.add(mesh);
    this.pulseMesh = mesh;
  }

  private updatePulses(dt: number): void {
    if (this.pulsesDirty) this.syncPulseMesh();
    const mesh = this.pulseMesh;
    if (!mesh) return;
    // frozen in place under prefers-reduced-motion (a static beam)
    const t = this.motion.tick(dt);
    // pulses keep a near-constant apparent size: shrink as the camera approaches, and vanish right at the lens
    // (a passing pulse would otherwise bloom over a close-up)
    const cam = this.camLocal.copy(this.stage.camera.position);
    this.group.worldToLocal(cam);
    const p = this.pulsePos;
    const m = this.pulseMatrix;
    let k = 0;
    for (const tr of this.tracks) {
      const on = !tr.lines.length || tr.lines.some((l) => visibleUnder(l, this.group));
      for (let i = 0; i < tr.phase.length; i++) {
        if (!on) {
          m.makeScale(0, 0, 0);
        } else {
          tr.curve.getPointAt((tr.phase[i] + (t * tr.speed) / tr.length) % 1, p);
          const d = p.distanceTo(cam);
          const sc = d < 0.3 ? 0 : Math.min(1, Math.max(0.08, d / 9));
          m.makeScale(sc, sc, sc).setPosition(p);
        }
        mesh.setMatrixAt(k++, m);
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
  }

  private pulsePos = new THREE.Vector3();
  private pulseMatrix = new THREE.Matrix4();

  private autoScatter(): ScatterSpec[] {
    const out: ScatterSpec[] = [];
    const samples = this.placed.filter((p) => /sample|diffractometer|goniometer|sampleEnvironment/.test(String(p.data.category)));
    const dets = this.placed.filter((p) => p.data.category === 'detector');
    for (const d of dets) {
      const s = samples
        .filter((p) => p.branch === d.branch && p.local.x < d.local.x)
        .sort((a, b) => b.local.x - a.local.x)[0];
      if (s && d.local.x - s.local.x < 25) out.push({ from: s.data.id, to: d.data.id });
    }
    return out;
  }

  /** Two people for scale: one at the first optics enclosure, one at the main experimental station. */
  private buildPeople(): void {
    const ppl = this.layout.people;
    if (ppl === false) return;
    if (Array.isArray(ppl)) {
      for (const q of ppl) {
        const p = scalePerson(0xc9d2dc, q.pose ?? 'stand');
        p.position.copy(this.at(q.x, q.side, -this.beamY));
        p.rotation.y = q.rotY ?? Math.PI;
        this.group.add(p);
      }
      return;
    }
    const ROOM = /control|vestibule|office|laborator|support|room|prep/i;
    const encs = this.data.enclosures.filter((e) => {
      const o = this.layout.enclosure?.[e.name] ?? {};
      return e.endM > e.startM && e.startM > 20 && !o.hidden && !o.outline && (o.style ?? 'hutch') === 'hutch' && !/building|corridor|transport/i.test(e.role) && !ROOM.test(e.role + ' ' + e.name);
    });
    if (!encs.length) return;
    const spots = [encs[0], encs[encs.length - 1]];
    spots.forEach((e, i) => {
      const o = this.layout.enclosure?.[e.name] ?? {};
      const width = o.widthM ?? e.widthM ?? 4;
      // stand on the outboard aisle (the inboard side of a first optics enclosure abuts the shield wall)
      const side = (o.side ?? this.sideAt(e.branch, e.startM)) + width / 2 + 0.9;
      const p = scalePerson(0xc9d2dc, i === 1 ? 'point' : 'stand');
      p.position.copy(this.at(e.startM + 1.2 + i * 0.6, side, -this.beamY));
      p.rotation.y = i === 1 ? Math.PI / 2 : Math.PI;
      this.group.add(p);
    });
  }

  private buildRuler(): void {
    const L = Math.ceil(this.lengthM / 5) * 5 + 5;
    const side = this.layout.rulerSide ?? 3.4; // outboard side, clear of the hutch walls
    const tickGeo = new THREE.BoxGeometry(0.04, 0.01, 0.5);
    const majorGeo = new THREE.BoxGeometry(0.06, 0.012, 1.0);
    const mat = new THREE.MeshBasicMaterial({ color: 0x5f7896 });
    for (let x = 0; x <= L; x += 5) {
      const major = x % 10 === 0;
      const t = new THREE.Mesh(major ? majorGeo : tickGeo, mat);
      t.position.copy(this.at(x, side, -this.beamY + 0.04));
      this.group.add(t);
      if (major) {
        const el = document.createElement('div');
        el.className = 'lbl lbl-dist';
        el.textContent = `${x} m`;
        const lbl = new CSS2DObject(el);
        lbl.position.copy(this.at(x, side + 0.9, -this.beamY + 0.05));
        this.labels.add(lbl);
        this.rulerLabels.push(lbl);
      }
    }
    const rail = new THREE.Mesh(new THREE.BoxGeometry(L, 0.008, 0.04), mat);
    rail.position.copy(this.at(L / 2, side, -this.beamY + 0.04));
    this.group.add(rail);
  }

  // ---------------------------------------------------------------- interaction

  setActive(id: string | null): void {
    if (this.activeIdx >= 0) this.resetPin(this.activeIdx);
    this.activeIdx = id ? this.placed.findIndex((q) => q.data.id === id) : -1;
    for (const p of this.placed) pinEl(p).classList.toggle('is-active', p.data.id === id);
    if (this.activeIdx >= 0 && this.pinsVisible) {
      showLabel(this.placed[this.activeIdx].pin, true, pinEl(this.placed[this.activeIdx]));
      this.placeActivePin();
    }
  }

  setPinsVisible(v: boolean): void {
    this.pinsVisible = v;
    if (!v && this.activeIdx >= 0) this.resetPin(this.activeIdx);
    for (const p of this.placed) showLabel(p.pin, v, pinEl(p));
  }

  /**
   * "tour": the guided tour has no component list beside the model, so only headline pins show (layout pinPriority ≥ 3
   * or a headline category), always compact and still decluttered. "normal": the full explorable set.
   */
  setPinMode(mode: 'normal' | 'tour'): void {
    this.pinMode = mode;
  }

  /**
   * Screen-space decluttering: project pins, then greedily keep the highest-priority ones that do not overlap.
   * Minor plumbing (masks, collimators, slits…) only shows when the camera is close. `safe` gives the pixels covered
   * by UI chrome on each side (top bar and crumbs, side panel, path strip): no pin is left underneath, and the selected
   * component's pin is kept inside the visible frame (with a leader line to the component when it has to move).
   */
  updatePinDensity(camera: THREE.Camera, width: number, height: number, safe?: Partial<SafeInsets>): void {
    if (!this.built || this.disposed) return;
    // without explicit insets, keep clear of whatever the stage currently reserves for UI chrome
    const frame = safeRect(width, height, safe ?? stageInsets(this.stage));
    frame.x0 += SAFE_PAD;
    frame.x1 -= SAFE_PAD;
    frame.y0 += SAFE_PAD;
    frame.y1 -= SAFE_PAD;
    this.pinView = { camera, width, height, frame };
    if (!this.pinsVisible) return;
    const camLocal = this.group.worldToLocal(camera.getWorldPosition(this.camPins));
    const tour = this.pinMode === 'tour';
    const order = this.pinOrder;
    order.length = this.placed.length;
    for (let i = 0; i < this.placed.length; i++) {
      const p = this.placed[i];
      const info = this.pinInfo[i];
      const dist = camLocal.distanceTo(p.local);
      const slot = (order[i] ??= { i: 0, dist: 0, pri: 0 });
      slot.i = i;
      slot.dist = dist;
      slot.pri = (i === this.activeIdx ? 100 : 0) + info.base - dist * 0.02 + (info.quiet ? -5 : 0);
    }
    order.sort((a, b) => b.pri - a.pri);
    const kept = this.keptRects;
    kept.length = 0;
    const active = this.activeIdx >= 0 ? this.placed[this.activeIdx] : undefined;
    const v = this.scratch;
    for (const { i, dist, pri } of order) {
      const p = this.placed[i];
      const info = this.pinInfo[i];
      const el = pinEl(p);
      if (i === this.activeIdx) {
        kept.push(this.placeActivePin() ?? { x0: 0, x1: 0, y0: 0, y1: 0 });
        showLabel(p.pin, true, el);
        el.classList.remove('is-compact');
        continue;
      }
      const hiddenByRule = tour
        ? !info.headline
        : (info.minor && dist > 14) || (info.quiet && dist > 10) || (!!active && p.local.distanceTo(active.local) > 6);
      if (hiddenByRule) {
        showLabel(p.pin, false, el);
        continue;
      }
      v.copy(p.pin.position);
      this.group.localToWorld(v);
      v.project(camera);
      if (v.z > 1) {
        showLabel(p.pin, false, el);
        continue;
      }
      const sx = (v.x * 0.5 + 0.5) * width;
      const sy = (-v.y * 0.5 + 0.5) * height;
      const compact = tour || dist > 26;
      const r = pinRect(sx, sy, compact ? COMPACT_W : info.width);
      // never under UI chrome or across the canvas edge; lower-priority pins give way
      if (!inside(r, frame) || (pri < 50 && kept.some((k) => overlaps(r, k)))) {
        showLabel(p.pin, false, el);
        continue;
      }
      kept.push(r);
      showLabel(p.pin, true, el);
      el.classList.toggle('is-compact', compact);
    }
    // hutch names and ruler marks give way to pins and never sit under UI chrome; layout captions only avoid the chrome
    const far = camLocal.distanceTo(this.at(this.lengthM / 2)) > 160;
    // station hutch names first (they only need to be on screen), then the other labels avoid them and the pins
    for (const l of this.enclosureLabels) if (l.userData.always) showLabel(l, !far && this.labelFits(l, camera, width, height, frame, null, kept));
    for (const l of this.enclosureLabels) if (!l.userData.always) showLabel(l, !far && this.labelFits(l, camera, width, height, frame, kept));
    for (const l of this.rulerLabels) showLabel(l, !far && this.labelFits(l, camera, width, height, frame, kept));
    for (const l of this.customLabels) {
      showLabel(l, camLocal.distanceTo(l.position) <= (l.userData.maxDist as number) && this.labelFits(l, camera, width, height, frame, null));
    }
  }

  /**
   * Whether a plain engine label can show: its anchor projects inside the safe frame and, when `kept` is given, its
   * estimated box lies inside the frame too and overlaps none of the rectangles already kept (it is then added to them).
   */
  private labelFits(l: CSS2DObject, camera: THREE.Camera, width: number, height: number, frame: Rect, kept: Rect[] | null, record?: Rect[]): boolean {
    const v = this.scratch;
    v.copy(l.position);
    this.group.localToWorld(v);
    v.project(camera);
    if (v.z > 1) return false;
    const sx = (v.x * 0.5 + 0.5) * width;
    const sy = (-v.y * 0.5 + 0.5) * height;
    if (sx < frame.x0 || sx > frame.x1 || sy < frame.y0 || sy > frame.y1) return false;
    if (!kept) {
      if (record) {
        const w = (l.userData.estW as number | undefined) ?? (l.userData.estW = 12 + (l.element.textContent?.length ?? 8) * 7.1);
        record.push({ x0: sx - l.center.x * w, x1: sx - l.center.x * w + w, y0: sy - l.center.y * 16, y1: sy - l.center.y * 16 + 16 });
      }
      return true;
    }
    // 11 px monospace text with padding (hutch names, distances), placed by the label's CSS2D centre
    const w = (l.userData.estW as number | undefined) ?? (l.userData.estW = 12 + (l.element.textContent?.length ?? 8) * 7.1);
    const h = 16;
    const x0 = sx - l.center.x * w;
    const y0 = sy - l.center.y * h;
    const r: Rect = { x0, x1: x0 + w, y0, y1: y0 + h };
    if (!inside(r, frame) || kept.some((k) => overlaps(r, k))) return false;
    kept.push(r);
    return true;
  }

  private pinOrder: { i: number; dist: number; pri: number }[] = [];
  private keptRects: Rect[] = [];
  private camPins = new THREE.Vector3();
  private scratch = new THREE.Vector3();
  private scratch2 = new THREE.Vector3();

  /**
   * Keep the selected component's pin readable in close-ups, where its usual anchor (a fixed height above the
   * component) often projects above the screen or under the top bar. Tries, in order: the usual anchor, the top of
   * the component's bounding box, then the nearest in-frame position with a leader line down to the component.
   * Returns the pin's screen rectangle, or null when the component itself is out of view.
   */
  private placeActivePin(): Rect | null {
    const view = this.pinView;
    if (!view || this.activeIdx < 0) return null;
    const i = this.activeIdx;
    const p = this.placed[i];
    const info = this.pinInfo[i];
    const { camera, width, height, frame } = view;
    const w = info.width;
    const v = this.scratch;
    const toScreen = (local: THREE.Vector3): boolean => {
      v.copy(local);
      this.group.localToWorld(v);
      v.project(camera);
      return v.z <= 1;
    };
    const sx = () => (v.x * 0.5 + 0.5) * width;
    const sy = () => (-v.y * 0.5 + 0.5) * height;
    // 1. the usual anchor
    if (toScreen(info.home)) {
      const r = pinRect(sx(), sy(), w);
      if (inside(r, frame)) {
        this.setPinAnchor(i, info.home, null);
        return r;
      }
    }
    const homeOk = v.z <= 1;
    const hx = sx();
    const hy = sy();
    // 2. just above the component's own top
    const top = this.componentTop(i);
    const topLocal = this.scratch2;
    if (top !== null && top + 0.06 < info.home.y) {
      topLocal.set(p.local.x, top + 0.06, p.local.z);
      if (toScreen(topLocal)) {
        const r = pinRect(sx(), sy(), w);
        if (inside(r, frame)) {
          this.setPinAnchor(i, topLocal, null);
          return r;
        }
      }
    }
    // 3. clamp into the frame, with a leader to the component (only while the component itself is in view)
    if (!toScreen(p.local)) {
      this.setPinAnchor(i, info.home, null);
      return null;
    }
    const cx = sx();
    const cy = sy();
    const cz = v.z;
    if (cx < frame.x0 || cx > frame.x1 || cy < frame.y0 || cy > frame.y1) {
      this.setPinAnchor(i, info.home, null);
      return null;
    }
    // desired anchor: where the usual anchor is (or straight above the component), pulled into the frame
    const clampX = (x: number) => THREE.MathUtils.clamp(x, frame.x0 - PIN_BOX.left, Math.max(frame.x0 - PIN_BOX.left, frame.x1 - PIN_BOX.left - w));
    const clampY = (y: number) => THREE.MathUtils.clamp(y, frame.y0 - PIN_BOX.top, Math.max(frame.y0 - PIN_BOX.top, frame.y1 - PIN_BOX.bottom));
    const ax = clampX(homeOk ? hx : cx);
    let ay = clampY(homeOk ? hy : cy - 60);
    // never cover the component itself: sit just above it, or just below when there is no room above
    const r = pinRect(ax, ay, w);
    if (cx > r.x0 - 4 && cx < r.x1 + 4 && cy > r.y0 - 4 && cy < r.y1 + 4) {
      const above = cy - 10 - PIN_BOX.bottom;
      const below = cy + 10 - PIN_BOX.top;
      ay = clampY(above + PIN_BOX.top >= frame.y0 ? above : below);
    }
    // back to a 3D point at the component's depth, so the pin stays put between layout passes
    v.set((ax / width) * 2 - 1, -(ay / height) * 2 + 1, cz).unproject(camera);
    this.group.worldToLocal(v);
    this.setPinAnchor(i, v, { dx: cx - ax, dy: cy - ay });
    return pinRect(ax, ay, w);
  }

  /** Move pin i to a local anchor and show/hide its leader (dx, dy: screen offset from the anchor to the component). */
  private setPinAnchor(i: number, local: THREE.Vector3, leader: { dx: number; dy: number } | null): void {
    const p = this.placed[i];
    const info = this.pinInfo[i];
    if (!p.pin.position.equals(local)) {
      p.pin.position.copy(local);
      touchLabels();
    }
    const len = leader ? Math.hypot(leader.dx, leader.dy) : 0;
    if (!leader || len < 16) {
      if (info.leader) info.leader.style.display = 'none';
      return;
    }
    let el = info.leader;
    if (!el) {
      el = info.leader = document.createElement('div');
      el.className = 'lbl-leader';
      el.setAttribute('aria-hidden', 'true');
      el.style.cssText =
        'position:absolute;left:0;top:100%;height:1.5px;transform-origin:0 50%;pointer-events:none;' +
        `background:linear-gradient(90deg, ${this.meta.color}, ${this.meta.color}99);border-radius:1px;`;
      const dot = document.createElement('div');
      dot.style.cssText = `position:absolute;right:-3px;top:-2.25px;width:6px;height:6px;border-radius:50%;background:${this.meta.color};box-shadow:0 0 6px ${this.meta.color};`;
      el.appendChild(dot);
      p.pin.element.appendChild(el);
    }
    // starts at the pin's dot (just above its anchor) and ends on the component
    const x0 = 2;
    const y0 = -10;
    const dx = leader.dx - x0;
    const dy = leader.dy - y0;
    el.style.display = '';
    el.style.width = `${Math.hypot(dx, dy).toFixed(1)}px`;
    el.style.transform = `translate(${x0}px, ${y0}px) rotate(${Math.atan2(dy, dx).toFixed(4)}rad)`;
  }

  private resetPin(i: number): void {
    this.setPinAnchor(i, this.pinInfo[i].home, null);
  }

  /** Local height of the top of component i (its meshes' bounding box in the beamline frame), measured once. */
  private componentTop(i: number): number | null {
    const info = this.pinInfo[i];
    if (info.top !== undefined) return info.top;
    const obj = this.placed[i].object;
    this.group.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(this.group.matrixWorld).invert();
    const m = new THREE.Matrix4();
    const box = new THREE.Box3();
    const b = new THREE.Box3();
    obj.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || !mesh.geometry || (mesh.material as THREE.Material)?.visible === false) return;
      const g = mesh.geometry as THREE.BufferGeometry;
      if (!g.boundingBox) g.computeBoundingBox();
      if (!g.boundingBox) return;
      box.union(b.copy(g.boundingBox).applyMatrix4(m.multiplyMatrices(inv, mesh.matrixWorld)));
    });
    info.top = box.isEmpty() ? null : box.max.y;
    return info.top;
  }

  componentWorld(id: string): THREE.Vector3 | null {
    const p = this.placed.find((q) => q.data.id === id);
    return p ? this.toWorld(p.local) : null;
  }

  /** Camera position/target framing the whole beamline from the outboard side (fits the visible width). */
  overviewShot(aspect = 1.6, visibleFrac = 0.65, fovDeg = 42): { pos: THREE.Vector3; target: THREE.Vector3 } {
    const cam = this.layout.camera ?? {};
    const L = Math.max(30, this.lengthM);
    const along = cam.along ?? 0.56;
    const target = this.toWorld(this.at(L * along, 0, -this.beamY));
    const vfov = THREE.MathUtils.degToRad(fovDeg);
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * aspect * visibleFrac);
    const D = ((L * 0.5) / Math.tan(hfov / 2)) * 0.82 * (cam.distanceScale ?? 1);
    const el = THREE.MathUtils.degToRad(cam.up ? cam.up * 90 : 47);
    const side = cam.side ?? -1;
    const pos = this.toWorld(this.at(L * along - D * 0.12, side * D * Math.cos(el), D * Math.sin(el) - this.beamY));
    return { pos, target };
  }

  /** Camera framing for one component. */
  componentShot(id: string): { pos: THREE.Vector3; target: THREE.Vector3 } | null {
    const p = this.placed.find((q) => q.data.id === id);
    if (!p) return null;
    const cat = String(p.data.category);
    const shot = this.layout.comp?.[id]?.shot ?? {};
    const r = shot.r ?? (cat === 'undulator' ? 5.5 : /detector|flightTube|diffractometer|monochromator|spectrometer/.test(cat) ? 3.4 : /zonePlate|mll|wire|codedAperture|beamStop/.test(cat) ? 0.9 : /sample/.test(cat) ? 1.3 : 2.6);
    const t = p.local.clone();
    if (shot.target) t.add(new THREE.Vector3(...shot.target));
    // inside the shield tunnel the ring magnets line the inboard side, so look from the outboard side there
    const inTunnel = p.local.x < (this.layout.ratchetFaceM ?? SITE.ratchetFaceM ?? 23.8);
    // straight-section devices (x < 3 m) read best from inboard and above; the rest of the tunnel from outboard
    const inStraight = p.local.x < 3;
    // between the ratchet face and ~55 m the downstream sector's tunnel wall runs a few metres inboard of the beam,
    // so default close-ups there look from the outboard aisle too; further out the infield side is open
    const nearTunnel = p.local.x < 55;
    const dir = new THREE.Vector3(...(shot.dir ?? (inStraight ? [-0.55, 0.75, -0.9] : inTunnel || nearTunnel ? [-0.7, 0.6, 0.95] : [-0.7, 0.6, -0.95]))).normalize();
    const target = this.toWorld(t);
    const pos = this.toWorld(t.clone().addScaledVector(dir, r * 1.35));
    return { pos, target };
  }

  private bornAt = -1;
  private snap: MatrixSnapshot | null = null;
  private snapJob: Generator<void, MatrixSnapshot> | null = null;
  private batchJob: Generator<void, BatchStats> | null = null;
  private batched = false;
  private camStill = 0;
  private lastCam = new THREE.Matrix4();
  private lastProj = new THREE.Matrix4();
  /** stats for debugging/perf tests (set once static batching has finished) */
  batchStats: BatchStats | null = null;
  /** called once static batching has replaced the original meshes (e.g. to refresh a cached shadow map) */
  onBatched: (() => void) | null = null;

  update(dt: number): void {
    if (!this.built || this.disposed) return;
    const t = this.stage.time;
    for (const fn of this.frameFns) fn(dt, t);
    if (!this.batched && !this.noBatch) this.stepBatching(t, dt);
    this.updatePulses(dt);
    // the selected component's pin follows the camera every frame (the full pin layout runs every few frames)
    if (this.activeIdx >= 0 && this.pinsVisible && this.pinView) this.placeActivePin();
  }

  /**
   * Record each mesh's pose shortly after opening. Once the camera stops moving, or after 8 s, merge meshes
   * whose poses have not changed. Process a few milliseconds of work per frame. Replace the original meshes
   * in one step after the merge completes, so the scene does not show partial results.
   */
  private stepBatching(t: number, dt: number): void {
    if (this.bornAt < 0) this.bornAt = t;
    const age = t - this.bornAt;
    const cam = this.stage.camera;
    const still = this.lastCam.equals(cam.matrixWorld) && this.lastProj.equals(cam.projectionMatrix);
    this.camStill = still ? this.camStill + dt : 0;
    this.lastCam.copy(cam.matrixWorld);
    this.lastProj.copy(cam.projectionMatrix);
    if (age < 0.25) return;
    const settled = this.camStill > 0.3 || age > 8;
    try {
      if (!this.snap) {
        this.snapJob ??= snapshotJob(this.group);
        const r = runSlice(this.snapJob, BATCH_SLICE_MS);
        if (r) {
          this.snap = r;
          this.snapJob = null;
        }
        return;
      }
      if (age < 1.3 || !settled) return;
      this.batchJob ??= batchStaticJob(this.group, this.snap);
      const r = runSlice(this.batchJob, BATCH_SLICE_MS);
      if (r) this.finishBatching(r);
    } catch (e) {
      console.warn('static batching skipped', e);
      this.finishBatching(null);
    }
  }

  private finishBatching(stats: BatchStats | null): void {
    this.batched = true;
    this.batchJob = null;
    this.snapJob = null;
    this.snap = null;
    this.batchStats = stats ?? { merged: 0, batches: 0 };
    if (stats?.batches) this.onBatched?.();
  }

  private camLocal = new THREE.Vector3();

  dispose(retained: Iterable<BeamlineScene> = []): void {
    if (this.disposed) return;
    this.disposed = true;
    this.batchJob = null;
    this.snapJob = null;
    this.stage.removePickables((_, obj) => this.pickables.has(obj));
    this.pickables.clear();
    // Layout modules may share geometry and materials between cached models. Free them after the last owner leaves.
    const keptGeos = new Set<THREE.BufferGeometry>();
    const keptMaterials = new Set<THREE.Material>();
    const keptTextures = new Set<THREE.Texture>();
    for (const scene of retained) {
      if (scene === this) continue;
      scene.group.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) keptGeos.add(m.geometry);
        for (const mat of materialsOf(o)) {
          keptMaterials.add(mat);
          for (const tex of texturesOf(mat)) keptTextures.add(tex);
        }
      });
    }
    // Free GPU resources created by this scene, geometries, materials and their textures (palette / engine singletons that
    // the site shares are kept; module-cached beamline resources simply re-upload on a later visit)
    const geos = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) geos.add(m.geometry as THREE.BufferGeometry);
      for (const mat of materialsOf(o)) materials.add(mat);
      if ((o as THREE.InstancedMesh).isInstancedMesh) (o as THREE.InstancedMesh).dispose();
    });
    for (const g of geos) if (!keptGeos.has(g)) g.dispose();
    releaseLines(this.group);
    const textures = new Set<THREE.Texture>();
    for (const mat of materials) {
      if (isShared(mat) || keptMaterials.has(mat)) continue;
      for (const tex of texturesOf(mat)) if (!isShared(tex)) textures.add(tex);
      mat.dispose();
    }
    for (const tex of textures) if (!keptTextures.has(tex)) tex.dispose();
    // remove every DOM label in the tree (including ones layouts added directly to ctx.group)
    this.group.traverse((o) => {
      if (o instanceof CSS2DObject) {
        hideLabelNow(o);
        o.element.remove();
      }
    });
    this.frameFns = [];
    this.tracks = [];
    this.pulseMesh = null;
    this.pinView = null;
    this.group.removeFromParent();
  }
}

/** Yield to pending input and rendering between construction tasks. */
function yieldTask(): Promise<void> {
  const scheduler = (globalThis as unknown as { scheduler?: { yield(): Promise<void> } }).scheduler;
  return scheduler?.yield ? scheduler.yield() : new Promise((resolve) => setTimeout(resolve, 0));
}

/** Time budget per frame for the static-batching work (ms). */
const BATCH_SLICE_MS = 5;

/** Advance a sliced job until it finishes or the time budget is spent; returns its result once finished. */
function runSlice<T>(job: Generator<void, T>, budgetMs: number): T | null {
  const end = performance.now() + budgetMs;
  for (;;) {
    const r = job.next();
    if (r.done) return r.value;
    if (performance.now() >= end) return null;
  }
}

/** Every texture a material references (map slots and shader uniforms). */
function texturesOf(mat: THREE.Material): THREE.Texture[] {
  const out: THREE.Texture[] = [];
  for (const v of Object.values(mat)) if ((v as THREE.Texture | null)?.isTexture) out.push(v as THREE.Texture);
  const uniforms = (mat as THREE.ShaderMaterial).uniforms;
  if (uniforms) for (const u of Object.values(uniforms)) if ((u?.value as THREE.Texture | null)?.isTexture) out.push(u.value as THREE.Texture);
  return out;
}

/** 3 = headline component, 2 = notable, 1 = plumbing. */
function categoryPriority(cat: string): number {
  if (/undulator|monochromator|multilayerMono|kbMirror|zonePlate|mll|diffractometer|detector|sample|spectrometer|phaseRetarder|crl|transfocator|mirror|wire|codedAperture/.test(cat)) {
    return /undulator|diffractometer|sample|detector|kbMirror|monochromator/.test(cat) ? 3 : 2.5;
  }
  if (/sampleEnvironment|flightTube|analyzer|frontEnd|polarizationAnalyzer/.test(cat)) return 2;
  return 1;
}

/** Screen rectangle of a pin whose anchor projects to (sx, sy). */
function pinRect(sx: number, sy: number, w: number): Rect {
  return { x0: sx + PIN_BOX.left, x1: sx + PIN_BOX.left + w, y0: sy + PIN_BOX.top, y1: sy + PIN_BOX.bottom };
}

function materialsOf(o: THREE.Object3D): THREE.Material[] {
  const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
  return !m ? [] : Array.isArray(m) ? m : [m];
}

/** visible, and every ancestor up to (not including) root visible */
function visibleUnder(o: THREE.Object3D, root: THREE.Object3D): boolean {
  for (let c: THREE.Object3D | null = o; c && c !== root; c = c.parent) if (!c.visible) return false;
  return true;
}

function pinEl(p: PlacedComponent): HTMLElement {
  return p.pin.element.firstElementChild as HTMLElement;
}

function pinHeight(cat: string): number {
  if (cat === 'undulator') return 1.0;
  if (/monochromator|diffractometer|spectrometer/.test(cat)) return 0.95;
  if (/detector|flightTube/.test(cat)) return 0.7;
  if (/zonePlate|mll|wire|codedAperture|beamStop|sample/.test(cat)) return 0.25;
  return 0.6;
}

function shortName(n: string): string {
  const s = n.replace(/\s*\(.*?\)\s*/g, ' ').trim();
  return s.length > 34 ? s.slice(0, 32) + '…' : s;
}

function scatterCone(from: THREE.Vector3, to: THREE.Vector3, spread: number, color: string, kind: string, minRadius: number, opacity: number): THREE.Object3D {
  const dir = to.clone().sub(from);
  const len = dir.length();
  const r = Math.max(minRadius, Math.tan(spread) * len);
  const geo = new THREE.ConeGeometry(r, len, 32, 1, true);
  geo.translate(0, -len / 2, 0);
  geo.rotateX(Math.PI);
  const mat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(kind === 'fluorescence' ? '#ffcf6b' : color).multiplyScalar(1.6),
    transparent: true,
    opacity,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
    blending: THREE.AdditiveBlending,
  });
  const cone = new THREE.Mesh(geo, mat);
  cone.position.copy(from);
  cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  return cone;
}

const pulseGeo = new THREE.SphereGeometry(0.035, 10, 8);
const TRANSPORT_RE = /transport|corridor|\bpipe\b/i;
let pulseMatCache: THREE.Material | null = null;
function pulseMat(): THREE.Material {
  return (pulseMatCache ??= markShared(glowMaterial(COLORS.xray, 7)));
}

const ghostEdge = markShared(new THREE.LineBasicMaterial({ color: 0x8796a8, transparent: true, opacity: 0.35 }));
