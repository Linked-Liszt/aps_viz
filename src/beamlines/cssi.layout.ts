import * as THREE from 'three';
import type { BeamlineLayout, BuildCtx } from '../scene/beamline/layout';
import { fatLine } from '../scene/lines';
import { COLORS } from '../scene/palette';
import {
  ALPHA, CSSI_LIFT, CSSI_X, D_TABLE, DET_X, EIGER, END_STOP_X, GIXS_GRANITE, GIXS_X, KB_GRANITE, MMPAD, MMPAD_X, PILATUS, TUBE,
  TUBE_PIN_X,
} from './cssi/geom';
import { cone, faceMaterial, leader, magnifier, magnifierCaption } from './cssi/hero';
import { flangeX, pipeX, shadowed } from './cssi/kit';
import {
  compactShutter, dualApertureMask, fastShutter, frontEndTrain, hdcm, kbChamber, pinkBeamStop, ratchetWall, shieldBlock, transfocator,
  transportSupports,
} from './cssi/optics';
import { emptySlot, revolverUndulator } from './cssi/source';
import { cssiChamber, gixsDiffractometer, granites, hexapod, pilatusOnMotion, stationTables, tubeEntrance, wavefrontSensor } from './cssi/station';
import { eigerOnCarriage, endStop, grandTube, mmPad } from './cssi/tube';

/**
 * 9-ID CSSI is Coherent Surface Scattering Imaging. It is one non-canted ID line with a revolver undulator
 * in the downstream slot and an empty upstream slot. The component sequence follows → windowless HHL front end → 9-ID-A FOE (two horizontally deflecting mirrors, horizontal
 * LN2 DCM) → shielded transport → 9-ID-MH mini-hutch (pink stop, XBPM, CRL-1) → 9-ID-D (CRL-2, KB, CSSI solid-sample
 * chamber, GI-XPCS hexapod, GIXS diffractometer + Pilatus) → 9-ID-GT "Grand Tube" (2.75 m × ~20.5 m walk-in vacuum
 * vessel with the EIGER 16M and MM-PAD on a carriage, 2.9–21.8 m from the CSSI sample).
 *
 * Geometry notes:
 * • Distances are from the centre of the ID straight (FDR convention). Exact: CSSI sample 54.992 m, GIXS 56.590 m,
 *   XBPMs 42.38 / 53.43 m; everything else ±1 m from FDR tables and the as-built isometrics (see the dossier).
 * • Single beam axis, no engine branches. The MR-1/MR-2 periscope offset is about 17 mm, and the HDCM offset is about
 *   10 mm outboard. These offsets are not visible at hall scale and are omitted. MR-1 is drawn
 *   deflecting outboard and MR-2 returning the beam (the sense is undocumented). The HDCM crystal offset inside its tank
 *   is drawn 30 mm (×3) so the double bounce is legible at close range.
 * • Hero: the CSSI sample stands ON EDGE (vertical surface, horizontal scattering plane) at the true α = 0.5°, so the
 *   specular reflection leaves at 2α = 1° and lands |SPEC_SIDE| ≈ 0.35 m to the side on the MM-PAD at 20 m (true
 *   geometry; the chip is drawn facing inboard, toward the cameras, though the real side is not documented). A floating
 *   magnifier above the chamber repeats the geometry with the chip ×8 and the angles ×24.
 * • Grand Tube: light-grey vessel with a museum cut-away window (upper-inboard quadrant, 63.2–76.9 m, faint skin keeps
 *   the silhouette); axis 0.2 m above the beam (unpublished) so the vessel clears its saddles; four flanged sections,
 *   stiffener rings, dished heads. Carriage arrangement is illustrative (mounting and travel ranges are not published):
 *   MM-PAD on the specular spot 0.45 m ahead of the EIGER 16M, which sits further inboard at larger exit angles. The end
 *   stop is drawn at 77.45 m, just inside the downstream head (FDR 78.0 m = head apex).
 * • Stations run one at a time; the beam is drawn through the CSSI chamber to the GIXS sample (the engine ends it at the
 *   last sample position), then continues as the direct beam to the end stop.
 * • Close-ups use comp.shot so every anchor stays at its true position: the CSSI shot aims CSSI_LIFT above the sample
 *   (chamber + magnifier in one frame); the Grand Tube pin sits on its crown at 59 m (over the vessel, not on the head
 *   apex) and its shot looks in through the cut-away window; tunnel components (front end, ratchet wall) are viewed
 *   from the outboard / 9-ID-A side so the storage-ring magnets beside them do not fill the frame.
 * • Front end: drawn as a train in the documented element order (FDR Ch. 3); 9-ID element positions are unpublished,
 *   so the spacing (15.8–21.9 m, XBPM1 on the 19.4 m anchor) is illustrative. The ratchet-wall face is drawn
 *   asymmetric (0.85 m inboard, 1.8 m outboard) so it meets the site's tunnel wall and stays clear of the ring magnets.
 * • Small 3D-only nudges of ±1 m estimates to avoid overlaps: PH-1 at 42.95 m (dossier 43.0 m); MM-PAD at 74.55 m
 *   (dossier 75.0 m, same carriage).
 */

