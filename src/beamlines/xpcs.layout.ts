import * as THREE from 'three';
import type { BeamlineLayout, BuildCtx } from '../scene/beamline/layout';
import { E_TABLE, E_TABLE2, HEIGHT, I_TABLE, LDDP_POS, NEAR_POS, OUTLINE_CR, OUTLINE_E, OUTLINE_I, SA, WA } from './xpcs/geom';
import { controlRoomFurniture } from './xpcs/hutches';
import { flangeX, opticalTable, pipeX, shadowed, xm } from './xpcs/kit';
import {
  dmmGhost, endBeamStop, eOpticsTable, hdcm, kbPair, modeSwitchMask, shieldBlock, transfocator, transportSupports, wallSleeve,
} from './xpcs/optics';
import { flightTube, saDetector, sampleTableRheometer, swingArc } from './xpcs/sa';
import { frontEndTrain, phaseShifter, revolverUndulator } from './xpcs/source';
import { speckleCard, speckleFaceMaterial, speckleSim } from './xpcs/speckle';
import { cryostage, ghostPipe, laserTracker, lddp, nearDetector, sixCircle } from './xpcs/wa';

/**
 * 8-ID XPCS — two in-line revolver undulators → windowless HHL front end → 8-ID-A FOE (M1/M2 sideways periscope,
 * horizontal LN2 DCM) → 11 m shielded transport → 8-ID-D SOE (CRL-1 transfocator) → 8-ID-E (wide-angle XPCS:
 * KB + Huber six-circle + LDDP) → 8-ID-I (small-angle XPCS: CRL-2, rheometer, 12 m flight tube, fast detector).
 *
 * Topology: a single, non-canted beam; the two stations are in series and run one at a time, so no engine `branches`
 * are used. The beam is drawn continuing through 8-ID-E to 8-ID-I, as it does in pinhole-USAXS mode; a label at the
 * see-through beam-pass pipe says the stations take turns. The real lateral offsets (M1/M2 ~16 mm inboard, HDCM 10–15 mm)
 * are far below hall-scale visibility and are not drawn; M1 and M2 sit on the correct sides of the beam for an inboard
 * periscope. 8-ID-E is shown in its WA configuration (detectors at an illustrative 2θ = 30°: LDDP horizontal-outboard at
 * 3.7 m, near detector vertical at 1.6 m). Hutch outlines (8-ID-E stepped, 8-ID-I tapered), the control room and table
 * extents are read from the 2021 plan (±0.3 m). Enlarged for visibility: DCM crystal offset (×2.7), lens cartridges, the
 * Couette cup (×2), the in-vacuum beam stop (×2). The windowless HHL front end is drawn as its train of parts in FDR order
 * (positions within ~14.4–23.6 m are approximate; the FDR does not tabulate them).
 */

const faceMat = speckleFaceMaterial();

/** Put the live speckle texture on a detector face. */
function withLiveFace<T extends THREE.Object3D>(o: T): T {
  const f = o.getObjectByName('detector-face') as THREE.Mesh | undefined;
  if (f) f.material = faceMat;
  return o;
}

const TUBE_PIN_X = 73.0; // flight-tube pin/close-up at mid-length (the dossier distance is its 68.0 m start)
const STOP_X = SA.tubeX0 + 10.6; // motorized in-vacuum beam stop near the downstream end of the flight tube
const VP2_MID = (57.3 + 61.0) / 2; // removable beam-pass pipe, 57.3–61.0 m

