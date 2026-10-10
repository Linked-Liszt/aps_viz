import * as THREE from 'three';
import type { BeamlineLayout, BuildCtx, CompOverride } from '../scene/beamline/layout';
import { fatLine } from '../scene/lines';
import { COLORS } from '../scene/palette';
import {
  ATOMIC_PIPE, ATOMIC_SLOPE, BCDI, BRANCH_3DMN, CANT_MRAD, F_HEIGHT, H_SCAN, MICRO_KB_X, MICRO_X, MICROSCOPE, N_SURF, NANO_ENCL, NANO_KB_X, NANO_X, OUTLINE_E,
  OUTLINE_F, SDD, WIRE, atomicSide,
} from './3dmn/geom';
import { cantingMagnets, flightTube, foeMirror, hdcm, pinkBeamStop, pinkShutter, shieldBlock, shieldedPipe, whiteBeamStop } from './3dmn/infra';
import {
  CODED_ORIGIN, OUT_CENTER, SDD_ORIGIN, TOP_CENTER, baseAndGantry, bcdiDetector, codedAperture, fluorescenceCone, fluorescenceDetector, microKB, microRays,
  sampleTower, sideDetectors, topDetector, wireScanner,
} from './3dmn/micro';
import { knifeEdge, nanoDetectors, nanoKB, nanoPositioner, nanoRays, nanoTable, thermalEnclosure } from './3dmn/nano';
import { NANO_TOP } from './3dmn/nano';

/**
 * 3DMN — 3D Micro & Nano Diffraction, 34-ID-E (outboard branch of the canted 34-ID pair; ATOMIC = inboard partner).
 *
 * Geometry (see ./3dmn/geom.ts for sources):
 * • The whole group is rotated +0.5 mrad (cantMrad) so local +X is the 3DMN beam's initial direction; the ATOMIC beam then
 *   leaves at −1 mrad. Each flat first mirror deflects 6 mrad (3DMN outboard at 29.6 m, ATOMIC inboard at 31.3 m), giving
 *   the ~0.4 m separation drawn in FDR Fig. 4.58 through 34-ID-E. No lateral exaggeration is used.
 * • ATOMIC is context only (`partnerBranches`): it is NOT an engine branch, because its beam keeps diverging (−7 mrad in
 *   this frame) where the engine's branch offset would level off; its beam is drawn here (dim, no pulses) and its few
 *   components get explicit sides from the true straight-line geometry. Its hutch 34-ID-F is left out of this exhibit's
 *   overview footprint.
 * • 34-ID-E (stepped) and 34-ID-F (trapezoidal) are engine outline hutches traced from FDR Fig. 4.58; A/B/C widths and
 *   offsets are read from the same plan (±0.1–0.3 m).
 * • Micro station (hero): sample surface at 45°, 409.6 mm detector 513 mm above (2θ ≈ 90° at centre), the two side
 *   detectors at their calibrated pre-upgrade positions (lauelab geoN_2023-04-06: tilted 45° about the beam, ~0.40 m,
 *   centres ~0.14 m upstream), SDD, microscope along the surface normal, KB (V mirror ~142 mm, H mirror ~70 mm from the
 *   focus), animated Pt-wire scan with real computed Laue rays for two Ni grains (energy-coloured; rays dim when the wire
 *   shadows them). The sample plate sits on a 45° wedge mount; the microscope hangs from the upstream gantry crossbar (no
 *   floor column between inboard visitors and the KB / sample; the mount itself is not documented). The wire
 *   neighbourhood (wire Ø, gap, depth of origin) is enlarged ×12 for visibility; the coded aperture and the DCM crystal
 *   offset are also enlarged (noted in the dossier text).
 * • The far-field BCDI detector sits 2.2 m up and outboard (2θ ≈ 72°) so its ray leaves THROUGH the 45° surface; that ray
 *   is a thin dashed mono line (BCDI is a single-colour mode, the scene shows pink-beam operation).
 * • Micro and nano instruments are used one at a time: the engine's pink beam ends in the micro sample (beamEndM); the
 *   nano-mode path (micro KB and stage retracted) continues dashed to 65.6 m. ATOMIC's shielded pipe crosses 34-ID-E
 *   ~0.4 m inboard and, as in FDR Fig. 4.58, runs through both instrument footprints; it is drawn as a faint cut-away.
 */

