import type * as THREE from 'three';
import type { BeamlineLayout, BuildCtx } from '../scene/beamline/layout';
import {
  B_HEIGHT, B_PIPE_STANDS, CONTROL, C_HEIGHT, C_OUTLINE, C_PIPE_STANDS, EIGER_FACE, FOE_HEIGHT, FOE_OUTLINE, M1_LEN, M2_LEN, OSA_X, SAMPLE_X, SELUN_FACE,
  ST1, ST2, UND, ZP_X,
} from './ptychoprobe/geom';
import { emptyUpstreamSlot, revolverUndulator } from './ptychoprobe/source';
import { dmmGhost, hhlMirror, horizontalDcm, hutchPipe, pinkBeamStop, shieldBlock, shieldedTransport, ssaAssembly, wallCollimator } from './ptychoprobe/optics';
import { METRO_ORIGIN, XRF_ORIGIN, endstation, fluorescenceCone, metrology, opticsModule, osaModule, xrfDetector } from './ptychoprobe/instrument';
import { TANK_PIN_X, detectorMover, eigerDetector, selunDetector } from './ptychoprobe/detector';

/**
 * 33-ID PtychoProbe is a single in-line beamline without canting or branches. Its component sequence follows.
 * revolver undulator (one 2.35 m device, downstream half of the straight) → windowless HHL front end → 33-ID-A FOE
 * (M1 horizontal HHL mirror, horizontal LN2 Si(111) DCM, [DMM: FDR baseline, unconfirmed → ghost], M2 vertical mirror)
 * → shielded transport → 33-ID-B (SSA/BDA1, shutters) → shielded transport through mini-hutches → 33-ID-C (SSA/BDA2,
 * 11 m of pipe, the granite/air-bearing nanoprobe instrument at 69.7 m, the 5.6 m in-vacuum detector mover, beam stop).
 *
 * Geometry choices (documented in the dossier's distanceNote/geometryNotes):
 * • The beam axis is drawn STRAIGHT. M1 (5 mrad horizontal) and M2 (5 mrad vertical) really displace the axis by
 *   ≈0.21 m sideways and ≈0.18 m vertically at the sample, but their senses are undocumented (published drawings are
 *   straight too). Mirrors are drawn with their faces on the beam; the DCM's 1 mm offset is enlarged ×10 inside the tank.
 * • Hutch outlines are the true shapes from FDR Fig. 4.31 / the 2024 elevation (engine cut-away `outline` enclosures):
 *   a trapezoidal FOE and a 33-ID-C that is chamfered on the inboard side at its downstream end; roofs ≈3.45 m (A, B)
 *   and ≈4.4 m (C) scaled from the elevation. The inboard control room/vestibule is a low 'room' outline (unshielded).
 * • Endstation: the zone plate is drawn 10 mm upstream of the sample (true focal lengths 5.8–23 mm) but the optic itself
 *   is enlarged ~100× (0.18 mm → 17.6 mm disc), as are the OSA and central stop. The XRF detector is drawn at 90° on the
 *   outboard side (side undocumented; the inboard side is kept clear for the close-up camera), the metrology heads
 *   inboard. SELUN is drawn at its closest documented position (75 mm, in use) and the EIGER2 parked at its farthest
 *   (5 m); only one detector is in the beam at a time. No cryogenic sample stage is drawn: no 2026 source confirms one.
 * • The detector-mover tank is opaque (cream, as in the vendor rendering) with a cut-away window on its upper inboard
 *   side, which is the side the close-up cameras look from.
 * • The control room starts at ≈54.4 m (FDR Fig. 4.31), upstream of the 33-ID-C entrance; drawn as a low 'room' outline.
 * • The 2.35 m revolver is centred at +1.3 m (downstream half of the 5.4 m straight); the empty upstream position is a
 *   dashed ghost. Lateral exaggeration: none (single in-line beam).
 * • Scale figures stand outside the shielding (nobody is in a hutch while the beam is on): on the hall floor beside
 *   33-ID-A, in the control room, and on the outboard aisle next to the detector tank.
 */

