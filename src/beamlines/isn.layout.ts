import * as THREE from 'three';
import type { BeamlineLayout, BuildCtx, CompOverride } from '../scene/beamline/layout';
import {
  BEAM_YAW, BRANCH, C_OUTLINE, D_OUTLINE, E, FOE_OUTLINE, HALL_EXIT_X, KBH, KBV, KB_EXIT, LBB_X, PTYCHO, PUMPS, ROOMS, SAMPLE_X, SE, ST2, TABLE, XRD, XRF,
  beamSide,
} from './isn/geom';
import { exitMask, frontEndTrain, phaseShifter, ratchetWall, revolverUndulator, shieldBlock } from './isn/source';
import { bdaAssembly, dmmGhost, horizontalDcm, m1Tank, m2Bender, m3Mirror, shieldedSpan, whiteBeamStop } from './isn/optics';
import { airSocks, concreteHutch, corridor, hallWall, lbbWing, longTransport, pumpStation, transportHit } from './isn/transport';
import {
  beamstop, conditioning, electrometer, exitWindow, fastShutter, filterBox, fluorescenceDetectors, inSituCell, inlineMicroscope, kbChamberAndKBV,
  kbhOnGantry, pinhole, ptychoTable, robotXrd, sampleChamberAndStack,
} from './isn/endstation';

/**
 * ISN — In Situ Nanoprobe, 19-ID (single branch, ~227 m from the source to the beamstop).
 *
 * Geometry (sources and derivations in ./isn/geom.ts):
 * • Two in-line revolver undulators (not canted). Vertical dogleg in 19-ID-A: M1 (28 m) reflects down, M2 (29 m) back up
 *   (net −5 mm, too small to draw: the mirrors simply sit above / below the beam). The DCM/DMM are horizontal and
 *   fixed-exit (their few-mm offset is unpublished and drawn as zero).
 * • M3 (35 m) turns the beam 5 mrad INBOARD: drawn as a true straight-line deflection (engine angleMrad, NOT exaggerated),
 *   reaching −0.925 m at 220 m. Parts downstream of M3 are yawed 5 mrad to stay coaxial. Hutches C, D and E, the
 *   transport, the corridor and the LBB footprint are all placed relative to this axis.
 * • Hutch outlines: 19-ID-A, -C, -D scaled from the NIMA 2020 plan (±0.1–0.3 m); 19-ID-E 14.6 × 6.6 m inside, 0.3 m
 *   concrete (drawn cut at 1.1 m), roof 2.8 m above the beam; support rooms inboard (LBB footprint from site.json).
 * • The 147 m transport is drawn in full (cut-away lead jacket, supports every ~3 m, the four shielded pump stations);
 *   it leaves the hall at ~91 m (computed from the hall radius) and runs in an enclosed corridor to the LBB at ~201 m.
 * • Endstation (MEDSI'25): KBV 404 mm reflecting up, KBH 129 mm (side not published: mirror drawn outboard, turning the
 *   beam inboard), 61 mm working distance;
 *   7-element SDD at 90° outboard in the horizontal plane; backscatter SDD above-inboard-upstream (angle approx.);
 *   EIGER2 X 1M on the TX2-160L robot along the Be-dome axis (10° up, 25° outboard) at 0.62 m; ptychography EIGER at
 *   223 m (mid-travel of its 6 m table). Sub-millimetre optics (BDA gaps, mirror faces) are enlarged where noted.
 */

const b = (fn: (ctx: BuildCtx) => THREE.Object3D, pinUp: number, extra: CompOverride = {}): CompOverride => ({ build: fn, pinUp, ...extra });
/** downstream of M3 every part is yawed 5 mrad so its pipes stay coaxial with the turned beam */
const Y = { rotY: BEAM_YAW };
const empty = () => new THREE.Group();
const at = (x: number) => ({ distanceM: x });