const sideE = BRANCH_3DMN.side; // 3DMN beam offset inside 34-ID-E
const PINK_STOP_X = 66.9; // 34ID-BS-1 (FDR Table 4.63)
const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** Place a component at a station-relative offset from the micro sample. */
function atMicro(o: THREE.Vector3, extra: CompOverride): CompOverride {
  return { distanceM: MICRO_X + o.x, side: sideE + o.z, dy: o.y, ...extra };
}

/** ATOMIC (partner) items: explicit lateral position from the true beam geometry. */
const atomic = (x: number, extra: CompOverride = {}): CompOverride => ({ side: atomicSide(x), pinPriority: 1, ...extra });

/** Lateral offsets (relative to a null-branch component at side 0) of both beams, for shielding-block apertures. */
function holesAt(x: number): number[] {
  const t = Math.max(0, Math.min(1, (x - BRANCH_3DMN.divergeAtM) / BRANCH_3DMN.rampM));
  return [BRANCH_3DMN.side * t * t * (3 - 2 * t), atomicSide(x)];
}

/** 34ID-ST-1, the shielded transport between 34-ID-A and 34-ID-B (FDR Table 4.63: 36.0–42.5 m). */
const ST1 = { x0: 36.0, len: 6.5 };

/** Re-centre a part built from its upstream end (x = 0 … len) on its midpoint, so its pin and close-up sit mid-span. */
function midSpan(part: THREE.Object3D, len: number): THREE.Group {
  const g = new THREE.Group();
  part.position.x -= len / 2;
  g.add(part);
  return g;
}

const BCDI_LOCAL = v(BCDI.x - MICRO_X, BCDI.up, BCDI.side);
/** close-up target offset (from a component origin) that puts the view centre back on the micro sample */
const toSample = (o: THREE.Vector3, k = 1): [number, number, number] => [-o.x * k, -o.y * k, -o.z * k];