const TUBE_TOP = TUBE.axisY + TUBE.r + TUBE.wall;

const layout: BeamlineLayout = {
  id: 'cssi',
  enclosureDefaults: { heightM: 3.3 },
  enclosure: {
    '9-ID-A': { widthM: 3.4 },
    'Shielded transport': { widthM: 0.5 },
    '9-ID-MH': { widthM: 2.0, heightM: 2.6 },
    'Shielded transport (MH–D)': { widthM: 0.5 },
    '9-ID-D': { widthM: 4.4, heightM: 3.4 },
    // engine box is hidden in custom(); this only places the label above the tube
    '9-ID-GT (Grand Tube)': { widthM: 2.75, heightM: 3.25 },
  },
  comp: {
    // ---------------------------------------------------------------- straight section
    'us-id-slot': { build: (c) => emptySlot(c.beamY), pinUp: 0.55, shot: { r: 5.5 } },
    'revolver-undulator': { build: (c) => revolverUndulator(c.beamY), pinUp: 0.85 },
    'hhl-front-end': {
      build: (c) => frontEndTrain(c.beamY, 19.4),
      pinUp: 0.6,
      shot: { r: 3.2, dir: [-0.35, 0.55, 0.95], target: [0.4, -0.2, 0] },
    },
    'ratchet-wall': {
      build: (c) => ratchetWall(c.beamY),
      pinUp: 0.75,
      // from inside 9-ID-A, looking back at the penetration where the X-rays enter the hall
      shot: { r: 3.6, dir: [0.8, 0.42, 0.62], target: [1.4, -0.3, 0.1] },
    },
    // ---------------------------------------------------------------- 9-ID-A (FOE)
    'fe-exit-mask': { build: (c) => shieldBlock({ beamY: c.beamY, len: 0.3, mat: 'copper', water: true }), pinUp: 0.45 },
    'fe-exit-collimator': { build: (c) => shieldBlock({ beamY: c.beamY, len: 0.3, w: 0.3, h: 0.3, mat: 'tungsten' }), pinUp: 0.4 },
    'sl-1': { pinUp: 0.4 },
    'mr-1': { props: { lengthM: 0.6 }, pinUp: 0.55 },
    'sc-1': { build: (c) => shieldBlock({ beamY: c.beamY, len: 0.18, w: 0.34, h: 0.34, mat: 'lead', hole: 0.02 }), pinUp: 0.4 },
    'bd-1': { pinUp: 0.35 },
    'pm-1': { build: (c) => shieldBlock({ beamY: c.beamY, len: 0.16, mat: 'copper', water: true }), pinUp: 0.4 },
    'pm-2-damm': { build: (c) => shieldBlock({ beamY: c.beamY, len: 0.14, w: 0.2, h: 0.2, mat: 'copper', water: true, hole: 0.008 }), pinUp: 0.4 },
    'sc-2': { build: (c) => shieldBlock({ beamY: c.beamY, len: 0.18, w: 0.34, h: 0.34, mat: 'lead', hole: 0.02 }), pinUp: 0.4 },
    'mr-2': { rotY: Math.PI, props: { lengthM: 0.6 }, pinUp: 0.55 },
    'pm-3': { build: (c) => shieldBlock({ beamY: c.beamY, len: 0.14, w: 0.2, h: 0.2, mat: 'copper', water: true }), pinUp: 0.4 },
    'bd-2': { pinUp: 0.35 },
    'pm-4': { build: (c) => shieldBlock({ beamY: c.beamY, len: 0.14, w: 0.2, h: 0.2, mat: 'copper', water: true }), pinUp: 0.4 },
    'bc-1': { build: (c) => shieldBlock({ beamY: c.beamY, len: 0.2, w: 0.32, h: 0.32, mat: 'tungsten', hole: 0.02 }), pinUp: 0.4 },
    'sl-2': { pinUp: 0.4 },
    'mn-1': { build: (c) => hdcm(c.beamY), pinUp: 1.25, shot: { r: 2.7, target: [0, 0.3, 0.1] } },
    'pm-5': { build: (c) => dualApertureMask(c.beamY), pinUp: 0.4 },
    'transport-a-mh': { build: (c) => transportSupports(c.beamY, 39.0, [37.7, 39.2, 40.7], [36.9, 41.5]), pinUp: 0.4 },
    // ---------------------------------------------------------------- 9-ID-MH (mini-hutch)
    'bs-2': { build: (c) => pinkBeamStop(c.beamY), pinUp: 0.45 },
    'bd-3-xbpm1': { pinUp: 0.35 },
    'sl-3': { pinUp: 0.4 },
    'ph-1': { distanceM: 42.95, build: (c) => compactShutter(c.beamY), pinUp: 0.55 },
    'rl-1-crl1': { build: (c) => transfocator(c.beamY, 9, [6, 8]), pinUp: 0.45 },
    'bd-4': { pinUp: 0.35 },
    'sh-1': { pinUp: 0.75 },
    // ---------------------------------------------------------------- 9-ID-D
    'bi-8-fast-shutter': { build: () => fastShutter(D_TABLE.top), pinUp: 0.25 },
    'at-1': { props: { beamY: -D_TABLE.top }, pinUp: 0.5 },
    'sl-4': { pinUp: 0.4 },
    'rl-2-crl2': { build: (c) => transfocator(c.beamY, 10, [2, 7, 9]), pinUp: 0.45 },
    'sl-5': { props: { beamY: 0.25 }, pinUp: 0.4 },
    'bd-5-xbpm2': { props: { beamY: 0.25 }, pinUp: 0.35 },
    'mr-3-kb': { build: () => kbChamber(KB_GRANITE.top), pinUp: 0.5 },
    'wn-1': { props: { beamY: -KB_GRANITE.top }, pinUp: 0.25 },
    // true anchor at the sample; the close-up aims CSSI_LIFT higher so chamber and magnifier share the frame
    'bi-2-cssi-sss': { build: (c) => cssiStation(c), pinUp: CSSI_LIFT + 0.12, shot: { r: 1.35, target: [0, CSSI_LIFT, 0] } },
    'bd-6-wavefront': { build: () => wavefrontSensor(KB_GRANITE.top), pinUp: 0.3 },
    'hexapod-gixpcs': { build: () => hexapod(GIXS_GRANITE.stat.top), pinUp: 0.3 },
    'gixs-diffractometer': { build: () => gixsDiffractometer(GIXS_GRANITE.trans.top), pinUp: 0.4 },
    'pilatus-1mf-waxs': {
      side: PILATUS.side,
      dy: PILATUS.up,
      build: (c) => pilatusOnMotion(c.beamY + PILATUS.up, faceMaterial('pilatus')),
      pinUp: 0.3,
    },
    // ---------------------------------------------------------------- 9-ID-GT (Grand Tube)
    // anchor (pin + close-up target) on the crown of the tube near its upstream end: the close-up then looks down the
    // length of the vessel; the vessel itself is built at its true position below the anchor
    'grand-tube': {
      distanceM: TUBE_PIN_X,
      dy: TUBE_TOP,
      build: (c) => {
        const g = new THREE.Group();
        const t = grandTube(c.beamY, TUBE_PIN_X);
        t.position.y = -TUBE_TOP;
        g.add(t);
        return g;
      },
      pinUp: 0.22,
      // the whole vessel from inboard-above, looking in through the cut-away window (upper-inboard quadrant,
      // 63.2–76.9 m) at the deck, the carriage and the detectors
      shot: { r: 11.3, dir: [-0.57, 0.46, -0.64], target: [DET_X - 6.0 - TUBE_PIN_X, -0.2 - TUBE_TOP, 0] },
    },
    'eiger-16m': { side: EIGER.side, build: () => eigerOnCarriage(faceMaterial('eiger')), pinUp: 0.4 },
    // 3D-only nudge: 0.45 m ahead of the EIGER on the same carriage (dossier position 75.0 m; mounting unpublished)
    'mm-pad': { distanceM: MMPAD_X, side: MMPAD.side, build: () => mmPad(faceMaterial('mmpad')), pinUp: 0.2 },
    'end-beamstop': { distanceM: END_STOP_X, build: (c) => endStop(c.beamY), pinUp: 0.3 },
  },
  scatter: [
    // (the CSSI cones are drawn in custom(): they need a sub-5 cm specular cone and a fainter speckle cone)
    // GIWAXS from a film lying flat on the GIXS diffractometer onto the in-air Pilatus
    { from: 'gixs-diffractometer', to: 'pilatus-1mf-waxs', spread: 0.2, kind: 'cone' },
  ],
  quietPins: [
    'fe-exit-collimator', 'sc-1', 'bd-1', 'pm-1', 'pm-2-damm', 'sc-2', 'pm-3', 'bd-2', 'pm-4', 'bc-1', 'sl-2', 'pm-5',
    'transport-a-mh', 'bs-2', 'sl-3', 'ph-1', 'bd-4', 'sh-1', 'bi-8-fast-shutter', 'at-1', 'sl-4', 'sl-5', 'wn-1',
    'bd-6-wavefront', 'end-beamstop', 'ratchet-wall',
  ],
  camera: { along: 0.62, side: -1, up: 0.55 },
  custom: (ctx) => custom(ctx),
};

