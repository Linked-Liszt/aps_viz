import * as THREE from 'three';
import type { BeamlineLayout, BuildCtx, CompOverride } from '../scene/beamline/layout';
import { fatLine } from '../scene/lines';
import { D3_DET, D4_DET, D6_X, D_DET_PARK, E, HALL_EXIT_X, M1_SEP, M1_X, MONO_OFFSET, ST1, ST2 } from './hexm/geom';
import { endStationRays, transports } from './hexm/context';
import {
  bcsTable, d2Platform, d3Rails, d3Tower, d4BackWall, entranceSlits, fixedStop, laserTracker, nearFieldDetector, sampleArea, saxsStation,
  steppedHutch, txmDetector, txmObjective, window5,
} from './hexm/endstation';
import {
  beamStopBlock, bentLaueMono, dEntrance, fastShutter, fourBounceMono, lensStack, maskCollimatorTrio, shieldBlock, slitBox, undulatorU21,
  wheelAttenuators, windowFlange,
} from './hexm/optics';
import { dDetector, htHedm } from './hexm/stations';

/**
 * HEXM — High-Energy X-ray Microscope, 20-ID (single straight branch, ~197 m to the final stop).
 *
 * Geometry (sources in ./hexm/geom.ts):
 * • No canting and no net deflection. The bent double-Laue monochromator M1 (29.5 m) shifts the monochromatic beam
 *   30 mm outboard (FDR: 25–35 mm), parallel to the white beam: the branch offset below is TRUE SCALE (not exaggerated);
 *   it ramps linearly-ish between the two Laue crystals, which sit 0.53 m apart at 70 keV (computed).
 * • 20-ID-A optics (26–36 m) → shielded pipe through the unused legacy 20-ID-B/C (drawn ghosted) → 20-ID-D (65–77 m,
 *   high-throughput HEDM) → 100 m shielded transport (out of the hall at ~91 m, through LOM 436 and the new corridor)
 *   → 20-ID-E in the Long Beamline Building (177.5–197.3 m), drawn with its true stepped outline from ESD-010.
 * • ONE consistent snapshot: 20-ID-E runs far-field HEDM (70 keV, Ni-base superalloy) while 20-ID-D passes the beam
 *   through (no sample on the HT-HEDM stage, its detector slid inboard, movable stop raised). In 20-ID-E: D3 6 m behind
 *   the sample on the 220 Debye ring, D4 on the back wall catching a single Bragg spot 16 m away, the transmitted beam to
 *   the SAXS detector D6 (engine beam, beamEndM); D1, D2 and the L7 objective retracted out of the beam, the HR-SMS parked
 *   inboard while the HL-SMS + load frame holds the sample. The dashed cone is the ESD design envelope (2θ = 17.8°) that
 *   sets the hutch's tall back half.
 */

const AX = MONO_OFFSET;
const MONO_START = M1_X - M1_SEP / 2;
const b = (fn: () => THREE.Object3D, pinUp: number, extra: CompOverride = {}): CompOverride => ({ build: fn, pinUp, ...extra });
const empty = () => new THREE.Group();