const layout: BeamlineLayout = {
  id: 'ptychoprobe',
  // one in-line beam: the dossier leaves the source/front-end items branch-less; put them on 'main' so the strip has one row
  defaultBranch: 'main',
  // distance ruler on the infield side, nearest the (infield) whole-beamline camera: drawn outboard, its labels sat
  // behind the line, on the pins and hutch labels
  rulerSide: -3.1,
  enclosureDefaults: { heightM: B_HEIGHT },
  enclosure: {
    '33-ID-A': { outline: FOE_OUTLINE, heightM: FOE_HEIGHT },
    '33-ID-A-MH-1': { widthM: 1.2, heightM: 1.85 },
    '33-ID-B': { side: -0.05, widthM: 1.65, heightM: B_HEIGHT },
    '33-ID-B-MH-1': { widthM: 1.2, heightM: 1.8 },
    '33-ID-C-MH-1': { widthM: 1.2, heightM: 2.2 },
    // unshielded user space: low outline only (depth not documented; 3 m assumed)
    '33-ID control room / vestibule': { side: CONTROL.wallZ - 0.12 - CONTROL.depth / 2, widthM: CONTROL.depth, style: 'room' },
    '33-ID-C': { outline: C_OUTLINE, heightM: C_HEIGHT },
  },
  comp: {
    // ---------------------------------------------------------------- source & front end
    'revolver-undulator': { distanceM: UND.center, build: () => revolverUndulator(), pinUp: 0.85, shot: { r: 2.2, dir: [-0.55, 0.5, -0.8] } },
    'fe-grid-xbpm': { pinUp: 0.3 },
    'fe-shutters': { pinUp: 0.7 },
    'ratchet-wall': { build: () => wallCollimator(), pinUp: 0.35 },
    // ---------------------------------------------------------------- 33-ID-A (FOE)
    'fe-exit-mask': { build: () => shieldBlock({ len: 0.3, mat: 'copper', water: true, hole: 0.01 }), pinUp: 0.45 },
    'fe-exit-collimator': { build: () => shieldBlock({ len: 0.3, w: 0.3, h: 0.3, mat: 'tungsten', hole: 0.014 }), pinUp: 0.4 },
    'wb-slits': { pinUp: 0.35 },
    // reflecting face looks outboard: view it from the outboard side
    m1: { build: () => hhlMirror({ L: M1_LEN, vertical: false }), pinUp: 0.62, shot: { r: 1.5, dir: [-0.45, 0.7, 0.85] } },
    'sc-1': { build: () => shieldBlock({ len: 0.2, w: 0.36, h: 0.36, mat: 'lead', hole: 0.02 }), pinUp: 0.4 },
    'pm-1': { build: () => shieldBlock({ len: 0.15, w: 0.2, h: 0.2, mat: 'copper', water: true, hole: 0.012 }), pinUp: 0.38 },
    'bd-1': { pinUp: 0.3 },
    // close-ups from the infield side (source on the left, as in the whole-beamline view) unless a part faces outboard or
    // sector 34's storage-ring tunnel wall is in the way (from ~26 m it runs only ~1 m inboard of the beam, 2 m high)
    // from outboard: an infield camera here sits behind that wall, and from above the lid hides the crystals
    hdcm: { build: () => horizontalDcm(), pinUp: 0.72, shot: { r: 1.8, dir: [-0.5, 0.75, 0.8] } },
    // steep: from 26 m on, sector 34's storage-ring tunnel wall runs only ~1 m inboard of the beam (top 2 m above it),
    // so a lower infield camera here would sit inside that wall
    dmm: { build: () => dmmGhost(), pinUp: 0.45, shot: { r: 1.8, dir: [-0.45, 1.2, -0.35] } },
    m2: { build: () => hhlMirror({ L: M2_LEN, vertical: true }), pinUp: 0.62, shot: { r: 1.5, dir: [-0.55, 0.85, -0.6] } },
    'bd-2': { pinUp: 0.3 },
    'pm-2': { build: () => shieldBlock({ len: 0.15, w: 0.24, h: 0.24, mat: 'tungsten', hole: 0.012 }), pinUp: 0.38 },
    'bc-1': { build: () => shieldBlock({ len: 0.2, w: 0.34, h: 0.34, mat: 'tungsten', hole: 0.02 }), pinUp: 0.4 },
    // from above the tunnel wall (it runs ~2 m inboard of the beam here): the default lower infield camera looks through it
    'st-1': { distanceM: (ST1.x0 + ST1.x1) / 2, build: () => shieldedTransport(ST1.x0, ST1.x1, [[39.45, 40.45]]), pinUp: 0.3, shot: { r: 2.8, dir: [-0.4, 0.85, -0.55] } },
    // ---------------------------------------------------------------- 33-ID-B
    ssa1: { build: () => ssaAssembly(), pinUp: 0.45, pinPriority: 2.6, shot: { r: 1.0, dir: [-0.6, 0.55, -0.8] } },
    'pm-3': { build: () => shieldBlock({ len: 0.15, w: 0.2, h: 0.2, mat: 'copper', water: true, hole: 0.012 }), pinUp: 0.38 },
    'sh-1': { pinUp: 0.75 },
    'sh-2': { pinUp: 0.75 },
    'st-2': { distanceM: (ST2.x0 + ST2.x1) / 2, build: () => shieldedTransport(ST2.x0, ST2.x1, [[53.15, 54.15], [56.2, 57.2]]), pinUp: 0.3, shot: { r: 3.2 } },
    // ---------------------------------------------------------------- 33-ID-C
    // camera inside 33-ID-C, looking back upstream (the entrance wall and C-MH-1 stay behind it)
    ssa2: { build: () => ssaAssembly({ table: true }), pinUp: 0.45, pinPriority: 2.6, shot: { r: 1.1, dir: [0.5, 0.55, -0.8] } },
    // nano-optics: tight shots from the inboard side, between the gantry legs (millimetre-scale parts, enlarged ~100×)
    nfo: { distanceM: ZP_X, build: () => opticsModule(), pinUp: 0.2, shot: { r: 0.075, dir: [-0.55, 0.32, -0.85], target: [0.004, 0, 0] } },
    // looking back up the optical train from just downstream of the sample: sample pin → OSA → zone plate
    'osa-cs': { distanceM: OSA_X, build: () => osaModule(), pinUp: 0.12, shot: { r: 0.06, dir: [0.45, 0.4, -0.8], target: [0.002, 0, 0] } },
    metrology: {
      distanceM: SAMPLE_X + METRO_ORIGIN.x,
      side: METRO_ORIGIN.z,
      dy: METRO_ORIGIN.y,
      build: () => metrology(),
      pinUp: 0.2,
      shot: { r: 0.32, dir: [-0.45, 0.6, -0.7], target: [0.0, -0.01, 0.17] },
    },
    'ptychoprobe-instrument': { build: () => endstation(), pinUp: 0.36, pinPriority: 4, shot: { r: 1.45, dir: [-0.75, 0.55, -0.9], target: [0, -0.35, 0] } },
    // built pointing to −Z; turned 180° so the snout enters the outboard side port (side undocumented); viewed from outboard
    'xrf-detector': {
      distanceM: SAMPLE_X + XRF_ORIGIN.x,
      side: -XRF_ORIGIN.z,
      dy: XRF_ORIGIN.y,
      rotY: Math.PI,
      build: () => xrfDetector(),
      pinUp: 0.2,
      shot: { r: 0.95, dir: [-0.55, 0.55, 0.85], target: [0, -0.12, -0.25] },
    },
    'detector-mover': { distanceM: TANK_PIN_X, build: () => detectorMover(), pinUp: 0.75, pinPriority: 3.2, shot: { r: 2.9, dir: [-0.5, 0.5, -1] } },
    // the SELUN head sits in the instrument chamber, 75 mm behind the sample: look over the chamber wall from inboard
    selun: { distanceM: SELUN_FACE, build: (c) => selunDetector(c.color), pinUp: 0.3, shot: { r: 0.2, dir: [0.08, 0.85, -0.52], target: [-0.03, 0, 0] } },
    'eiger2-xe': { distanceM: EIGER_FACE, build: (c) => eigerDetector(c.color), pinUp: 0.28, shot: { r: 0.8, dir: [-0.85, 0.45, -0.55] } },
    'pink-beam-stop': { build: () => pinkBeamStop(), pinUp: 0.4, shot: { r: 1.2 } },
  },
  scatter: [
    // far-field ptychography: SELUN 19 × 19 mm at 75 mm → half-angle ≈ 7°
    { from: 'ptychoprobe-instrument', to: 'selun', spread: 0.125, kind: 'cone' },
  ],
  people: [
    // hall floor outboard of the FOE (its outboard wall splays from z 0.22 to 0.9 m)
    { x: 26.8, side: 1.6, rotY: Math.PI / 2, pose: 'stand' },
    // in the control room (54.4–64.5 m, inboard of 33-ID-C), turned toward the hutch
    { x: 61.5, side: -3.4, rotY: -Math.PI / 2, pose: 'point' },
    // outboard aisle beside the detector tank (the vendor rendering shows a person next to it)
    { x: 73.6, side: 2.35, rotY: Math.PI / 2, pose: 'stand' },
  ],
  quietPins: [
    'fe-grid-xbpm', 'fe-shutters', 'ratchet-wall', 'fe-exit-collimator', 'sc-1', 'pm-1', 'bd-1', 'bd-2', 'pm-2', 'bc-1', 'pm-3', 'sh-2', 'st-2', 'osa-cs',
  ],
  // from the infield (inboard) side and fairly high, like the other exhibits: the source is on the left and the beam flows
  // left → right as on the subway map; sector 34's hutches sit in front of 33-ID-C but well below the line at this elevation
  camera: { along: 0.56, side: -1.35, up: 0.66 },
  custom: (ctx) => custom(ctx),
};

