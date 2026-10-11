import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import type { Line2 } from 'three/addons/lines/Line2.js';
import type { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import type { Stage } from '../Stage';
import { SITE, sectorFrame, alongBeam, toWorld, sectorAngle } from '../../data/site';
import { FEATURE_META } from '../../data/meta';
import { COLORS, glowMaterial, groundMaterial, mats, setFaded } from '../palette';
import { fatLine, circlePoints, fatSegments, type FatSegments } from '../lines';
import { SECTOR_INFO, enhancedSectors } from '../../data/sectors';
import { buildLattice } from './lattice';
import { undulator } from '../beamline/parts';
import { buildTrees } from './trees';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Beamline, BeamlineMeta } from '../../data/types';
import { branchSide, type BeamlineLayout } from '../beamline/layout';
import { showLabel, labelShown, touchLabels, overlaps, safeRect, inside, stageInsets, type Rect, type SafeInsets } from '../beamline/labels';
import { MotionClock, motionReduced } from '../beamline/motion';

const BEAM_Y = SITE.beamHeightM;
const genericEdgeMat = new THREE.LineBasicMaterial({ color: 0x8796a8, transparent: true, opacity: 0.35 });
// overview footprints of feature beamlines (faded when another beamline is in focus)
const overviewHutchMat = new THREE.MeshStandardMaterial({ color: 0xd6d2c9, roughness: 0.92, metalness: 0 });
const overviewRoomMat = new THREE.MeshStandardMaterial({ color: 0x5d6673, roughness: 0.95, metalness: 0 });
export const USER_SECTORS = 35;

/**
 * Overview label priorities for screen-space decluttering (feature pins always win). A label that would overlap a
 * pin or a higher-priority label, or sit under UI chrome, is hidden until the view changes.
 */
const PRI = { injectorTour: 9, landmark: 5, sector: 4, building: 3, machineSector: 2.5, caption: 2, lom: 1 } as const;

/** Default hutch train for sectors without detailed models (schematic, labelled as such in the UI). */
const GENERIC_HUTCHES: [number, number][] = [
  [27, 36],
  [37.5, 47],
  [48.5, 58],
  [59.5, 68],
];

export class Site {
  readonly group = new THREE.Group();
  private ringGroup = new THREE.Group();
  private beamlineGroup = new THREE.Group();
  private hutchGroup = new THREE.Group();
  private labelGroup = new THREE.Group();
  private bunches: THREE.Points;
  private bunchPhase: Float32Array;
  private sectorStrips = new Map<number, THREE.Mesh>();
  private featureLabels = new Map<string, CSS2DObject>();
  private sectorLabels: CSS2DObject[] = [];
  private placeLabels: CSS2DObject[] = [];
  private labelPri = new Map<CSS2DObject, number>();
  /** alternative anchors for a place label, tried in order when the current one collides */
  private labelSpots = new Map<CSS2DObject, THREE.Vector3[]>();
  private injectorLabels = new Set<CSS2DObject>();
  /** label groups the current mode allows (a focused beamline hides them all; the tour can hide the pins) */
  private placesAllowed = true;
  private pinsAllowed = true;
  private sectorsZoomedIn = false;
  private injectorTour = false;
  /** sector whose placeholder ID box is replaced by the tour's detailed undulator / by a focused beamline */
  private tourUndSector: number | null = null;
  private focusSector: number | null = null;
  private motion = new MotionClock();
  private bunchesPlaced = false;
  private focusId: string | null = null;
  private hiddenHutches = new Set<number>();
  private hutchMeshes = new Map<number, THREE.Object3D[]>();
  private featureObjs = new Map<string, { group: THREE.Group; lines: Line2[]; color: THREE.Color; sector: number }>();

  constructor(private stage: Stage) {
    this.group.name = 'site';
    this.group.add(this.ringGroup, this.beamlineGroup, this.hutchGroup, this.labelGroup);
    this.buildGround();
    this.group.add(buildTrees());
    this.buildHall();
    this.buildTunnelAndRing();
    this.buildBuildings();
    this.buildInjector();
    this.buildBeamlines();
    this.buildEnhancedMarkers();
    const b = this.buildBunches();
    this.bunches = b.points;
    this.bunchPhase = b.phase;
    this.buildLabels();
    stage.scene.add(this.group);
  }

  // ---------------------------------------------------------------- construction

  private buildGround(): void {
    const ground = new THREE.Mesh(new THREE.CircleGeometry(2200, 96), groundMaterial());
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.05;
    ground.receiveShadow = true;
    ground.name = 'ground';
    this.group.add(ground);
  }