const layout: BeamlineLayout = {
  id: '3dmn',
  cantMrad: CANT_MRAD,
  branches: {
    '3dmn': { ...BRANCH_3DMN, label: '3DMN (outboard)' },
  },
  partnerBranches: ['atomic'],
  // 3DMN's signature mode is polychromatic ("pink") Laue: keep the beam drawn polychromatic all the way; the HDCM is in bypass.
  monoAtM: { '3dmn': 1e6 },
  // micro mode: the pink beam ends in the 45° micro sample (reflection geometry); the nano path is drawn dashed in custom()
  beamEndM: { '3dmn': MICRO_X },
  // distance ruler on the infield side (as in ATOMIC), nearest the infield whole-beamline camera: drawn outboard, its
  // labels sat behind the line, on the pins and hutch labels
  rulerSide: -3.1,
  comp: {
    // ---------------------------------------------------------------- straight section
    // close-ups look from the infield side (source on the left, as in the whole-beamline view) unless noted
    'canting-magnets': { build: (c) => cantingMagnets(c.beamY), pinUp: 0.55, shot: { r: 2.2, dir: [-0.5, 0.55, -0.9] } },
    'atomic-revolver': atomic(1.2, { props: { periodMm: 25 } }),
    // ---------------------------------------------------------------- 34-ID-A (FOE)
    'fe-exit-mask': { build: (c) => shieldBlock({ beamY: c.beamY, len: 0.22, mat: 'copper', holes: holesAt(25.4), hole: 0.012 }), pinUp: 0.4 },
    'fe-exit-collimator': { build: (c) => shieldBlock({ beamY: c.beamY, len: 0.25, mat: 'tungsten', holes: holesAt(26.1), hole: 0.016 }), pinUp: 0.4 },
    'atomic-wb-slits': atomic(26.8),
    'w-collimator': { build: (c) => shieldBlock({ beamY: c.beamY, len: 0.2, mat: 'tungsten', holes: holesAt(28.4), hole: 0.016 }), pinUp: 0.4 },
    'pb-collimator-1': { build: (c) => shieldBlock({ beamY: c.beamY, len: 0.2, w: 0.36, h: 0.36, mat: 'lead', holes: holesAt(28.7), hole: 0.018 }), pinUp: 0.4 },
    // from outboard: the reflecting face (three coating stripes) of the side-deflecting mirror faces the camera
    'outboard-mirror': { build: (c) => foeMirror({ beamY: c.beamY, deflect: 1 }), pinUp: 0.5, shot: { r: 1.1, dir: [-0.35, 0.55, 1] } },
    'sc-1': { build: (c) => shieldBlock({ beamY: c.beamY, len: 0.18, mat: 'lead', holes: [0, atomicSide(30.3)], hole: 0.02 }), pinUp: 0.4 },
    'atomic-mirror': atomic(31.3, { build: (c) => foeMirror({ beamY: c.beamY, deflect: -1 }), pinUp: 0.5 }),
    'sc-2': { build: (c) => shieldBlock({ beamY: c.beamY, len: 0.18, mat: 'lead', holes: holesAt(32.2), hole: 0.02 }), pinUp: 0.4 },
    'pink-mask-wb-stop': { build: (c) => whiteBeamStop(c.beamY, holesAt(34.0)), pinUp: 0.55, shot: { r: 1.3, dir: [-0.7, 0.5, -0.6] } },
    // pin and close-up at mid-span (the pipe runs 36.0–42.5 m): anchored at its upstream end, the selected pin fell
    // outside the close-up frame. The camera looks down from above the storage-ring tunnel wall: sector 35's tunnel
    // runs ~2.2 m inboard of this pipe, and a lower infield camera would sit inside that wall.
    'shielded-transport-1': {
      distanceM: ST1.x0 + ST1.len / 2,
      side: -0.01,
      build: (c) => midSpan(shieldedPipe({ beamY: c.beamY, len: ST1.len, rIn: 0.13, rOut: 0.17, supports: [0.35, 3.25, 6.15] }), ST1.len),
      pinUp: 0.4,
      shot: { r: 2.6, dir: [-0.4, 0.85, -0.6] },
    },
    // ---------------------------------------------------------------- 34-ID-B
    'photon-mask-outboard': { build: (c) => shieldBlock({ beamY: c.beamY, len: 0.18, w: 0.2, h: 0.22, mat: 'copper', hole: 0.012 }), pinUp: 0.4 },
    'pb-collimator-brems-stop': { build: (c) => shieldBlock({ beamY: c.beamY, len: 0.25, w: 0.56, h: 0.36, mat: 'lead', holes: holesAt(47.3), hole: 0.02 }), pinUp: 0.4 },
    // ---------------------------------------------------------------- 34-ID-C
    'atomic-dcm': atomic(51.0, { build: (c) => hdcm({ beamY: c.beamY, bypass: false, heater: true }), pinUp: 0.6 }),
    'atomic-kb1': atomic(52.0),
    // from outboard: the tank's cut-away half faces outboard (from inboard the closed half of the lid hides the crystals)
    'hdcm-3dmn': { build: (c) => hdcm({ beamY: c.beamY, bypass: true, heater: true }), pinUp: 0.62, shot: { r: 0.95, dir: [-0.45, 0.7, 0.75] } },
    // from outboard: ATOMIC's own pink-beam shutter stands 0.4 m inboard of this one and would fill an infield view
    'pink-shutter-3dmn': { build: (c) => pinkShutter(c.beamY), pinUp: 0.72, shot: { r: 1.3, dir: [-0.6, 0.5, 0.8] } },
    // ---------------------------------------------------------------- 34-ID-E
    'atomic-transport-through-e': atomic(ATOMIC_PIPE.x0, {
      build: (c) => {
        const g = shieldedPipe({
          beamY: c.beamY,
          len: ATOMIC_PIPE.x1 - ATOMIC_PIPE.x0,
          rIn: ATOMIC_PIPE.rIn,
          rOut: ATOMIC_PIPE.rOut,
          supports: ATOMIC_PIPE.supports.map((x) => x - ATOMIC_PIPE.x0),
          ghost: true,
        });
        g.rotation.y = -ATOMIC_SLOPE; // follow the ATOMIC beam (−7 mrad in this frame)
        return g;
      },
      pinUp: 0.35,
      // wide, from inboard and above: the faint pipe crossing 34-ID-E past the micro station; the target stays close enough
      // to the pipe's upstream end (where its pin is anchored) to keep the selected pin in frame
      shot: { r: 6, dir: [-0.3, 0.72, -0.62], target: [2.4, -0.2, 0] },
    }),
    // close-ups of the micro station: from the inboard side (the outboard side is crowded by the SDD and the BCDI arm)
    // from inboard-upstream, just above the beam: the V mirror (long) then the H mirror, the ~5 cm gap to the 45° sample
    'micro-kb': { distanceM: MICRO_KB_X, build: () => microKB(), pinUp: 0.3, shot: { r: 0.32, dir: [-0.26, 0.1, -0.33], target: [-0.04, 0, 0] } },
    // from inboard-downstream, inside the gantry (a farther view puts a gantry post in front): stage stack, 45° wedge,
    // KB nose, microscope and the wire stage
    'micro-sample-stage': { build: () => sampleTower(), pinUp: 0.13, shot: { r: 0.4, dir: [0.23, 0.16, -0.46], target: [-0.03, -0.04, 0] } },
    // from above, a little downstream and outboard: the wire crossing just above the sample plate on its 45° wedge, with the
    // SDD cone and the parked coded aperture (side views would see the wire end-on)
    'micro-wire': { build: () => wireScanner(), pinUp: 0.21, pinPriority: 3, shot: { r: 0.1, dir: [0.27, 1, 0.31], target: [0.002, 0.003, 0.004] } },
    'coded-aperture': atMicro(CODED_ORIGIN, { build: () => codedAperture(), pinUp: 0.3, shot: { r: 0.12, dir: [0.12, 1, 0.1], target: [-0.003, -0.003, -0.02] } }),
    'top-area-detector': atMicro(TOP_CENTER, {
      build: () => topDetector(),
      pinUp: 0.3,
      // from downstream-outboard, below the sample-to-detector midpoint: the spot pattern on its face, the rays rising
      // from the sample, and the two tilted side panels in one view
      shot: { r: 0.72, dir: [0.75, -0.15, 0.5], target: [-0.03, -0.22, 0] },
    }),
    'side-area-detectors': atMicro(OUT_CENTER, {
      build: () => sideDetectors(),
      pinUp: 0.24,
      // looking back up the beam: the two panels tilted 45° either side, the main detector above, the sample below
      shot: { r: 0.8, dir: [1, 0.2, -0.05], target: [0.14, -0.046, -0.285] },
    }),
    'fluorescence-detector': atMicro(SDD_ORIGIN, {
      build: () => fluorescenceDetector(),
      pinUp: 0.16,
      shot: { r: 0.3, dir: [0.35, 0.55, 1], target: toSample(SDD_ORIGIN, 0.55) },
    }),
    'bcdi-far-field-detector': atMicro(BCDI_LOCAL, {
      build: (c) => bcdiDetector(BCDI_LOCAL.clone().negate(), -c.beamY - BCDI.up),
      pinUp: 0.3,
      // from upstream-outboard: the dashed Bragg ray rises from the micro sample to the detector on its tower
      shot: { r: 2.5, dir: [-1, 0.35, 0.3], target: toSample(BCDI_LOCAL, 0.5) },
    }),
    // from inboard, upstream and above (through the faint ATOMIC pipe): the whole clear-walled room with table, KB, detectors
    // and the beam stop just downstream
    'nano-thermal-enclosure': { distanceM: NANO_ENCL.x0, build: () => thermalEnclosure(), pinUp: 1.15, shot: { r: 3.6, dir: [-0.45, 0.6, -1], target: [1.75, -0.3, 0.04] } },
    'nano-kb': { distanceM: NANO_KB_X, build: () => nanoKB(), pinUp: 0.28, shot: { r: 0.3, dir: [-0.25, 0.55, -1], target: [-0.03, 0, 0] } },
    'nano-sample-stage': { distanceM: NANO_X, build: () => nanoPositioner(), pinUp: 0.12, shot: { r: 0.45, dir: [-0.45, 0.45, -1], target: [0, 0.02, 0] } },
    'nano-knife-edge': { distanceM: NANO_X, build: () => knifeEdge(), pinUp: 0.2, shot: { r: 0.11, dir: [0.15, 1, -0.12], target: [0.002, 0.003, 0] } },
    'nano-detectors': {
      distanceM: NANO_X,
      dy: NANO_TOP.y,
      build: () => nanoDetectors(),
      pinUp: 0.28,
      shot: { r: 0.69, dir: [0.75, 0.3, -0.45], target: [0, -0.25, 0] },
    },
    'pink-beam-stop-3dmn': { build: (c) => pinkBeamStop(c.beamY), pinUp: 0.4, shot: { r: 1.1, dir: [0.5, 0.5, -0.9] } },
    // ---------------------------------------------------------------- 34-ID-F (partner)
    'atomic-endstation': atomic(69.5),
  },
  enclosure: {
    '34-ID-A': { side: 0.3, widthM: 2.3 },
    '34-ID-B': { side: 0.5, widthM: 2.5 },
    '34-ID-C': { side: 0.9, widthM: 3.5 },
    '34-ID-E': { outline: OUTLINE_E },
    '34-ID-F': { outline: OUTLINE_F, heightM: F_HEIGHT },
  },
  // the engine's generic cones are replaced by custom ones (SDD acceptance cone, thin BCDI ray) in custom()
  scatter: [],
  people: [
    { x: 27.6, side: 2.35, rotY: Math.PI / 2, pose: 'stand' },
    // outside 34-ID-E (nobody stands in a hutch while the beam is on), at the user area by the micro station
    { x: 57.4, side: 2.45, rotY: Math.PI / 2, pose: 'point' },
  ],
  quietPins: [
    'atomic-revolver', 'fe-exit-collimator', 'atomic-wb-slits', 'w-collimator', 'pb-collimator-1', 'sc-1', 'atomic-mirror', 'sc-2',
    'diag-flag', 'shielded-transport-1', 'photon-mask-outboard', 'pb-collimator-brems-stop', 'atomic-dcm', 'atomic-kb1', 'bpm-3dmn',
    'atomic-transport-through-e', 'atomic-endstation', 'coded-aperture', 'nano-knife-edge',
  ],
  // from the infield (inboard) side, like ATOMIC (same sector) and the other exhibits: source on the left, beam flowing
  // left → right as on the subway map; sector 35's hutches in the foreground stay below the line at this elevation
  camera: { along: 0.6, side: -0.9, up: 0.62 },
  custom: (ctx) => custom(ctx),
};