/**
 * CSSI station component: chamber at the true beam height plus the floating magnifier (true horizontal scattering
 * plane, chip ×8, angles ×24), its caption and a leader to the sample. Local origin = the sample.
 */
function cssiStation(c: BuildCtx): THREE.Group {
  const g = new THREE.Group();
  const ch = cssiChamber(KB_GRANITE.top);
  const MAG_Y = 0.66;
  const mag = magnifier(c.color, ALPHA);
  mag.position.y = MAG_Y;
  const lead = leader(new THREE.Vector3(0, 0.05, 0), new THREE.Vector3(0, MAG_Y - 0.12, 0), c.color);
  const cap = magnifierCaption(c.color);
  cap.position.set(-0.4, MAG_Y + 0.22, 0);
  g.add(ch, mag, lead, cap);
  return g;
}

/** Beam-axis extents [x0, x1] of the drawn hardware, used to fill the gaps with vacuum pipe. */
const AXIS_HARDWARE: [number, number][] = [
  [21.8, 23.85], // ratchet wall penetration
  [25.25, 25.55], [25.95, 26.25], [26.85, 27.35], [27.375, 29.025], [29.05, 29.58], [30.13, 30.27], [30.275, 31.925],
  [32.05, 32.55], [32.83, 32.97], [33.2, 33.4], [33.55, 34.05], [34.1, 35.5], [35.73, 35.87],
  [36.9, 41.5], // engine transport pipe
  [41.66, 42.22], [42.13, 42.63], [42.45, 42.95], [42.79, 43.11], [42.96, 43.64], [43.55, 44.05], [43.85, 44.75],
  [45.0, 47.0], // engine transport pipe
  [47.68, 47.92], [47.9, 48.5], [50.05, 50.55], [50.64, 51.36], [52.65, 53.15], [53.18, 53.68], [53.77, 54.51],
  [54.4, 54.8], [54.52, 55.46], [55.2, 55.6],
];