  private buildHall(): void {
    // Experiment-hall floor: annulus between the shielding tunnel and the outer wall.
    const floor = new THREE.Mesh(new THREE.RingGeometry(SITE.orbitRadiusM + 1.6, SITE.hallOuterM, 400, 1), mats.hallFloor());
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0.02;
    floor.receiveShadow = true;
    this.group.add(floor);

    // Low cut-away outer wall (architectural model convention: roof removed, walls cut at ~4 m).
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(SITE.hallOuterM + 0.4, SITE.hallOuterM + 0.4, 4, 400, 1, true), fadeMat(mats.model()));
    wall.position.y = 2;
    wall.castShadow = true;
    wall.receiveShadow = true;
    this.group.add(wall);
    this.fadeables.push(wall);
    const cap = new THREE.Mesh(new THREE.RingGeometry(SITE.hallOuterM, SITE.hallOuterM + 0.8, 400, 1), fadeMat(mats.model()));
    this.fadeables.push(cap);
    cap.rotation.x = -Math.PI / 2;
    cap.position.y = 4;
    this.group.add(cap);
  }

  private buildTunnelAndRing(): void {
    const H = 3.4;
    const t = 0.9;
    // inner (infield) shield wall
    {
      const r = SITE.tunnelInnerM;
      const wall = new THREE.Mesh(new THREE.CylinderGeometry(r - t / 2, r - t / 2, H, 400, 1, true), fadeMat(mats.concrete()));
      wall.position.y = H / 2;
      wall.castShadow = true;
      wall.receiveShadow = true;
      this.ringGroup.add(wall);
      this.fadeables.push(wall);
      const top = new THREE.Mesh(new THREE.RingGeometry(r - t, r, 400, 1), fadeMat(mats.concrete()));
      top.rotation.x = -Math.PI / 2;
      top.position.y = H;
      this.ringGroup.add(top);
      this.fadeables.push(top);
    }
    // outer "ratchet" shield wall: one tooth per sector so every front end exits through a face ~24 m
    // downstream of its source, where the first optics enclosure begins (per-sector faces come from layouts).
    this.buildRatchet(new Map());
    const tunnelFloor = new THREE.Mesh(new THREE.RingGeometry(SITE.tunnelInnerM, SITE.orbitRadiusM + 2.2, 400, 1), mats.granite());
    tunnelFloor.rotation.x = -Math.PI / 2;
    tunnelFloor.position.y = 0.03;
    tunnelFloor.receiveShadow = true;
    this.ringGroup.add(tunnelFloor);

    // The multi-bend-achromat magnet lattice, instanced around all 40 sectors.
    this.ringGroup.add(buildLattice());

    // Electron orbit
    const orbit = fatLine(circlePoints(0, 0, SITE.orbitDrawRadiusM ?? SITE.orbitRadiusM, BEAM_Y, 720), { color: COLORS.electron, intensity: 3.2, width: 2.2 });
    orbit.name = 'electron-orbit';
    this.ringGroup.add(orbit);
  }

  private ratchet: THREE.Mesh | null = null;

  /** (Re)build the ratchet wall; `faces` maps sector → documented front-end exit distance (m from source). */
  buildRatchet(faces: Map<number, number>): void {
    const H = 3.4;
    const t = 0.9;
    const pts: THREE.Vector3[] = [];
    for (let n = 1; n <= SITE.sectors; n++) {
      const f = sectorFrame(n);
      const face = faces.get(n) ?? SITE.ratchetFaceM ?? 23.8;
      pts.push(alongBeam(f, -3.4, 1.35, -SITE.beamHeightM), alongBeam(f, face - t / 2, 1.35, -SITE.beamHeightM), alongBeam(f, face - t / 2, -0.85, -SITE.beamHeightM));
    }
    pts.push(pts[0].clone());
    const segs: THREE.BufferGeometry[] = [];
    const tmp = new THREE.Object3D();
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const len = a.distanceTo(b);
      if (len < 0.05) continue;
      tmp.position.copy(a).lerp(b, 0.5).setY(H / 2);
      tmp.rotation.set(0, -Math.atan2(b.z - a.z, b.x - a.x), 0);
      tmp.updateMatrix();
      segs.push(new THREE.BoxGeometry(len + t * 0.9, H, t).applyMatrix4(tmp.matrix));
    }
    const mat = this.ratchet ? (this.ratchet.material as THREE.Material) : fadeMat(mats.concrete());
    if (this.ratchet) {
      this.ratchet.geometry.dispose();
      this.ratchet.removeFromParent();
      this.fadeables = this.fadeables.filter((m) => m !== this.ratchet);
    }
    const ratchet = new THREE.Mesh(mergeGeometries(segs), mat);
    ratchet.castShadow = true;
    ratchet.receiveShadow = true;
    ratchet.name = 'ratchet-wall';
    this.ringGroup.add(ratchet);
    this.fadeables.push(ratchet);
    this.ratchet = ratchet;
  }

  private buildBuildings(): void {
    for (const b of SITE.buildings) {
      if (b.polygon.length < 3) continue;
      const shape = new THREE.Shape(b.polygon.map(([x, y]) => new THREE.Vector2(x, y)));
      const geo = new THREE.ExtrudeGeometry(shape, { depth: b.heightM, bevelEnabled: false });
      geo.rotateX(-Math.PI / 2);
      const mesh = new THREE.Mesh(geo, b.role === 'long-beamline-building' ? mats.model() : mats.modelShade());
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.name = b.id;
      mesh.userData.building = b;
      if (b.role !== 'neighbour' || b.id === '440') this.stage.addPickable(mesh, { kind: 'building', id: b.id, hint: b.fullName ?? b.name, passThroughClick: true });
      mesh.material = fadeMat(mesh.material as THREE.Material);
      if (b.role === 'injector') this.injectorBuildings.push(mesh);
      this.allBuildings.push(mesh);
      this.group.add(mesh);
    }
  }

  private buildInjector(): void {
    const inj = SITE.injector;
    const y = 1.2;
    // Linac: a long thin accelerator housing
    if (inj.linac.length >= 2) {
      const pts = inj.linac.map(([x, z]) => toWorld(x, z, y));
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i];
        const b = pts[i + 1];
        const len = a.distanceTo(b);
        const box = new THREE.Mesh(new THREE.BoxGeometry(len, 2.4, 3), mats.modelShade());
        box.position.copy(a).lerp(b, 0.5);
        box.lookAt(b);
        box.rotateY(Math.PI / 2);
        box.castShadow = true;
        this.group.add(box);
      }
      this.group.add(fatLine(pts.map((p) => p.clone().setY(2.6)), { color: COLORS.electron, intensity: 2.2, width: 1.6 }));
    }
    const par = inj.par;
    this.group.add(fatLine(circlePoints(par.center[0], -par.center[1], par.radiusM, 1.2, 64), { color: COLORS.electron, intensity: 2.4, width: 1.6 }));
    const parHouse = new THREE.Mesh(new THREE.TorusGeometry(par.radiusM, 1.2, 8, 48), mats.modelShade());
    parHouse.rotation.x = Math.PI / 2;
    parHouse.position.copy(toWorld(par.center[0], par.center[1], 0.8));
    this.group.add(parHouse);

    {
      const segs: [THREE.Vector3, THREE.Vector3][] = [];
      const cols: THREE.Color[] = [];
      const c = new THREE.Color(0x2a3a52);
      for (const r of SITE.roads ?? []) {
        const pts = r.polyline.map(([x, y]) => toWorld(x, y, 0.02));
        for (let i = 0; i < pts.length - 1; i++) {
          segs.push([pts[i], pts[i + 1]]);
          cols.push(c);
        }
      }
      if (segs.length) this.group.add(fatSegments(segs, cols, { width: 2, opacity: 0.9 }).object);
    }
    const bo = inj.booster;
    if (bo.outline && bo.outline.length > 8) {
      const pts = [...bo.outline, bo.outline[0]].map(([x, y]) => toWorld(x, y, 2.4));
      this.group.add(fatLine(pts, { color: COLORS.electron, intensity: 2.6, width: 1.8 }));
    }
    const boosterHouse = new THREE.Mesh(new THREE.TorusGeometry(bo.radiusM, 2.2, 8, 160), mats.modelShade());
    boosterHouse.rotation.x = Math.PI / 2;
    boosterHouse.position.copy(toWorld(bo.center[0], bo.center[1], 1.0));
    boosterHouse.scale.set(1, 1, 0.8);
    boosterHouse.castShadow = true;
    this.group.add(boosterHouse);
    if (!(bo.outline && bo.outline.length > 8)) this.group.add(fatLine(circlePoints(bo.center[0], -bo.center[1], bo.radiusM, 2.4, 240), { color: COLORS.electron, intensity: 2.6, width: 1.8 }));
    if (inj.bts.length >= 2) {
      this.group.add(fatLine(inj.bts.map(([x, z]) => toWorld(x, z, 2.0)), { color: COLORS.electron, intensity: 2.2, width: 1.6 }));
    }
  }

  private buildBeamlines(): void {
    const featureBySector = new Map<number, string[]>();
    for (const m of FEATURE_META) featureBySector.set(m.sectorNumber, [...(featureBySector.get(m.sectorNumber) ?? []), m.id]);

    const hutchGeo = new THREE.BoxGeometry(1, 1, 1);
    const hutchEdges = new THREE.EdgesGeometry(hutchGeo);
    const segs: [THREE.Vector3, THREE.Vector3][] = [];

    for (let n = 1; n <= SITE.sectors; n++) {
      const info = SECTOR_INFO[n];
      const f = sectorFrame(n);
      const isUser = n <= USER_SECTORS;
      const features = featureBySector.get(n) ?? [];
      const hutchGeos: THREE.BufferGeometry[] = [];

      // insertion device in the straight section
      this.undMatrices[n - 1] = new THREE.Matrix4().compose(f.source, f.quat, new THREE.Vector3(1, 1, 1));

      if (isUser && (info?.id ?? true)) {
        const len = features.length ? 0 : (info?.idLengthM ?? 68);
        if (!features.length) {
          // canted sectors (two undulators ~1 mrad apart) feed two independent branches: draw both
          for (const off of info?.canted ? [-0.4, 0.4] : [0]) {
            segs.push([alongBeam(f, 2.5, off), alongBeam(f, len, off * 1.6)]);
            this.segMeta.push({ sector: n, kind: 'ID', base: COLORS.xray.clone().multiplyScalar(1.25) });
          }
          // schematic hutch train
          for (const [s, e] of GENERIC_HUTCHES) {
            if (e > len) break;
            hutchGeos.push(...this.addHutch(f, s, e, 3.6, 3.2, hutchGeo, hutchEdges, 0));
          }
        }
      }
      if (isUser && info?.bm) {
        // Bending-magnet source ~1/3 of a sector downstream of the ID straight
        // BM source: the BM beam direction is 5.0625° clockwise of the ID beam (site dossier), i.e. its tangent
        // point lies 5.0625/9 = 0.5625 of a sector downstream of the ID straight centre
        const bmOffset = (SITE.circumferenceM / SITE.sectors) * 0.5625;
        const a = sectorAngle(n) + (SITE.clockwise ? -1 : 1) * (bmOffset / SITE.orbitRadiusM);
        const fb = frameAtAngle(a);
        const bmLen = info.bmLengthM ?? 60;
        segs.push([alongBeam(fb, 2), alongBeam(fb, bmLen)]);
        this.segMeta.push({ sector: n, kind: 'BM', base: COLORS.xray.clone().multiplyScalar(0.45) });
        for (const [s, e] of GENERIC_HUTCHES.slice(0, 3)) {
          if (e > bmLen) break;
          hutchGeos.push(...this.addHutch(fb, s - 2, e - 2, 3.0, 3.0, hutchGeo, hutchEdges, 0));
        }
      }
      this.hutchMeshes.set(n, this.mergeHutches(n, hutchGeos));

      // Pick strip: the slanted floor band between this sector's ID line and the next sector's.
      if (isUser) {
        const strip = this.makeSectorStrip(n);
        this.sectorStrips.set(n, strip);
        this.group.add(strip);
        this.stage.addPickable(strip, { kind: 'sector', id: String(n), hint: `Sector ${n}` });
      }
    }
    this.finishBatches(segs);
  }

  private segList: [THREE.Vector3, THREE.Vector3][] = [];

  /** Remove a sector's schematic ID/BM beams (its floor is occupied by a neighbouring feature beamline). */
  hideSectorBeams(n: number): void {
    const pos: number[] = [];
    this.segList.forEach(([a, b], i) => {
      const q = this.segMeta[i].sector === n ? a : b;
      pos.push(a.x, a.y, a.z, q.x, q.y, q.z);
      if (this.segMeta[i].sector === n) this.segList[i] = [a, a.clone()];
    });
    (this.beamSegs.object.geometry as unknown as { setPositions(p: number[]): void }).setPositions(pos);
  }

  private finishBatches(segs: [THREE.Vector3, THREE.Vector3][]): void {
    this.segList = segs;
    this.beamSegs = fatSegments(segs, this.segMeta.map((m) => m.base), { width: 1.3 });
    this.beamlineGroup.add(this.beamSegs.object);
    this.undulators = new THREE.InstancedMesh(new THREE.BoxGeometry(4.6, 0.55, 0.55), mats.undulator(), this.undMatrices.length);
    this.undMatrices.forEach((m, i) => this.undulators.setMatrixAt(i, m));
    this.undulators.castShadow = true;
    this.ringGroup.add(this.undulators);
  }

  /** Collect a transformed hutch box + its edges for later merging into one draw call per sector. */
  private addHutch(
    f: { source: THREE.Vector3; dir: THREE.Vector3; right: THREE.Vector3; quat: THREE.Quaternion },
    start: number,
    end: number,
    width: number,
    height: number,
    geo: THREE.BufferGeometry,
    edges: THREE.BufferGeometry,
    side: number,
  ): THREE.BufferGeometry[] {
    const len = end - start;
    const c = alongBeam(f as never, (start + end) / 2, side, 0);
    c.y = height / 2;
    const m = new THREE.Matrix4().compose(c, f.quat, new THREE.Vector3(len, height, width));
    const b = geo.clone().applyMatrix4(m);
    const e = edges.clone().applyMatrix4(m);
    b.userData.kind = 'box';
    e.userData.kind = 'edge';
    return [b, e];
  }

  private mergeHutches(sector: number, geos: THREE.BufferGeometry[]): THREE.Object3D[] {
    const boxes = geos.filter((g) => g.userData.kind === 'box');
    const edges = geos.filter((g) => g.userData.kind === 'edge');
    if (!boxes.length) return [];
    const box = new THREE.Mesh(mergeGeometries(boxes), mats.genericHutch());
    box.castShadow = true;
    box.receiveShadow = true;
    box.name = `hutches-${sector}`;
    const edge = new THREE.LineSegments(mergeGeometries(edges), genericEdgeMat);
    this.hutchGroup.add(box, edge);
    return [box, edge];
  }

  /** Amber floor rings mark sectors whose beamlines received APS-U enhancements (non-feature). */
  private enhancedGroup = new THREE.Group();
  private buildEnhancedMarkers(): void {
    const feat = new Set(FEATURE_META.map((m) => m.sectorNumber));
    const geo = new THREE.RingGeometry(2.4, 3.1, 40);
    geo.rotateX(-Math.PI / 2);
    const mat = glowMaterial(0xfbbf24, 2.2, 0.85);
    for (const n of enhancedSectors()) {
      if (feat.has(n)) continue;
      const f = sectorFrame(n);
      const ring = new THREE.Mesh(geo, mat);
      ring.position.copy(alongBeam(f, 42, 0, -SITE.beamHeightM + 0.15));
      this.enhancedGroup.add(ring);
    }
    this.group.add(this.enhancedGroup);
  }

  private makeSectorStrip(n: number): THREE.Mesh {
    const f0 = sectorFrame(n);
    const f1 = sectorFrame(n + 1 > SITE.sectors ? 1 : n + 1);
    const pts: THREE.Vector2[] = [];
    const steps = 8;
    const dMax = (r: number) => Math.sqrt(Math.max(0, r * r - SITE.orbitRadiusM ** 2));
    const d0 = dMax(SITE.tunnelOuterM + 0.6);
    const d1 = dMax(SITE.hallOuterM);
    for (let i = 0; i <= steps; i++) {
      const p = alongBeam(f0, d0 + ((d1 - d0) * i) / steps, 1.8);
      pts.push(new THREE.Vector2(p.x, -p.z));
    }
    for (let i = steps; i >= 0; i--) {
      const p = alongBeam(f1, d0 + ((d1 - d0) * i) / steps, 1.8);
      pts.push(new THREE.Vector2(p.x, -p.z));
    }
    const geo = new THREE.ShapeGeometry(new THREE.Shape(pts));
    geo.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({ color: COLORS.feature, transparent: true, opacity: 0, depthWrite: false, visible: false }),
    );
    mesh.position.y = 0.12;
    mesh.userData.sector = n;
    return mesh;
  }

  private buildBunches(): { points: THREE.Points; phase: Float32Array } {
    // 48 bunches visualised (APS-U 48-bunch timing mode), slowed ~10^7x so the eye can follow them.
    const N = 48;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(N * 3);
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const phase = new Float32Array(N);
    for (let i = 0; i < N; i++) phase[i] = i / N;
    const mat = new THREE.PointsMaterial({
      color: COLORS.electron.clone().multiplyScalar(6),
      size: 5,
      sizeAttenuation: false,
      toneMapped: false,
      transparent: true,
      depthWrite: false,
    });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    this.ringGroup.add(pts);
    return { points: pts, phase };
  }

  private buildLabels(): void {
    // sector numbers just outside the hall wall, at the ID straight angle
    for (let n = 1; n <= SITE.sectors; n++) {
      const a = sectorAngle(n);
      const r = SITE.hallOuterM + 14;
      const el = document.createElement('div');
      el.className = 'lbl lbl-sector' + (n > USER_SECTORS ? ' lbl-sector-machine' : '');
      el.textContent = String(n);
      const role = n === SITE.injectionSector ? 'injection (per the design reports)' : SITE.bunchLengtheningSector === n ? 'bunch-lengthening cavity and feedback kickers (per the design reports)' : SITE.rfSectors?.includes(n) ? 'RF accelerating cavities' : '';
      if (role) el.title = `Sector ${n}: ${role}`;
      const obj = new CSS2DObject(el);
      obj.position.copy(toWorld(r * Math.cos(a), r * Math.sin(a), 0.5));
      this.labelGroup.add(obj);
      this.sectorLabels.push(obj);
      this.labelPri.set(obj, n > USER_SECTORS ? PRI.machineSector : PRI.sector);
    }
    // feature beamline pins
    for (const m of FEATURE_META) {
      const anchor = document.createElement('div');
      anchor.className = 'lbl-anchor';
      const el = document.createElement('button');
      el.className = 'lbl lbl-feature';
      el.style.setProperty('--c', m.color);
      el.dataset.id = m.id;
      el.innerHTML = `<span class="lbl-feature-sector">${m.sectorNumber}-ID</span><span class="lbl-feature-name"></span>`;
      anchor.appendChild(el);
      const obj = new CSS2DObject(anchor);
      obj.center.set(0.5, 1);
      this.labelGroup.add(obj);
      this.featureLabels.set(m.id, obj);
    }
    const place = (text: string, p: THREE.Vector3 | THREE.Vector3[], pri: number, cls = '') => {
      const el = document.createElement('div');
      el.className = 'lbl lbl-place ' + cls;
      el.textContent = text;
      const obj = new CSS2DObject(el);
      const spots = Array.isArray(p) ? p : [p];
      obj.position.copy(spots[0]);
      if (spots.length > 1) this.labelSpots.set(obj, spots);
      this.labelGroup.add(obj);
      this.placeLabels.push(obj);
      this.labelPri.set(obj, pri);
      return obj;
    };
    // injector: booster, accumulator ring and linac, each with a fallback spot on the other side of the structure
    const bo = SITE.injector.booster;
    this.injectorLabels.add(
      place('Booster synchrotron', [toWorld(bo.center[0], bo.center[1] - bo.radiusM - 8, 4), toWorld(bo.center[0], bo.center[1] + bo.radiusM + 8, 4)], PRI.landmark),
    );
    const par = SITE.injector.par;
    const parAt = (dy: number) => toWorld(par.center[0], par.center[1] + dy, 3);
    this.injectorLabels.add(place('Accumulator ring (PAR)', [parAt(par.radiusM + 5), parAt(-par.radiusM - 5)], PRI.building));
    const lin = SITE.injector.linac;
    if (lin.length >= 2) {
      const a = lin[0];
      const z = lin[lin.length - 1];
      const linAt = (dy: number) => toWorld((a[0] + z[0]) / 2, (a[1] + z[1]) / 2 + dy, 4);
      this.injectorLabels.add(place('Linac', [linAt(10), linAt(-10)], PRI.landmark));
    }
    place('Storage ring · 1,103.6 m', toWorld(0, -SITE.orbitRadiusM + 18, 4), PRI.landmark, 'lbl-place-ring');
    {
      // one grouped caption for the machine sectors (RF, injection, bunch lengthening) instead of five crowded labels
      const a = sectorAngle(38);
      const r = SITE.hallOuterM + 46;
      place('Sectors 36–40: RF cavities · injection · bunch lengthening', toWorld(r * Math.cos(a), r * Math.sin(a), 1), PRI.caption, 'lbl-place-small lbl-place-machine');
    }
    const NAMES: Record<string, string> = {
      '401': 'Central Lab/Office Bldg',
      '444': 'Long Beamline Building',
      '440': 'Center for Nanoscale Materials',
    };
    for (const b of SITE.buildings) {
      const lom = b.role === 'lom';
      const name = lom ? b.name : NAMES[b.id];
      if (!name) continue;
      const c = b.polygon.reduce((acc, [x, y]) => [acc[0] + x / b.polygon.length, acc[1] + y / b.polygon.length], [0, 0]);
      if (lom) {
        // Lab/office modules hug the hall wall, right where the sector numbers sit: label them radially outboard
        const r0 = Math.hypot(c[0], c[1]);
        const r = Math.max(SITE.hallOuterM + 36, r0 + 18);
        place(name, toWorld((c[0] / r0) * r, (c[1] / r0) * r, b.heightM + 2), PRI.lom, 'lbl-place-small');
      } else place(name, toWorld(c[0], c[1], b.heightM + 2), b.id === '444' ? PRI.landmark : PRI.building, b.id === '444' ? 'lbl-place-lbb' : '');
    }
  }

  // ---------------------------------------------------------------- feature beamline overview geometry

  /** Called by the beamline layer to place a feature pin once its geometry is known. */
  setFeaturePin(id: string, pos: THREE.Vector3, name: string): void {
    const obj = this.featureLabels.get(id);
    if (!obj) return;
    obj.position.copy(pos);
    touchLabels();
    const nameEl = obj.element.querySelector('.lbl-feature-name');
    obj.userData.anchor = pos.clone();
    if (nameEl) nameEl.textContent = name;
    // the pin's width changed with its name: measure again on the next declutter
    this.labelSizes.delete(obj.element.firstElementChild as HTMLElement);
  }

  featurePinElement(id: string): HTMLElement | undefined {
    return (this.featureLabels.get(id)?.element.firstElementChild as HTMLElement | null) ?? undefined;
  }

  private labelSizes = new WeakMap<HTMLElement, { w: number; h: number }>();
  private scratch = new THREE.Vector3();

  /** Rendered size of a label, measured once (estimated while it is not displayed). */
  private labelSize(el: HTMLElement): { w: number; h: number } {
    const known = this.labelSizes.get(el);
    if (known) return known;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    if (w > 0 && h > 0) {
      const sz = { w, h };
      this.labelSizes.set(el, sz);
      return sz;
    }
    return { w: 12 + (el.textContent?.length ?? 8) * 7, h: 16 };
  }

  /**
   * Overview label layout, in screen space. Feature pins that overlap are stacked vertically with leader lines; then
   * place names and sector numbers are kept greedily by priority, and any that would overlap a pin, a higher-priority
   * label or the UI chrome (`safe`: pixels covered on each side) is hidden. Sizes are cached, so this never forces a
   * layout.
   */
  declutterPins(camera: THREE.Camera, width: number, height: number, safe?: Partial<SafeInsets>): void {
    // without explicit insets, keep clear of whatever the stage currently reserves for UI chrome (e.g. the overview panel)
    const frame = safeRect(width, height, safe ?? stageInsets(this.stage));
    const v = this.scratch;
    // reads first (cached sizes; a first measurement happens before any style write in this pass)
    const pins: { el: HTMLElement; x: number; y: number; w: number; h: number }[] = [];
    if (this.pinsAllowed && !this.focusId) {
      for (const obj of this.featureLabels.values()) {
        const el = obj.element.firstElementChild as HTMLElement;
        if (!labelShown(obj)) continue;
        v.copy(obj.position).project(camera);
        // off-screen pins must not keep keyboard focus (CSS2D only culls behind-camera objects)
        const offscreen = v.z > 1 || Math.abs(v.x) > 1.02 || Math.abs(v.y) > 1.02;
        el.style.visibility = offscreen ? 'hidden' : '';
        if (offscreen) continue;
        const sz = this.labelSize(el);
        pins.push({ el, x: (v.x * 0.5 + 0.5) * width, y: (-v.y * 0.5 + 0.5) * height, w: sz.w, h: sz.h });
      }
    }
    const cands: { obj: CSS2DObject; pri: number; w: number; h: number }[] = [];
    if (this.placesAllowed && !this.focusId) {
      for (const obj of this.placeLabels) {
        const pri = this.injectorTour && this.injectorLabels.has(obj) ? PRI.injectorTour : (this.labelPri.get(obj) ?? 1);
        cands.push({ obj, pri, ...this.labelSize(obj.element) });
      }
      if (!this.sectorsZoomedIn) for (const obj of this.sectorLabels) cands.push({ obj, pri: this.labelPri.get(obj) ?? 1, ...this.labelSize(obj.element) });
    }
    // feature pins: stack upwards from the bottom of the screen
    pins.sort((a, b) => b.y - a.y);
    const kept: Rect[] = [];
    for (const it of pins) {
      let dy = 0;
      let r: Rect = { x0: 0, x1: 0, y0: 0, y1: 0 };
      for (let k = 0; k < 8; k++) {
        r = { x0: it.x - it.w / 2 - 4, x1: it.x + it.w / 2 + 4, y0: it.y - 6 - it.h - dy, y1: it.y - 6 - dy };
        if (!kept.some((p) => overlaps(r, p))) break;
        dy += it.h + 4;
      }
      kept.push(r);
      if (it.el.dataset.dy !== String(dy)) {
        it.el.dataset.dy = String(dy);
        it.el.style.setProperty('--dy', `${-dy}px`);
        it.el.style.setProperty('--lead', `${dy}px`);
      }
    }
    // place names and sector numbers by priority (stable within a priority)
    cands.sort((a, b) => b.pri - a.pri);
    for (const c of cands) {
      let ok = false;
      for (const spot of this.labelSpots.get(c.obj) ?? [c.obj.position]) {
        v.copy(spot).project(camera);
        if (v.z > 1) continue;
        const x = (v.x * 0.5 + 0.5) * width;
        const y = (-v.y * 0.5 + 0.5) * height;
        const r = { x0: x - c.w / 2, x1: x + c.w / 2, y0: y - c.h / 2, y1: y + c.h / 2 };
        if (!inside(r, frame) || kept.some((k) => overlaps(r, k, 3))) continue;
        kept.push(r);
        if (!spot.equals(c.obj.position)) {
          c.obj.position.copy(spot);
          touchLabels();
        }
        ok = true;
        break;
      }
      showLabel(c.obj, ok);
    }
  }

  /** Overview representation of each feature beamline: coloured beam, real enclosure footprints, hit box. */
  buildFeatureOverviewLines(items: { meta: BeamlineMeta; data?: Beamline; layout: BeamlineLayout }[]): void {
    const hutchGeo = new THREE.BoxGeometry(1, 1, 1);
    const edgeGeo = new THREE.EdgesGeometry(hutchGeo);
    for (const { meta, data, layout } of items) {
      const g = new THREE.Group();
      g.name = `feature-${meta.id}`;
      const f = sectorFrame(meta.sectorNumber, layout.cantMrad ?? 0, layout.sourceShiftM ?? 0);
      const off = layout.sideOffsetM ?? 0;
      const L = data ? Math.max(data.totalLengthM || 0, ...data.enclosures.map((e) => e.endM || 0)) : 66;
      const color = new THREE.Color(meta.color);
      const partners = new Set(layout.partnerBranches ?? []);
      const branches: (string | null)[] = layout.branches ? Object.keys(layout.branches).filter((b) => !partners.has(b)) : [null];
      if (!branches.length) branches.push(null);
      const lines: Line2[] = [];
      const endOf = (br: string | null) => {
        const e = layout.beamEndM;
        const v = typeof e === 'number' ? e : br && e ? e[br] : undefined;
        return Math.min(L, v ?? L);
      };
      for (const br of branches) {
        const pts: THREE.Vector3[] = [];
        const end = endOf(br);
        for (let x = 2.5; x <= end; x += Math.max(1, end / 60)) pts.push(alongBeam(f, x, off + branchSide(layout, br, x)));
        if (pts.length < 2) continue;
        const line = fatLine(pts, { color, intensity: 2.6, width: 2.4 });
        g.add(line);
        lines.push(line);
      }
      const ROOM = /control|vestibule|office|\blab\b|laborator|support|room|prep|aml|user area|computer/i;
      for (const e of data?.enclosures ?? []) {
        const o = layout.enclosure?.[e.name] ?? {};
        if (o.hidden || (e.branch && partners.has(e.branch))) continue;
        let start = o.startM ?? e.startM;
        let end = o.endM ?? e.endM;
        let side = o.side ?? branchSide(layout, e.branch, (start + end) / 2);
        let width = o.widthM ?? e.widthM ?? undefined;
        if (o.outline && o.outline.length > 2) {
          const xs = o.outline.map((p) => p[0]);
          const zs = o.outline.map((p) => p[1]);
          start = Math.min(...xs);
          end = Math.max(...xs);
          side = (Math.min(...zs) + Math.max(...zs)) / 2;
          width = Math.max(...zs) - Math.min(...zs);
        }
        if (!(end > start) || start < 20) continue;
        const style = o.style ?? (/transport|corridor|\bpipe\b/i.test(`${e.name} ${e.role}`) ? 'transport' : ROOM.test(e.role + ' ' + e.name) ? 'room' : 'hutch');
        if (style === 'ghost') continue;
        const transport = style === 'transport';
        const room = style === 'room';
        width ??= transport ? 1.2 : /optics|foe/i.test(e.role + e.name) ? 3.4 : 4.2;
        const hgt = transport ? 1.2 : room ? 0.6 : 3.3;
        if (o.outline && o.outline.length > 2 && !transport) {
          const shape = new THREE.Shape(o.outline.map(([x, z]) => {
            const w = alongBeam(f, x, off + z);
            return new THREE.Vector2(w.x, -w.z);
          }));
          const geo = new THREE.ExtrudeGeometry(shape, { depth: hgt, bevelEnabled: false });
          geo.rotateX(-Math.PI / 2);
          const poly = new THREE.Mesh(geo, room ? overviewRoomMat : overviewHutchMat);
          poly.castShadow = true;
          poly.receiveShadow = true;
          const pe = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 30), new THREE.LineBasicMaterial({ color, transparent: true, opacity: room ? 0.35 : 0.7 }));
          g.add(poly, pe);
          continue;
        }
        const c = alongBeam(f, (start + end) / 2, off + side);
        c.y = hgt / 2;
        const box = new THREE.Mesh(hutchGeo, room ? overviewRoomMat : overviewHutchMat);
        box.position.copy(c);
        box.quaternion.copy(f.quat);
        box.scale.set(end - start, hgt, width);
        box.castShadow = true;
        box.receiveShadow = true;
        const edge = new THREE.LineSegments(edgeGeo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: room ? 0.35 : 0.7 }));
        edge.position.copy(c);
        edge.quaternion.copy(f.quat);
        edge.scale.copy(box.scale);
        g.add(box, edge);
      }
      for (const n of layout.suppressSiteHutches ?? []) {
        this.lockedSectors.add(n);
        this.hideGenericHutches(n, true);
        this.hideSectorBeams(n);
      }
      // generous invisible hit volume along the beamline
      const hit = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ visible: false }));
      hit.position.copy(alongBeam(f, L / 2 + 2, off, 0));
      hit.quaternion.copy(f.quat);
      hit.scale.set(L - 4, 7, 7);
      g.add(hit);
      this.stage.addPickable(hit, { kind: 'feature', id: meta.id, hint: meta.id });
      this.beamlineGroup.add(g);
      this.featureObjs.set(meta.id, { group: g, lines, color, sector: meta.sectorNumber });
      this.hideGenericHutches(meta.sectorNumber, true);
      this.lockedSectors.add(meta.sectorNumber);
    }
  }

  private lockedSectors = new Set<number>();
  private fadeables: THREE.Mesh[] = [];
  private injectorBuildings: THREE.Mesh[] = [];
  private allBuildings: THREE.Mesh[] = [];
  private tourUndulator: THREE.Group | null = null;
  private undMatrices: THREE.Matrix4[] = [];
  private undulators!: THREE.InstancedMesh;
  private beamSegs!: FatSegments;
  private segMeta: { sector: number; kind: 'ID' | 'BM'; base: THREE.Color }[] = [];

  highlightFeature(id: string | null): void {
    for (const [fid, o] of this.featureObjs) {
      for (const l of o.lines) {
        const m = l.material as LineMaterial;
        m.linewidth = fid === id ? 4.5 : 2.4;
        m.color.copy(o.color).multiplyScalar(fid === id ? 4.5 : 2.6);
      }
    }
  }

  // ---------------------------------------------------------------- state

  /** Hide schematic hutches in a sector (a detailed model replaces them). */
  hideGenericHutches(sector: number, hidden: boolean): void {
    if (hidden) this.hiddenHutches.add(sector);
    else this.hiddenHutches.delete(sector);
    const show = !hidden && !this.lockedSectors.has(sector);
    for (const m of this.hutchMeshes.get(sector) ?? []) m.visible = show;
  }

  highlightSector(n: number | null): void {
    for (const [sec, strip] of this.sectorStrips) {
      const m = strip.material as THREE.MeshBasicMaterial;
      m.opacity = sec === n ? 0.16 : 0;
      m.visible = sec === n; // invisible strips cost no draw call but stay pickable
    }
    if (n === this.hotSector) return;
    this.hotSector = n;
    this.segMeta.forEach((meta, i) => this.beamSegs.setSegmentColor(i, meta.sector === n ? meta.base.clone().multiplyScalar(meta.kind === 'ID' ? 3 : 5) : meta.base));
    this.beamSegs.commitColors();
  }

  private hotSector: number | null = null;

  /** In beamline mode everything but the focus fades back so the exhibit reads clearly. */
  setFocus(id: string | null, sector: number | null): void {
    this.focusId = id;
    {
      const mat = this.beamSegs.object.material as LineMaterial;
      mat.transparent = true;
      mat.opacity = id ? 0.3 : 1;
    }
    // the detailed scene replaces every overview model in the focused sector (canted partners included)
    for (const [fid, o] of this.featureObjs) {
      o.group.visible = fid !== id && (sector === null || o.sector !== sector);
      for (const l of o.lines) {
        const m = l.material as LineMaterial;
        m.transparent = true;
        m.opacity = id ? 0.35 : 1;
      }
    }
    for (const [fid, obj] of this.featureLabels) {
      const el = obj.element.firstElementChild as HTMLElement;
      el.classList.toggle('is-dim', !!id && fid !== id);
      showLabel(obj, !id && this.pinsAllowed, el);
    }
    this.placesAllowed = !id;
    for (const o of this.sectorLabels) showLabel(o, !id && !this.sectorsZoomedIn);
    this.setWallsFaded(!!id);
    this.setInjectorFaded(!!id, true);
    for (const m of [overviewHutchMat, overviewRoomMat, mats.genericHutch() as THREE.MeshStandardMaterial]) setFaded(m, id ? 0.22 : null);
    this.enhancedGroup.visible = !id;
    for (const o of this.placeLabels) showLabel(o, !id);
    // the focused straight's placeholder insertion-device box would hide the detailed source model
    this.focusSector = id ? sector : null;
    this.applyUndulatorMatrices();
  }

  /**
   * Placeholder insertion-device boxes, one per straight. A box is collapsed where something more detailed stands in
   * its place: the guided tour's undulator model, or the source of the beamline in focus. Every caller goes through
   * here, so neither can bring the box back over the other's model.
   */
  private applyUndulatorMatrices(): void {
    const m = new THREE.Matrix4();
    for (let i = 0; i < this.undMatrices.length; i++) {
      m.copy(this.undMatrices[i]);
      if (i + 1 === this.tourUndSector || i + 1 === this.focusSector) m.scale(new THREE.Vector3(0, 0, 0));
      this.undulators.setMatrixAt(i, m);
    }
    this.undulators.instanceMatrix.needsUpdate = true;
  }

  /** Fade tunnel and hall walls (cut-away) so a focused beamline is never hidden behind them. */
  private setWallsFaded(faded: boolean): void {
    for (const m of this.fadeables) {
      setFaded(m.material as THREE.Material, faded ? 0.18 : null);
      if ('castShadow' in m) m.castShadow = !faded;
    }
  }

  private setInjectorFaded(on: boolean, all = false): void {
    for (const m of all ? this.allBuildings : this.injectorBuildings) setFaded(m.material as THREE.Material, on ? (all ? 0.11 : 0.2) : null);
  }

  /** Tour helpers: see-through injector buildings, a detailed undulator in one straight, pins on/off. */
  setTourMode(opts: { injectorXray?: boolean; undulatorSector?: number | null; pins?: boolean; walls?: boolean }): void {
    if (!this.focusId) this.setInjectorFaded(!!opts.injectorXray);
    this.injectorTour = !!opts.injectorXray;
    const und = opts.undulatorSector ?? null;
    if (und && !this.tourUndulator) {
      this.tourUndulator = undulator({ beamY: SITE.beamHeightM, lengthM: 4.6, periodMm: 28 });
      this.group.add(this.tourUndulator);
    }
    if (this.tourUndulator) {
      this.tourUndulator.visible = !!und;
      if (und) {
        const f = sectorFrame(und);
        const u = this.tourUndulator;
        u.position.copy(f.source);
        u.quaternion.copy(f.quat);
        // open (magnet) side of the C-frame faces the infield, where the tour camera sits
        const zWorld = new THREE.Vector3(0, 0, 1).applyQuaternion(f.quat);
        if (zWorld.dot(f.right) < 0) u.rotateY(Math.PI);
      }
    }
    this.tourUndSector = und;
    this.applyUndulatorMatrices();
    this.pinsAllowed = opts.pins !== false;
    if (this.focusId) return; // a focused beamline owns walls/pins visibility
    for (const obj of this.featureLabels.values()) showLabel(obj, this.pinsAllowed, obj.element.firstElementChild as HTMLElement);
    this.setWallsFaded(!!opts.walls);
  }

  setLabelVisibility(zoomedIn: boolean): void {
    if (zoomedIn === this.sectorsZoomedIn) return;
    this.sectorsZoomedIn = zoomedIn;
    for (const o of this.sectorLabels) {
      o.element.classList.toggle('is-far', zoomedIn);
      showLabel(o, !zoomedIn && !this.focusId);
    }
  }

  update(dt: number, t: number): void {
    void t;
    // Bunches: slowed-down circulation (real: 271,000 turns per second); frozen under reduced motion.
    if (this.bunchesPlaced && motionReduced()) return;
    const time = this.motion.tick(dt);
    const pos = (this.bunches.geometry.getAttribute('position') as THREE.BufferAttribute).array as Float32Array;
    const R = SITE.orbitRadiusM;
    const sgn = SITE.clockwise ? -1 : 1;
    const omega = 0.045;
    for (let i = 0; i < this.bunchPhase.length; i++) {
      const a = sgn * (this.bunchPhase[i] * Math.PI * 2 + time * omega * Math.PI * 2);
      pos[i * 3] = R * Math.cos(a);
      pos[i * 3 + 1] = BEAM_Y;
      pos[i * 3 + 2] = -R * Math.sin(a);
    }
    this.bunches.geometry.getAttribute('position').needsUpdate = true;
    this.bunchesPlaced = true;
  }
}