const layout: BeamlineLayout = {
  id: 'xpcs',
  enclosureDefaults: { heightM: 3.3 },
  enclosure: {
    '8-ID-A': { side: 0.3, widthM: 2.1, heightM: HEIGHT.A },
    'Shielded transport': { widthM: 0.5 },
    '8-ID-D': { side: 0.1, widthM: 1.8, heightM: HEIGHT.D },
    // true footprints from the 2021 plan (stepped 8-ID-E, tapered 8-ID-I, wedge control room)
    '8-ID-E': { outline: OUTLINE_E, heightM: HEIGHT.E },
    '8-ID control room': { outline: OUTLINE_CR, style: 'room' },
    '8-ID-I': { outline: OUTLINE_I, heightM: HEIGHT.I },
  },
  // the engine beam ends at the in-vacuum beam stop inside the flight tube (the last sample is 11 m upstream of it)
  beamEndM: STOP_X,
  comp: {
    // ---------------------------------------------------------------- straight section
    'revolver-upstream': { build: (c) => revolverUndulator(c.beamY), pinUp: 0.85, shot: { r: 3.2, dir: [-0.55, 0.45, -0.9], target: [1.25, 0, 0] } },
    'phase-shifter': { build: (c) => phaseShifter(c.beamY), pinUp: 0.4, shot: { r: 1.0 } },
    'revolver-downstream': { build: (c) => revolverUndulator(c.beamY), pinUp: 0.85, shot: { r: 3.2, dir: [-0.55, 0.45, -0.9], target: [-1.25, 0, 0] } },
    // the whole front-end train (~14.4–23.6 m) seen from inboard, above the ring magnets that sit ~1 m inboard here
    'hhl-front-end': { build: (c) => frontEndTrain(c.beamY), pinUp: 0.8, shot: { r: 4.6, dir: [-0.15, 1.0, -0.5], target: [-0.3, -0.2, 0.3] } },
    // ---------------------------------------------------------------- 8-ID-A (FOE)
    'fe-exit-mask': { build: (c) => shieldBlock({ beamY: c.beamY, len: 0.3, mat: 'copper', water: true }), pinUp: 0.45 },
    'fe-exit-collimator': { build: (c) => shieldBlock({ beamY: c.beamY, len: 0.3, w: 0.3, h: 0.3, mat: 'tungsten' }), pinUp: 0.4 },
    'wb-slits': { pinUp: 0.4 },
    // M1 deflects inboard: substrate on the outboard side of the beam (the part's default is the opposite)
    m1: { rotY: Math.PI, props: { lengthM: 0.5 }, pinUp: 0.55, shot: { r: 1.5 } },
    'bd-1': { pinUp: 0.35 },
    'wb-stop': { build: (c) => shieldBlock({ beamY: c.beamY, len: 0.22, mat: 'tungsten', hole: 0.02 }), pinUp: 0.4 },
    m2: { props: { lengthM: 0.5 }, pinUp: 0.55, shot: { r: 1.5 } },
    'sc-1': { build: (c) => shieldBlock({ beamY: c.beamY, len: 0.2, w: 0.36, h: 0.36, mat: 'lead', hole: 0.02 }), pinUp: 0.4 },
    'pm-2': { build: (c) => shieldBlock({ beamY: c.beamY, len: 0.14, w: 0.2, h: 0.2, mat: 'copper', water: true }), pinUp: 0.4 },
    'bc-1': { build: (c) => shieldBlock({ beamY: c.beamY, len: 0.2, w: 0.32, h: 0.32, mat: 'tungsten', hole: 0.02 }), pinUp: 0.4 },
    'bd-2': { pinUp: 0.35 },
    'pb-slits-2': { pinUp: 0.4 },
    hdcm: { build: (c) => hdcm(c.beamY), pinUp: 1.25, shot: { r: 1.9, dir: [-0.6, 0.4, -0.85], target: [0, -0.05, 0] } },
    'pm-3': { build: (c) => modeSwitchMask(c.beamY), pinUp: 0.4 },
    'sh-1': { pinUp: 0.75 },
    'sc-2': { build: (c) => shieldBlock({ beamY: c.beamY, len: 0.2, w: 0.36, h: 0.36, mat: 'lead', hole: 0.02 }), pinUp: 0.4 },
    // pin and close-up at mid-run (the dossier distance is its 36.0 m start); seen from the outboard aisle, because
    // inboard the ring-tunnel wall is in the way
    'transport-1': {
      distanceM: 41.4,
      build: (c) => transportSupports(c.beamY, 41.4),
      pinUp: 0.4,
      shot: { r: 5.2, dir: [-0.25, 0.55, 1], target: [0, -0.35, 0] },
    },
    // ---------------------------------------------------------------- 8-ID-D (SOE)
    'bd-3': { pinUp: 0.35 },
    'pb-slits-3': { pinUp: 0.4 },
    dmm: { build: (c) => dmmGhost(c.beamY), pinUp: 0.4 },
    'pm-4': { build: (c) => modeSwitchMask(c.beamY), pinUp: 0.4 },
    'pb-slits-4': { pinUp: 0.4 },
    'crl-1': { build: (c) => transfocator(c.beamY), pinUp: 0.45, shot: { r: 1.0, dir: [-0.55, 0.55, -0.85] } },
    'bd-4': { pinUp: 0.35 },
    'sh-2': { pinUp: 0.75 },
    // ---------------------------------------------------------------- 8-ID-E (WA-XPCS)
    '8ide-table-optics': { build: (c) => eOpticsTable(c.beamY, 54.8), pinUp: 0.3 },
    kb: { build: () => kbPair(E_TABLE.top), pinUp: 0.3, shot: { r: 0.85, dir: [-0.5, 0.55, -0.9] } },
    'wn-1': { props: { beamY: -E_TABLE.top }, pinUp: 0.22 },
    'sl-6': { props: { beamY: -E_TABLE.top }, pinUp: 0.3 },
    // the inboard η/δ circles hide the sample from the inboard side: frame it from upstream-outboard-above instead
    diffractometer: { build: (c) => sixCircle(c.beamY), pinUp: 1.05, shot: { r: 2.4, dir: [-0.75, 0.6, 0.65], target: [0.3, -0.35, 0.1] } },
    '8ide-sample-env': { build: () => cryostage(), pinUp: 0.2, shot: { r: 0.55, dir: [-0.8, 0.5, 0.5] } },
    // pin at mid-pipe (the dossier distance is its 57.3 m start), raised clear of the LDDP flight path
    'vp-2': {
      distanceM: VP2_MID,
      build: (c) => {
        const g = new THREE.Group();
        const p = ghostPipe(c.beamY, 61.0 - 57.3);
        p.position.x = 57.3 - VP2_MID;
        g.add(p);
        return g;
      },
      pinUp: 0.45,
    },
    '8ide-near-detector': {
      distanceM: NEAR_POS.x,
      dy: NEAR_POS.up,
      rot: [0, 0, WA.twoTheta],
      build: () => withLiveFace(nearDetector(faceMat)),
      pinUp: 0.3,
      shot: { r: 2.1, dir: [0.2, 0.4, 1], target: [-0.55, -0.35, 0] },
    },
    lddp: {
      distanceM: LDDP_POS.x,
      side: LDDP_POS.side,
      rotY: -WA.twoTheta,
      build: (c) => withLiveFace(lddp(c.beamY, faceMat)),
      pinUp: 0.35,
      // side-on view of the whole sample → detector arm from downstream-inboard
      shot: { r: 4.4, dir: [0.45, 0.6, -0.8], target: [-1.0, -0.35, -0.6] },
    },
    'bd-5': { props: { beamY: -E_TABLE2.top }, pinUp: 0.35 },
    'sl-7': { props: { beamY: -E_TABLE2.top }, pinUp: 0.4 },
    'crl-2': { build: () => transfocator(-E_TABLE2.top, [2, 3, 6]), pinUp: 0.45, shot: { r: 1.0, dir: [-0.55, 0.55, -0.85] } },
    'sh-3': { props: { beamY: -E_TABLE2.top }, pinUp: 0.75 },
    'st-3': { build: () => wallSleeve(), pinUp: 0.35 },
    // ---------------------------------------------------------------- 8-ID-I (SA-XPCS)
    'guard-slits-1': { props: { beamY: -I_TABLE.top }, pinUp: 0.4 },
    '8idi-fast-shutter-attenuators': { props: { beamY: -I_TABLE.top }, pinUp: 0.5 },
    'guard-slits-2': { props: { beamY: -I_TABLE.top }, pinUp: 0.4 },
    'guard-slits-3': { props: { beamY: -I_TABLE.top }, pinUp: 0.4 },
    'wn-2': { props: { beamY: -I_TABLE.top }, pinUp: 0.3 },
    '8idi-sample': { build: (c) => sampleTableRheometer(c.beamY), pinUp: 0.55, shot: { r: 1.25, dir: [-0.6, 0.45, -0.9], target: [0, 0.02, 0] } },
    '8idi-flight-tube': {
      distanceM: TUBE_PIN_X,
      build: (c) => {
        const g = new THREE.Group();
        const t = flightTube(c.beamY);
        t.position.x = SA.tubeX0 - TUBE_PIN_X;
        g.add(t);
        return g;
      },
      pinUp: 0.45,
      pinPriority: 3,
      // the hero: the whole sample → tube → detector run, seen from above-inboard through the cut-away (target shifted
      // downstream so the run sits left of the side panel)
      shot: { r: 14.8, dir: [-0.12, 0.8, -0.6], target: [1.6, -0.4, 0] },
    },
    // look down through the open top of the tube's last section and the thin Kapton window onto the speckle face
    '8idi-detectors': { build: () => withLiveFace(saDetector(faceMat)), pinUp: 0.2, shot: { r: 1.9, dir: [-0.8, 0.62, -0.3], target: [0.05, 0.12, 0] } },
    beamstop: { build: (c) => endBeamStop(c.beamY), pinUp: 0.3, shot: { r: 1.6, dir: [-0.55, 0.45, -0.9], target: [0, 0.05, 0] } },
  },
  // sample → detector cones are drawn in custom() with per-cone opacity (the engine cones bloom at the LDDP)
  scatter: [],
  quietPins: [
    'phase-shifter', 'fe-exit-collimator', 'bd-1', 'wb-stop', 'sc-1', 'pm-2', 'bc-1', 'bd-2', 'pb-slits-2', 'pm-3', 'sc-2',
    'bd-3', 'pb-slits-3', 'pm-4', 'pb-slits-4', 'bd-4', 'wn-1', 'sl-6', 'bd-5', 'sl-7', 'st-3', 'guard-slits-1',
    'guard-slits-2', 'guard-slits-3', 'wn-2', '8idi-fast-shutter-attenuators', 'beamstop', 'vp-2',
  ],
  people: [
    // aisle beside the first optics enclosure
    { x: 30.4, side: 2.3, rotY: Math.PI / 2 },
    // 8-ID-E: beside the LDDP, for the scale of the air-bearing positioner and the six-circle
    { x: 58.3, side: 2.85, rotY: Math.PI / 2 },
    // 8-ID-I: beside the sample table, pointing down the flight tube
    { x: 66.7, side: 1.15, rotY: -Math.PI / 2, pose: 'point' },
  ],
  // inboard side so the beam runs left → right like the subway map; raised to look past the ring tunnel
  camera: { along: 0.56, side: -1, up: 0.68, distanceScale: 0.95 },
  custom: (ctx) => custom(ctx),
};