const layout: BeamlineLayout = {
  id: 'isn',
  branches: { main: BRANCH },
  beamEndM: SAMPLE_X,
  rulerSide: 5.2,
  // tunnel shield face = 19-ID-A upstream wall (~23.9 m, NIMA 2020 plan scaled); matches the slab drawn in custom()
  ratchetFaceM: 23.85,
  enclosureDefaults: { heightM: 3.3 },
  comp: {
    // ---------------------------------------------------------------- straight section
    // close-ups from inboard-above: the outboard side of the straight is the tunnel wall, which blocks the default view
    'undulator-us-aps21r25-1': b(() => revolverUndulator(), 0.95, { shot: { r: 3.3, dir: [-0.72, 0.36, -0.6], target: [1.0, -0.1, 0] } }),
    'phase-shifter': b(() => phaseShifter(), 0.4, { shot: { r: 1.6, dir: [-0.5, 0.45, -0.75] } }),
    'undulator-ds-aps21r25-2': b(() => revolverUndulator(), 0.95, { shot: { r: 3.3, dir: [-0.72, 0.36, -0.6], target: [-0.6, -0.1, 0] } }),
    // ---------------------------------------------------------------- front end (tunnel) + ratchet wall
    'hhl-front-end': b(() => {
      const g = frontEndTrain(20.0);
      g.add(ratchetWall(20.0));
      return g;
    }, 0.95, { pinPriority: 2.5, shot: { r: 3.6, dir: [-0.45, 0.55, 0.8], target: [-1.6, 0.1, 0] } }),
    // ---------------------------------------------------------------- 19-ID-A (FOE)
    'fe-exit-mask': b(() => exitMask(), 0.42),
    'fe-exit-collimator': b(() => shieldBlock({ len: 0.25, w: 0.28, h: 0.28, mat: 'tungsten', hole: 0.008 }), 0.38),
    'wb-slits': { pinUp: 0.38 },
    // low outboard view through the tank wall: M1 hangs face-down above the white beam, M2 sits face-up below the pink beam
    'm1-hhl-mirror': b(() => m1Tank(), 0.62, { shot: { r: 1.55, dir: [-0.2, 0.38, 1], target: [0.5, -0.05, 0] } }),
    'm2-pink-mirror': b(() => m2Bender(), 0.5),
    // FDR lists PM-1 and SC-1 together at 29.7 m (one assembly): drawn 0.2 m apart so both read
    'pm1-wb-stop': b(() => whiteBeamStop(), 0.36, at(29.66)),
    'secondary-brems-collimator': b(() => shieldBlock({ len: 0.18, w: 0.34, h: 0.34, mat: 'lead', hole: 0.014 }), 0.4, at(29.88)),
    'bd1-flag': { pinUp: 0.3, distanceM: 30.12 },
    'pink-slits-sl2': { pinUp: 0.35 },
    dcm: b(() => horizontalDcm(), 1.05, { shot: { r: 1.4, dir: [-0.45, 0.75, 0.55] } }),
    dmm: b(() => dmmGhost(), 0.55),
    'pm2-mask': b(() => shieldBlock({ len: 0.15, w: 0.22, h: 0.22, mat: 'copper', hole: 0.01 }), 0.35),
    bc1: b(() => shieldBlock({ len: 0.2, w: 0.36, h: 0.36, mat: 'lead', hole: 0.016 }), 0.4),
    'pink-slits-sl3': { pinUp: 0.35 },
    // from inboard, steeply above (clear of the tank's lid rim): the Pt face points inboard, so the beam is seen skimming it
    'm3-horizontal-mirror': b(() => m3Mirror(), 0.42, { shot: { r: 1.15, dir: [-0.35, 0.8, -0.5] } }),
    // ---------------------------------------------------------------- transport + aperture hutches
    'transport-a-to-c': b(() => shieldedSpan(-6.2, 6.2), 0.3, Y),
    'pm3-bc2': b(() => {
      const g = new THREE.Group();
      const m = shieldBlock({ len: 0.15, w: 0.22, h: 0.22, mat: 'copper', hole: 0.01 });
      m.position.x = -0.2;
      const c = shieldBlock({ len: 0.2, w: 0.4, h: 0.4, mat: 'lead', hole: 0.016 });
      c.position.x = 0.2;
      g.add(m, c);
      return g;
    }, 0.42, Y),
    'bda-v': b(() => bdaAssembly('v'), 0.62, { ...Y, pinPriority: 3, shot: { r: 1.25, dir: [-0.55, 0.5, 0.7] } }),
    'bda-h': b(() => bdaAssembly('h'), 0.62, { ...Y, pinPriority: 3, shot: { r: 1.25, dir: [-0.55, 0.5, 0.7] } }),
    'photon-shutter-sh1': { ...Y, pinUp: 0.85 },
    'long-transport': b(empty, 0.45, { pinPriority: 2.5, shot: { r: 4.5, dir: [-0.5, 0.5, 0.75], target: [-15, -0.3, 0] } }),
    // ---------------------------------------------------------------- 19-ID-E (Long Beamline Building)
    'exit-window': b(() => exitWindow(), 0.5, Y),
    filters: b(() => filterBox(), 0.42, Y),
    'beam-conditioning': b(() => conditioning(214.5), 0.42, Y),
    'fast-shutter': b(() => fastShutter(), 0.35, Y),
    // from above-inboard, looking down onto the 404 mm mirror face, its two pitch flexures and the interferometer heads
    'kb-vertical': b(() => kbChamberAndKBV(), 0.62, { ...Y, distanceM: KBV.x, pinPriority: 3.5, shot: { r: 0.8, dir: [-0.15, 0.85, -0.5], target: [0.1, -0.03, 0] } }),
    // from upstream-inboard-above, under the gantry: the beam skimming the 129 mm face, the pinhole and the sample 61 mm on
    'kb-horizontal': b(() => kbhOnGantry(), 0.78, { ...Y, distanceM: KBH.x, shot: { r: 0.4, dir: [-0.57, 0.51, -0.64], target: [-0.015, 0, 0] } }),
    'kb-pinhole': b(() => pinhole(), 0.12, Y),
    'inline-microscope': b(() => inlineMicroscope(), 0.95, { ...Y, distanceM: 219.972 }),
    // the MEDSI'25 Fig. 4 viewpoint: from the inboard (control-room) side, a little above the beam; KB chamber left, 7-element SDD behind
    'sample-stage': b((c) => sampleChamberAndStack(c.color), 0.62, { ...Y, pinPriority: 3.5, shot: { r: 1.4, dir: [0.05, 0.6, -0.8], target: [0, 0.03, 0.15] } }),
    'in-situ-cells': b(() => inSituCell(), 0.16, { ...Y, shot: { r: 0.32, dir: [-0.2, 0.4, -0.9] } }),
    'xrf-detectors': b(() => fluorescenceDetectors(), 0.33, {
      side: SE + XRF.bodyCentre,
      // from above, downstream-inboard: the sample, the snout at 90° through the chamber wall and the SDD body outside it
      shot: { r: 1.1, dir: [0.45, 0.8, -0.4], target: [0, -0.03, -0.25] },
    }),
    'xbic-electrometer': b(() => electrometer(), 0.18, { distanceM: 220.28, side: SE - 0.42, dy: TABLE.base + 0.022 }),
    'xrd-detector-robot': b((c) => robotXrd(c.color), 0.3, { distanceM: XRD.x, side: XRD.side, dy: XRD.up, shot: { r: 2.0, dir: [-0.1, 0.5, -0.86], target: [0.15, -0.2, 0.35] } }),
    'ptycho-detector': b((c) => ptychoTable(c.color), 0.32, { ...Y, shot: { r: 3.0, dir: [-0.35, 0.45, -0.82], target: [0.4, -0.4, 0] } }),
    beamstop: b(() => beamstop(), 0.3, Y),
  },
  enclosure: {
    '19-ID-A': { outline: FOE_OUTLINE },
    '19-ID-C': { outline: C_OUTLINE },
    '19-ID-D': { outline: D_OUTLINE },
    // overview box for the corridor; the engine's single straight pipe is replaced in custom() by the drawn transport
    'Long transport corridor': { widthM: 3.0 },
    // outer shell of the concrete hutch (inner 14.6 × 6.6 m + 0.3 m walls; roof 2.8 m above the beam + 0.3 m)
    // style given explicitly: the role text mentions 'Building', which the engine would otherwise read as a transport
    '19-ID-E': {
      style: 'hutch',
      startM: E.x0 - E.wall,
      endM: E.x1 + E.wall,
      side: SE + (E.out + E.in) / 2,
      widthM: E.out - E.in + 2 * E.wall,
      heightM: 1.4 + E.roof + E.wall,
    },
    '19-ID-E control & support rooms': { style: 'room', side: (ROOMS.z0 + ROOMS.z1) / 2, widthM: ROOMS.z1 - ROOMS.z0, startM: ROOMS.x0, endM: ROOMS.x1 },
  },
  scatter: [
    // far-field ptychography / SAXS: EIGER2 X 1M (77 × 80 mm) 3 m downstream → half-angle ≈ 13 mrad
    { from: 'sample-stage', to: 'ptycho-detector', spread: 0.013, kind: 'cone' },
    // diffraction through the Be dome into the robot-held EIGER (0.62 m) → half-angle ≈ 0.065
    { from: 'sample-stage', to: 'xrd-detector-robot', spread: 0.065, kind: 'cone' },
    // fluorescence into the 7-element SDD snout (90°, outboard, in the horizontal plane)
    { from: 'sample-stage', to: 'xrf-detectors', spread: 0.035, kind: 'fluorescence' },
  ],
  people: [
    { x: 31.0, side: 2.3, rotY: Math.PI, pose: 'stand' },
    { x: 62.0, side: 1.9, rotY: Math.PI / 2, pose: 'point' },
    { x: 220.9, side: SE - 1.25, rotY: -Math.PI / 2, pose: 'stand' },
  ],
  quietPins: [
    'phase-shifter', 'fe-exit-collimator', 'wb-slits', 'pm1-wb-stop', 'secondary-brems-collimator', 'bd1-flag', 'pink-slits-sl2', 'pm2-mask', 'bc1',
    'pink-slits-sl3', 'transport-a-to-c', 'pm3-bc2', 'exit-window', 'filters', 'fast-shutter', 'kb-pinhole', 'xbic-electrometer',
  ],
  camera: { along: 0.5, side: -1, up: 0.66, distanceScale: 1.3 },
  custom: (ctx) => custom(ctx),
};