/** Per-mesh clone so walls can fade independently of other users of the shared material. */
function fadeMat(m: THREE.Material): THREE.MeshStandardMaterial {
  const c = (m as THREE.MeshStandardMaterial).clone();
  c.side = THREE.DoubleSide;
  // one pass even while faded: three otherwise draws transparent double-sided materials twice (back, then front),
  // re-resolving their shader program every frame; with one uniform colour the blend barely differs
  c.forceSinglePass = true;
  return c;
}

function frameAtAngle(a: number) {
  const R = SITE.orbitRadiusM;
  const sgn = SITE.clockwise ? -1 : 1;
  const tx = -sgn * Math.sin(a);
  const ty = sgn * Math.cos(a);
  const source = toWorld(R * Math.cos(a), R * Math.sin(a), BEAM_Y);
  const dir = new THREE.Vector3(tx, 0, -ty).normalize();
  const up = new THREE.Vector3(0, 1, 0);
  const right = new THREE.Vector3().crossVectors(dir, up).normalize();
  const radial = new THREE.Vector3(source.x, 0, source.z).normalize();
  if (right.dot(radial) < 0) right.negate();
  const m = new THREE.Matrix4().makeBasis(dir, up, new THREE.Vector3().crossVectors(dir, up));
  const quat = new THREE.Quaternion().setFromRotationMatrix(m);
  return { sector: 0, angle: a, source, dir, right, quat };
}