function custom(ctx: BuildCtx): void {
  const g = ctx.group;
  const beamY = ctx.beamY;

  // ---- the Grand Tube is its own (self-shielding) enclosure: hide the engine's hutch box, keep its label
  const gt = g.getObjectByName('enclosure-9-ID-GT (Grand Tube)');
  if (gt) gt.visible = false;

  // ---- context: granites under the KB/CSSI chambers and the GIXS instruments; optical tables
  g.add(granites(beamY));
  const tables = stationTables(beamY, [D_TABLE, { x0: 52.55, x1: 53.75, half: 0.4, top: -0.25 }]);
  g.add(tables);

  // ---- vacuum pipe between the beam-axis hardware
  const iv = [...AXIS_HARDWARE].sort((a, b) => a[0] - b[0]);
  let end = iv[0][1];
  for (let i = 1; i < iv.length; i++) {
    const [a, b] = iv[i];
    if (a - end > 0.04) {
      const p = new THREE.Group();
      p.add(pipeX(end, a, 0.028), flangeX(end + 0.01, 0.055), flangeX(a - 0.01, 0.055));
      g.add(shadowed(p));
    }
    end = Math.max(end, b);
  }

  // ---- Grand Tube entrance on the 9-ID-D downstream wall
  const ent = tubeEntrance();
  ent.position.copy(ctx.at(TUBE.x0 - 0.05));
  g.add(ent);

  // ---- CSSI beams in the tube: specular reflection at 2α (true angle) onto the MM-PAD; direct beam to the end stop
  const spec = fatLine([ctx.at(CSSI_X, 0, 0), ctx.at(MMPAD_X, MMPAD.side, 0)], { color: COLORS.xray, intensity: 2.2, width: 2.2 });
  const direct = fatLine([ctx.at(GIXS_X, 0, 0), ctx.at(END_STOP_X, 0, 0)], { color: COLORS.xray, intensity: 1.4, width: 1.6, opacity: 0.8 });
  g.add(spec, direct);

  // ---- CSSI scattering: narrow specular region onto the MM-PAD, faint off-specular speckle onto the EIGER (custom cones:
  //      the engine's scatter cones have a 5 cm minimum radius and one fixed opacity)
  const s0 = ctx.at(CSSI_X, 0, 0);
  g.add(cone(s0, ctx.at(MMPAD_X, MMPAD.side, 0), 0.0008, ctx.color, 0.16), cone(s0, ctx.at(DET_X, EIGER.side, 0), 0.0035, ctx.color, 0.05));

}

export default layout;