const layout: BeamlineLayout = {
  id: 'hexm',
  branches: {
    main: { side: MONO_OFFSET, divergeAtM: MONO_START, rampM: M1_SEP, label: '20-ID' },
  },
  monoAtM: MONO_START,
  // the transmitted beam runs on past the sample to the beamstop in front of the SAXS detector D6
  beamEndM: D6_X - 0.15,
  comp: {
    // ---------------------------------------------------------------- straight section (interim PM undulators)
    'u21-upstream': b((): THREE.Object3D => undulatorU21(1.4, { phaseShifterAt: 1.3 }), 1.0),
    'u21-revolver-downstream': b(() => undulatorU21(1.4, { revolver: true }), 1.0),
    // ---------------------------------------------------------------- ratchet wall / 20-ID-A
    'fe-exit-mask-window': b(() => {
      const g = new THREE.Group();
      g.add(shieldBlock({ len: 0.2, w: 0.24, h: 0.24, mat: 'copper', hole: 0.01 }));
      const w = windowFlange();
      w.position.x = 0.3;
      g.add(w);
      return g;
    }, 0.4),
    'fe-exit-collimator': b(() => shieldBlock({ len: 0.25, w: 0.34, h: 0.34, mat: 'tungsten', hole: 0.016 }), 0.4),
    'a-l1-wb-crl': b(() => lensStack({ n: 12, diamond: true, cooled: true }), 0.35),
    // hero: close-up from inboard and above so both bent crystals, their 0.53 m spacing and the stop between them read
    'a-m1-bent-laue-mono': b(() => bentLaueMono(), 0.85, { side: 0, shot: { r: 0.75, dir: [-0.05, 0.6, -0.95], target: [0, -0.04, 0.02] } }),
    'a-window-1': b(() => windowFlange({ diamond: true }), 0.25),
    'a-l2-collimating-lens': b(() => lensStack({ n: 6, diamond: true }), 0.35),
    // side view from inboard so the up-level-down path of the four reflections reads
    'a-m2-hr-mono': b(() => fourBounceMono(), 0.5, { shot: { r: 0.8, dir: [-0.04, 0.14, -1], target: [0, 0.015, 0] } }),
    'a-attenuators-foils': b(() => wheelAttenuators(), 0.4),
    'a-slits-s2': b(() => slitBox(), 0.3),
    'a-l3-lens': b(() => lensStack({ n: 10, diamond: true }), 0.35),
    'a-mask-collimator': b(() => maskCollimatorTrio(), 0.4),
    // ---------------------------------------------------------------- transports (drawn in custom; pins where the story is)
    'transport-st1': b(empty, 0.45, { distanceM: 52.0, shot: { r: 6.5, dir: [-0.6, 0.75, -1] } }),
    // ---------------------------------------------------------------- 20-ID-D (pass-through state, see header)
    'd-entrance': b(() => dEntrance(), 0.4),
    'd-slits-s3': b(() => slitBox(), 0.3),
    'd-fast-shutter': b(() => fastShutter(), 0.3),
    'd-l4': b(() => lensStack({ n: 16 }), 0.35),
    'd-slits-s4': b(() => slitBox(), 0.3),
    'd-ht-hedm': b(() => htHedm({ idle: true }), 0.45),
    'd-detector': b(() => dDetector(), 0.45, { side: AX + D_DET_PARK }),
    'd-slits-s5': b(() => slitBox(), 0.3),
    'd-l5': b(() => lensStack({ n: 6 }), 0.35),
    // open (lifted) so the beam continues to 20-ID-E
    'd-beamstop': b(() => beamStopBlock({ lift: 0.34 }), 0.95, { shot: { r: 1.8 } }),
    'transport-st2': b(empty, 0.45, { distanceM: HALL_EXIT_X + 4, shot: { r: 6, dir: [0.7, 0.6, -1], target: [-3, 0, 0] } }),
    // ---------------------------------------------------------------- 20-ID-E
    'e-wb-slits': b(() => entranceSlits(), 0.3),
    'e-bcs-l6': b(() => bcsTable(), 0.32),
    'e-window-5': b(() => window5(), 0.2),
    'e-sample-sms': b(() => sampleArea(), 0.55, { shot: { r: 1.7, target: [0, 0.15, 0] } }),
    'e-d1-nf-imaging': b(() => nearFieldDetector(), 0.2, { side: AX + 0.12 }),
    'e-d2': b(() => d2Platform(), 0.42, { side: AX - 0.8 }),
    'e-l7-txm': b(() => txmObjective(), 0.12),
    // seen from upstream, inboard and above, so the tower, the arm and the detector face catching the 220 ring are in view
    'e-d3-dms': b(() => d3Tower(), 0.45, { distanceM: D3_DET.x, side: AX + D3_DET.side, dy: D3_DET.up, shot: { r: 2.95, dir: [-2.7, 1.2, -2.7], target: [0.2, -0.17, 0.85] } }),
    'e-d6-saxs': b(() => saxsStation(), 0.35),
    'e-d5-txm-detector': b(() => txmDetector(), 0.35, { side: AX - 1.3 }),
    'e-d4-backwall': b(() => d4BackWall(), 0.35, { distanceM: D4_DET.x, side: AX + D4_DET.side, dy: D4_DET.up, shot: { r: 3.2, dir: [-1, 0.15, 0.45], target: [0, -0.8, 0] } }),
    'e-fixed-stop': b(() => fixedStop(), 0.45, { distanceM: 196.95 }),
  },
  enclosure: {
    '20-ID-A': { side: 0, widthM: 3.4 },
    // unused legacy hutches the shielded pipe passes through: outline only (not drawn in the APS overview)
    '20-ID-B (legacy, unused)': { style: 'ghost' },
    '20-ID-C (legacy, unused)': { style: 'ghost' },
    // engine box hidden in custom() (true stepped outline drawn instead); these values set the overview box and the label
    '20-ID-E': { side: AX, widthM: E.narrowW, heightM: E.narrowH },
    // inboard wing of the LBB beside the low part of 20-ID-E (site footprint; approx)
    'Activated Materials Laboratory (AML)': { side: -10.6, widthM: 10.6, heightM: 3.3, style: 'room' },
    // outboard, between HEXM and ISN (2019 plan; approx)
    '20-ID-E control room and sample-prep area': { side: 7.0, widthM: 4.4, heightM: 3.0, style: 'room' },
  },
  // 20-ID-D is in pass-through, so no sample→detector cone there; the 20-ID-E rays are drawn in custom()
  scatter: [],
  // scale figures, all OUTSIDE the interlocked hutches (beam is on in 20-ID-D and -E): outboard aisle of 20-ID-A,
  // outboard of 20-ID-D, and at the outboard 20-ID-E doorway pointing in at the instruments
  people: [
    { x: 30.6, side: 2.5, rotY: Math.PI },
    { x: 70.6, side: 3.3, rotY: 0 },
    { x: 184.4, side: 4.15, rotY: 0, pose: 'point' },
  ],
  // distance ruler inboard, clear of the 20-ID-E narrow walls (±3.4 m) and the AML (from −5.3 m)
  rulerSide: -4.4,
  quietPins: [
    'fe-exit-collimator', 'a-wb-filters', 'a-hhl-slits', 'a-window-1', 'a-attenuators-foils', 'a-slits-s2', 'a-mask-collimator', 'a-shutter',
    'd-entrance', 'd-slits-s3', 'd-fast-shutter', 'd-slits-s4', 'd-slits-s5', 'e-wb-slits', 'e-window-5', 'e-fixed-stop',
  ],
  camera: { along: 0.5, side: -2.8, up: 0.8 },
  custom: (ctx) => custom(ctx),
};

function custom(ctx: BuildCtx): void {
  const g = ctx.group;
  // X-rays already flowing inside the upstream undulator
  g.add(fatLine([ctx.at(-2.475, 0), ctx.at(0, 0)], { color: new THREE.Color(1.0, 0.93, 0.82), intensity: 1.7, width: 2.6 }));

  // long transports, hall-wall sleeve, corridor strip, context labels
  transports(ctx);

  // 20-ID-E: true stepped outline instead of the engine's single box (its label is kept)
  const engineE = g.getObjectByName('enclosure-20-ID-E');
  if (engineE) engineE.visible = false;
  g.add(steppedHutch());
  g.add(d3Rails());
  g.add(laserTracker(183.0, AX - 2.6));
  endStationRays(ctx, ctx.color);

  // make the long pipes pick their component cards
  for (const [id, x0, x1] of [['transport-st1', ST1.x0, ST1.x1], ['transport-st2', ST2.x0, ST2.x1]] as const) {
    const hit = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, 0.5, 0.5), new THREE.MeshBasicMaterial({ visible: false }));
    hit.position.set((x0 + x1) / 2, 0, AX);
    g.add(hit);
    ctx.addPickable(hit, id);
  }
}

export default layout;