function custom(ctx: BuildCtx): void {
  const g = ctx.group;
  // X-rays already flowing inside the upstream undulator (the engine beam starts at the source point)
  ctx.addBeam([ctx.at(-2.43, 0), ctx.at(0, 0)], 'white', { pulses: false });

  // ---- the long transport: replace the engine's single straight pipe by the drawn, drifting, shielded line
  const engineST2 = g.getObjectByName('enclosure-Long transport corridor');
  if (engineST2) engineST2.visible = false;
  g.add(longTransport(ST2.x0 + 0.35, E.x0 + 0.03, 0)); // runs through the 0.3 m hutch wall to the window flange
  for (const x of PUMPS) g.add(pumpStation(x));
  g.add(hallWall(), corridor(), lbbWing());
  transportHit(ctx, 'long-transport');

  // ---- 19-ID-E: concrete walls (cut), isolated slab joint, air socks
  g.add(concreteHutch(), airSocks());

  // ---- direct (forward) beam from the focus to the ptychography detector, tipped 5 mrad up and 5 mrad inboard by the KB pair
  ctx.addBeam([ctx.at(SAMPLE_X + 0.002, SE), ctx.at(PTYCHO.detX - 0.003, beamSide(PTYCHO.detX) + 3 * KB_EXIT.side, 3 * KB_EXIT.up)], 'mono', { width: 1.6, pulses: false, opacity: 0.85 });

  // ---- context labels
  const lbl = (text: string, x: number, side: number, up: number, maxDist = 90) => ctx.addLabel(text, ctx.at(x, side, up), { maxDist });
  lbl('Leaves the experiment hall (~91 m)', HALL_EXIT_X + 0.8, beamSide(HALL_EXIT_X) - 1.0, 1.2);
  lbl('Enclosed corridor through the lab/office area', 140, beamSide(140) - 1.2, 0.4, 120);
  lbl('Shielded ion-pump station', PUMPS[1] + 0.6, beamSide(PUMPS[1]) + 0.6, 0.6, 30);
  lbl('Long Beamline Building (Bldg 444)', LBB_X + 2.0, -1.4, 7.8, 160);
  lbl('1 m isolated slab · supply air socks (±0.05 °C)', E.x1 - 2.2, SE + E.in + 1.0, E.roof - 0.1, 40);
}

export default layout;