function custom(ctx: BuildCtx): void {
  const g = ctx.group;
  const beamY = ctx.beamY;

  // ---- live speckle on the detector faces (frozen under reduced motion / screenshot mode)
  const sim = speckleSim();
  ctx.onFrame(() => sim.tick());

  // ---- control-room desks and doors (the engine draws the room outline from OUTLINE_CR)
  g.add(controlRoomFurniture(beamY));

  // ---- white beam already flowing inside the undulators (the engine starts the beam at the source point)
  ctx.addBeam([ctx.at(-2.45, 0), ctx.at(0, 0)], 'white', { pulses: false });

  // ---- tables (context, not pickable)
  const t2 = opticalTable(beamY, E_TABLE2.x1 - E_TABLE2.x0, E_TABLE2.half * 2, E_TABLE2.top);
  t2.position.copy(ctx.at((E_TABLE2.x0 + E_TABLE2.x1) / 2));
  const t3 = opticalTable(beamY, I_TABLE.x1 - I_TABLE.x0, I_TABLE.half * 2, I_TABLE.top);
  t3.position.copy(ctx.at((I_TABLE.x0 + I_TABLE.x1) / 2));
  g.add(t2, t3);

  // ---- vacuum pipes bridging the gaps between the beam-axis hardware of neighbouring parts [x0, x1, radius]
  const runs: [number, number, number][] = [
    [25.55, 25.95, 0.03],
    [26.25, 26.85, 0.03],
    [28.85, 29.83, 0.03],
    [31.5, 31.73, 0.03],
    [31.87, 32.0, 0.03],
    [35.7, 36.0, 0.03],
    [46.8, 47.25, 0.03],
    [47.75, 47.85, 0.03],
    [48.35, 48.5, 0.03],
    [49.5, 50.75, 0.03],
    [53.65, 54.3, 0.03],
    [61.55, 61.81, 0.025],
    [62.79, 62.85, 0.025],
    [64.05, 64.25, 0.025],
    [65.75, 66.15, 0.025],
  ];
  for (const [a, b, r] of runs) {
    const p = new THREE.Group();
    p.add(pipeX(0, b - a, r), flangeX(0, r + 0.02), flangeX(b - a, r + 0.02));
    p.position.copy(ctx.at(a));
    g.add(shadowed(p));
  }
  // wall sleeve where the beam enters 8-ID-E from 8-ID-D
  const sleeve = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.3, 0.3), xm.lead());
  sleeve.position.copy(ctx.at(53.92));
  g.add(sleeve);

  // ---- 8-ID-E: laser tracker beside the optics table (MEDSI render)
  const tracker = laserTracker();
  tracker.position.copy(ctx.at(55.05, 1.25, -beamY));
  tracker.rotation.y = Math.PI * 0.8;
  g.add(tracker);

  // ---- scattered X-rays, sample → detector (illustrative cones sized to each detector's acceptance)
  const wa = ctx.at(WA.sampleX);
  g.add(scatterCone(wa, ctx.at(LDDP_POS.x, LDDP_POS.side), 0.017, ctx.color, 0.07));
  g.add(scatterCone(wa, ctx.at(NEAR_POS.x, 0, NEAR_POS.up), 0.03, ctx.color, 0.1));
  g.add(scatterCone(ctx.at(SA.sampleX), ctx.at(SA.detX), 0.0068, ctx.color, 0.16));

  // ---- the stations take turns: say so where the beam passes the WA instrument
  // (inboard of the beam, clear of the LDDP flight path that leaves the sample toward outboard)
  ctx.addLabel('Stations take turns: in 8-ID-I mode the beam passes through here', ctx.at(VP2_MID + 0.3, -0.8, 0.35), { maxDist: 9 });

  // ---- 8-ID-I: swing arc of the flight tube on the floor
  const arc = swingArc(beamY);
  arc.position.copy(ctx.at(SA.sampleX));
  g.add(arc);

  // ---- the museum "magnifier": a fixed-size live-speckle card just above the 8-ID-I detector (HTML, so it stays
  // legible in the hero shot and does not swamp the close-up); hidden from the whole-beamline view
  const cardAnchor = new THREE.Object3D();
  cardAnchor.position.copy(ctx.at(SA.detX + 0.1, 0, 0.18));
  g.add(cardAnchor);
  speckleCard(ctx.addLabel('', cardAnchor.position, { maxDist: 32 }), cardAnchor, 'Speckle, live (simulated)', 'outer grains twinkle fastest');
}

/** Narrow additive cone from a sample to a detector face (half-angle in rad). */
function scatterCone(from: THREE.Vector3, to: THREE.Vector3, half: number, color: string, opacity: number): THREE.Object3D {
  const dir = to.clone().sub(from);
  const len = dir.length();
  const r = Math.tan(half) * len;
  const geo = new THREE.ConeGeometry(r, len, 32, 1, true);
  geo.translate(0, -len / 2, 0);
  geo.rotateX(Math.PI); // apex at the origin, opening along +Y
  const mat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(color).multiplyScalar(1.5),
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

export default layout;