function custom(ctx: BuildCtx): void {
  const g = ctx.group;
  const beamY = ctx.beamY;

  // ---- beams the engine does not draw: X-rays already flowing inside the U28, and the partner ATOMIC beam (dim, no pulses)
  const WHITE = new THREE.Color(1.0, 0.93, 0.82);
  g.add(fatLine([ctx.at(-2.25, 0), ctx.at(0, 0)], { color: WHITE, intensity: 1.7, width: 2.6 }));
  const atomicPts = (x0: number, x1: number) => {
    const pts: THREE.Vector3[] = [];
    for (let x = x0; x < x1; x += 1) pts.push(ctx.at(x, atomicSide(x)));
    pts.push(ctx.at(x1, atomicSide(x1)));
    return pts;
  };
  g.add(fatLine(atomicPts(0.15, 51.0), { color: WHITE, intensity: 0.85, width: 1.8, opacity: 0.7 }));
  g.add(fatLine(atomicPts(51.0, 69.5), { color: COLORS.xray, intensity: 1.2, width: 1.7, opacity: 0.7 }));
  // ATOMIC's own pink-beam shutter (SH-1) next to 3DMN's at 54.8 m (FDR Table 4.63)
  const sh1 = pinkShutter(beamY);
  sh1.position.copy(ctx.at(54.8, atomicSide(54.8)));
  g.add(sh1);
  // ATOMIC's shielded pipe passes through the nano enclosure (as drawn in FDR Fig. 4.58): sealed wall pass-throughs
  for (const x of [NANO_ENCL.x0 - 0.012, NANO_ENCL.x1 + 0.012]) {
    const collar = new THREE.Mesh(
      new THREE.RingGeometry(ATOMIC_PIPE.rOut + 0.002, ATOMIC_PIPE.rOut + 0.045, 32),
      // same see-through treatment as the ghosted partner pipe, so the collars read as part of it rather than floating rings
      new THREE.MeshStandardMaterial({ color: 0x9aa5b1, roughness: 0.4, metalness: 0.7, side: THREE.DoubleSide, transparent: true, opacity: 0.45, depthWrite: false }),
    );
    collar.rotation.y = Math.PI / 2;
    collar.position.copy(ctx.at(x, atomicSide(x)));
    g.add(collar);
  }

  // ---- micro station: base table + detector gantry, Laue rays, SDD acceptance cone, incoming flight tube
  const S = ctx.at(MICRO_X, ctx.sideAt('3dmn', MICRO_X));
  const base = baseAndGantry();
  base.position.copy(S);
  g.add(base);
  ctx.addPickable(base, 'micro-sample-stage');
  const rays = microRays();
  rays.position.copy(S);
  g.add(rays);
  const fl = fluorescenceCone();
  fl.position.copy(S);
  g.add(fl);
  const tube = flightTube(beamY, 55.15, MICRO_X - 0.52);
  tube.position.z = ctx.sideAt('3dmn', MICRO_X);
  g.add(tube);
  // close-up captions for the millimetre-scale parts around the sample (only shown when the camera is within ~0.5 m)
  const near = (text: string, o: THREE.Vector3) => ctx.addLabel(text, S.clone().add(o), { maxDist: 0.5 });
  near('Pt wire (×12)', N_SURF.clone().multiplyScalar(WIRE.h).addScaledVector(H_SCAN, 1.45 * WIRE.h).add(v(0, 0.004, -WIRE.half - 0.004)));
  near('sample, 45°', v(0.004, -0.008, 0.009));
  near('microscope', N_SURF.clone().multiplyScalar(MICROSCOPE.wd + 0.05).add(v(0, 0, 0.022)));
  near('coded aperture (parked)', CODED_ORIGIN.clone().add(v(0, 0.004, 0.016)));
  near('fluorescence detector', SDD.dir.clone().multiplyScalar(SDD.tip + 0.03).add(v(0, 0.018, 0)));
  // BCDI: one monochromatic Bragg reflection runs 2.2 m to the far-field detector (dashed: a single-colour mode)
  ctx.addBeam([S.clone(), S.clone().add(BCDI_LOCAL.clone().multiplyScalar(0.985))], 'mono', { width: 2.0, dashed: true, pulses: false, opacity: 0.9 });

  // ---- nano station: ultra-stable table and rays
  const Sn = ctx.at(NANO_X, ctx.sideAt('3dmn', NANO_X));
  const table = nanoTable();
  table.position.copy(Sn);
  g.add(table);
  ctx.addPickable(table, 'nano-sample-stage');
  const nrays = nanoRays();
  nrays.position.copy(Sn);
  g.add(nrays);

  // ---- the micro and nano instruments are used one at a time: the engine's pink beam ends in the micro sample (45°
  // reflection geometry); in nano mode the micro KB and sample stage retract and the beam runs on to 65.6 m (dashed).
  const PINK = new THREE.Color(1.0, 0.62, 0.78);
  g.add(fatLine([ctx.at(MICRO_X + 0.2, sideE), ctx.at(NANO_X, sideE)], { color: PINK, intensity: 1.3, width: 1.8, dashed: true, dashSize: 0.18, gapSize: 0.14, opacity: 0.75 }));
  // whatever the nano sample does not absorb (and the whole beam during alignment) ends in the pink beam stop at 66.9 m
  g.add(fatLine([ctx.at(NANO_X + 0.05, sideE), ctx.at(PINK_STOP_X - 0.17, sideE)], { color: PINK, intensity: 0.9, width: 1.4, dashed: true, dashSize: 0.1, gapSize: 0.12, opacity: 0.5 }));
}

export default layout;