function custom(ctx: BuildCtx): void {
  const g = ctx.group;

  // ---- the empty upstream half of the straight (FDR baseline had a second revolver there)
  const slot = emptyUpstreamSlot();
  slot.position.copy(ctx.at(-UND.center));
  g.add(slot);

  // ---- vacuum pipes between components (front end, FOE, 33-ID-B, 33-ID-C)
  g.add(
    hutchPipe(
      [
        [15.0, 19.25], [19.75, 21.05], [21.95, 22.1], [23.6, 25.25], [25.55, 25.95], [26.25, 26.75],
        [29.68, 29.75], [31.05, 32.35], [33.85, 34.35], [34.85, 35.03], [35.18, 35.4],
        [41.5, 47.58], [48.22, 49.62], [50.65, 50.75], [51.65, 51.8],
        [58.12, 69.08],
      ],
      [16.5, 24.4, 32.0, 34.0, ...B_PIPE_STANDS, 48.9, ...C_PIPE_STANDS],
    ),
  );

  // ---- hutch labels: the engine pins each label at the enclosure's upstream corner. Seen from the infield in the
  // whole-beamline view, '33-ID-A' and '33-ID-B' would sit on the first pins inside them (FE exit mask, SSA1), so they end
  // at the upstream wall instead (right-aligned); '33-ID-C' moves into the empty stretch between the SSA2 pin and the
  // instrument. The mini-hutch and control-room labels pile up there, so they show only when the camera is within ~35 m.
  const MAIN: Record<string, { x: number; alignEnd?: boolean }> = {
    '33-ID-A': { x: 24.0, alignEnd: true },
    '33-ID-B': { x: 46.6, alignEnd: true },
    '33-ID-C': { x: 59.4 },
  };
  const MINOR: Record<string, string> = {
    '33-ID-A-MH-1': '33-ID-A-MH-1',
    '33-ID-B-MH-1': '33-ID-B-MH-1',
    '33-ID-C-MH-1': '33-ID-C-MH-1',
    '33-ID control room / vestibule': 'control room · vestibule',
  };
  const relabel: [THREE.Object3D, string][] = [];
  g.traverse((o) => {
    const l = o as THREE.Object3D & { isCSS2DObject?: boolean; element?: HTMLElement; center?: THREE.Vector2 };
    if (!l.isCSS2DObject || !l.element) return;
    const t = l.element.textContent ?? '';
    const m = MAIN[t];
    if (m) {
      l.position.x = m.x;
      if (m.alignEnd) l.center?.set(1, 1);
    } else if (t in MINOR) relabel.push([l, MINOR[t]]);
  });
  for (const [l, text] of relabel) {
    // detach the engine's always-on label (the engine re-shows enclosure labels every frame, so hiding it is not enough;
    // a detached CSS2D label also drops its element) and replace it with a distance-limited one
    const pos = l.position.clone();
    l.removeFromParent();
    if (text.startsWith('control')) pos.set(59.5, pos.y, pos.z);
    ctx.addLabel(text, pos, { maxDist: 35 });
  }

  // ---- fluorescence from the sample into the SDD window (90°, outboard)
  const fl = fluorescenceCone();
  fl.position.add(ctx.at(SAMPLE_X));
  g.add(fl);
}

export default layout;
