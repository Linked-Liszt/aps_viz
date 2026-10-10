import type { BeamlineLayout, BuildCtx, CompOverride } from '../scene/beamline/layout';
import { drawBeams, hideEngineBeams, type BeamSeg } from './chex/beams';
import {
  BR, CANT, DEG, E_END, F_END, G_X0, HDCM_X, SE1, ST1, TUN_DZ, bp, branchRotY, hutchA, hutchB, hutchC, hutchD, hutchE, hutchF, hutchG,
  tunableSide, type BranchId, type P2,
} from './chex/geom';
import { moveLabel, ratchetWall, replaceEnclosure } from './chex/hutches';
import { beamStopBlock, cantingMagnets, hdcm, scm, shieldBlock, shieldedPipe } from './chex/optics';
import { beamViewer, compactSlits, exitWindow, monoShutter, passPipe, wallCollimator, whiteShutter } from './chex/plumbing';
import {
  PLD_LASER_ORIGIN, excimerLaser, gasCabinet, hePanel, hexapodDiffractometer, ldDetector, mbeChamber, mocvdChamber, openPosition, pldHaxpes,
  transfocator,
} from './chex/stations';

/**
 * CHEX — Coherent High-Energy X-ray sector, 28-ID (two canted undulators, four branches, eight instrument positions).
 *
 * Geometry (sources and digitising notes in ./chex/geom.ts):
 * • The group is rotated +0.5 mrad (cantMrad) so local +X runs along the OUTBOARD canted beam (upstream undulator →
 *   tunable branch A/B/C). The INBOARD beam (downstream undulator, shared by the fixed-energy branches) runs at −1 mrad,
 *   i.e. 28 mm inboard at 28 m and 40 mm at 40 m — drawn at TRUE scale (visible in the optics close-ups only).
 * • Three thin side-bounce crystals tap the inboard beam inside 28-ID-A: diamond at 28.3 m → D/E (2θ = 23.15° outboard),
 *   diamond at 38.3 m → F (22.8° outboard), silicon at 40.2 m → G (4.95° inboard). Each branch is a straight line from
 *   its crystal; every dossier distance is a PATH length along its own branch, so components are placed with bp() at
 *   their true (x, z) and yawed onto their branch. No lateral exaggeration is used anywhere.
 * • The engine's smoothstep branch ramps cannot draw straight 23° branches, so the engine's beams are hidden and all
 *   five beams are redrawn along their true lines with ctx.addBeam (./chex/beams.ts). The `branches` entries below
 *   only feed the overview lines and the subway-map rows; their ramps approximate the real fan, and beamEndM stops
 *   each overview line at its branch's last beam stop (the shared inboard white beam at 28-ID-A's end wall).
 * • Hutches are redrawn from their plan outlines as cut-away shells (FDR Fig. 4.2; hutch G from the 2025 as-built plan,
 *   MEDSI'25 Fig. 2, which is shorter and narrower than the 2019 drawing): D/E and F are rotated ~23°; A, C and G are
 *   not rectangles (./chex/hutches.ts). For the APS overview each hutch keeps an equal-area axis-aligned box override
 *   (the overview reduces outlines to bounding boxes, which would make the rotated D/E/F hutches overlap).
 * • Operating snapshot shown (one experiment per branch, as the sector is designed to run): B active (shared hexapod
 *   diffractometer + reaction cell, detector 2.8 m away at 2θ = 4°) while 28-ID-C (oxide MBE) is being set up behind
 *   the closed white-beam stop BS-1; E active (PLD + HAXPES) with the D diffractometer in beam-pass mode and BS-3
 *   retracted; F/2 active (MOCVD reactor, speckle detector 2.4 m away at 2θ = 4.8°, the GaN benchmark geometry) with
 *   F/1 in beam-pass mode; G/1 active (furnace, high-energy area detector 1.5 m downstream) with G/2 idle.
 * • Detector models are not published: the PAD/LDDP and panel models are generic (sizes typical of 55 µm-pixel PADs).
 * • The transmitted inboard white beam is drawn ending at 28-ID-A's downstream wall; its terminating stop is not in the
 *   FDR tables.
 * • Long shielded transports and beam-pass pipes are drawn as translucent shells so the beam inside stays visible.
 * • The site model's placeholder hutch train for sector 27 overlaps CHEX's real outboard fan (CHEX took over that
 *   floor: PDR), so it is suppressed (suppressSiteHutches).
 */

const r = (deg: number) => deg * DEG;
const inbZ = (x: number) => -CANT * x;

/** Place a component on branch `b` at path length `s`, `u` m to the branch's outboard side, `up` m above the beam. */
function on(b: BranchId, s: number, extra: CompOverride = {}, u = 0, up = 0): CompOverride {
  const p = bp(b, s, u);
  const side = b === 'tunable' ? p.z + tunableSide(s) : p.z;
  return { distanceM: p.x, side, dy: up, rotY: branchRotY(b), ...extra };
}

/** Detector on a long-distance positioner, R metres from the sample at vertical scattering angle 2θ (sample at path s0). */
function scatterDet(b: BranchId, s0: number, R: number, twoThetaDeg: number, o: { tube?: boolean; face?: number; pinUp?: number } = {}): CompOverride {
  const tt = r(twoThetaDeg);
  const up = R * Math.sin(tt);
  return on(b, s0 + R * Math.cos(tt), { build: (c) => ldDetector(c.beamY + up, { dist: R, tiltRad: tt, tube: o.tube ?? true, face: o.face }), pinUp: o.pinUp ?? 0.3 }, 0, up);
}

const slits = (b: BranchId, s: number) => on(b, s, { build: (c) => compactSlits(c.beamY), pinUp: 0.3 });
const viewer = (b: BranchId, s: number) => on(b, s, { build: (c) => beamViewer(c.beamY), pinUp: 0.3 });
const windowAt = (b: BranchId, s: number) => on(b, s, { build: (c) => exitWindow(c.beamY), pinUp: 0.22 });
const lenses = (b: BranchId, s: number, n: number) => on(b, s, { build: (c) => transfocator(c.beamY, n), pinUp: 0.42 });
const monoShut = (b: BranchId, s: number) => on(b, s, { build: (c) => monoShutter(c.beamY), pinUp: 0.55 });
const stop = (b: BranchId, s: number, o: { white?: boolean; retracted?: boolean } = {}) => on(b, s, { build: (c) => beamStopBlock(c.beamY, o), pinUp: 0.45 });

/** Path length at which a branch crosses 28-ID-A's outboard wall (z = 1.8 m). */
const sAtAWall = (b: BranchId) => BR[b].s0 + (1.85 - BR[b].z0) / Math.sin(BR[b].ang);
const S_DE_WALL = sAtAWall('de'); // ≈ 33.1 m
const S_F_WALL = sAtAWall('f'); // ≈ 43.2 m
/** Path length on branch `b` whose point lies at x (straight branches). */
const sAtX = (b: BranchId, x: number) => BR[b].s0 + (x - BR[b].x0) / Math.cos(BR[b].ang);
/** G beam: shielded pipe from A's wall across the gap to just inside hutch G's upstream wall (as built at 47.55 m). */
const S_G_IN = sAtX('g', G_X0 + 0.12);

/**
 * Overview stand-in for a polygonal hutch: an axis-aligned box with the polygon's centroid and area (the APS overview
 * reduces outlines to bounding boxes). `lenFrac` shortens rotated hutches so neighbours do not overlap.
 */
function overviewBox(poly: P2[], lenFrac = 1): { startM: number; endM: number; side: number; widthM: number } {
  let a = 0;
  let cx = 0;
  let cz = 0;
  poly.forEach((p, i) => {
    const q = poly[(i + 1) % poly.length];
    const k = p.x * q.z - q.x * p.z;
    a += k;
    cx += (p.x + q.x) * k;
    cz += (p.z + q.z) * k;
  });
  a /= 2;
  cx /= 6 * a;
  cz /= 6 * a;
  const xs = poly.map((p) => p.x);
  const len = (Math.max(...xs) - Math.min(...xs)) * lenFrac;
  return { startM: cx - len / 2, endM: cx + len / 2, side: cz, widthM: Math.abs(a) / len };
}

// sample positions and detector geometry of the four running experiments
const DET_B = { R: 2.8, tt: 4.0 };
const DET_E = { R: 1.6, tt: 8.0 };
const DET_F2 = { R: 2.4, tt: 4.8 };
const DET_G1 = { R: 1.5 };

const sideOf = (p: P2) => ({ x: p.x, side: p.z });

const layout: BeamlineLayout = {
  id: 'chex',
  cantMrad: 0.5,
  branches: {
    tunable: { side: 0, divergeAtM: 0, label: 'A/B/C tunable' },
    inboard: { side: inbZ(78.5), divergeAtM: 0, rampM: 78.5, label: 'shared inboard beam' },
    de: { side: bp('de', E_END).z, divergeAtM: BR.de.x0, rampM: bp('de', E_END).x - BR.de.x0, label: 'D/E 15 keV' },
    f: { side: bp('f', F_END).z, divergeAtM: BR.f.x0, rampM: bp('f', F_END).x - BR.f.x0, label: 'F 25/35 keV' },
    g: { side: bp('g', 60.5).z, divergeAtM: BR.g.x0, rampM: bp('g', 60.5).x - BR.g.x0, label: 'G 75/105 keV' },
  },
  comp: {
    // ---------------------------------------------------------------- source (interim HPMUs, 2.07 m each)
    'us-undulator': { side: 0 },
    'canting-magnets': { side: 0, build: (c) => cantingMagnets(c.beamY), pinUp: 0.55 },
    'ds-undulator': { side: inbZ(1.23), props: { periodMm: 30 } },
    // ---------------------------------------------------------------- front end (tunnel) and shield wall
    'fe-grid-xbpm': { side: inbZ(19.4) / 2 },
    'fe-safety-shutters': { side: inbZ(21.5) / 2 },
    'shield-wall': { side: 0, build: () => wallCollimator([0, inbZ(22.8)]), pinUp: 2.4 },
    // ---------------------------------------------------------------- 28-ID-A: both canted beams
    'fe-exit-mask': { side: 0, build: (c) => shieldBlock({ beamY: c.beamY, len: 0.22, mat: 'copper', holes: [0, inbZ(25.6)], hole: 0.01 }), pinUp: 0.45 },
    'fe-exit-collimator': { side: 0, build: (c) => shieldBlock({ beamY: c.beamY, len: 0.25, mat: 'tungsten', holes: [0, inbZ(26.0)], hole: 0.014 }), pinUp: 0.4 },
    'wb-slits-1': { side: inbZ(26.8) / 2 },
    'wb-slits-2': { side: inbZ(27.3) / 2 },
    'graphite-filter': { side: inbZ(27.6) },
    'scm-de': { side: inbZ(28.3), build: (c) => scm({ beamY: c.beamY, twoThetaDeg: BR.de.twoThetaDeg, crystal: 'diamond', tunableAt: -inbZ(28.3) }), pinUp: 0.6 },
    'sc-1': { side: 0, build: (c) => shieldBlock({ beamY: c.beamY, len: 0.18, mat: 'lead', holes: [0, inbZ(29.1)], hole: 0.016 }), pinUp: 0.4 },
    'sl-6': slits('de', 29.3),
    'crl1-de': lenses('de', 29.8, 4),
    'bd-3': viewer('de', 30.0),
    'sh-2': monoShut('de', 31.0),
    'bd-1': { side: 0, build: (c) => beamViewer(c.beamY), pinUp: 0.3 },
    'st-2': on('de', 31.25, { build: (c) => shieldedPipe({ beamY: c.beamY, len: S_DE_WALL + 0.12 - 31.25, rOut: 0.07, supports: 1 }), pinUp: 0.35 }),
    'sl-7': slits('de', 33.7),
    'bc-1': { side: 0, build: (c) => shieldBlock({ beamY: c.beamY, len: 0.2, mat: 'lead', holes: [0, inbZ(33.8)], hole: 0.016 }), pinUp: 0.4 },
    'crl2-d': lenses('de', 34.0, 6),
    'wn-3': windowAt('de', 34.3),
    hdcm: { side: 0, build: (c) => hdcm(c.beamY), pinUp: 0.8 },
    'instrument-d': on('de', 35.5, { build: (c) => hexapodDiffractometer(c.beamY, { towerSide: 1, top: 'pass' }), pinUp: 1.45 }),
    // D detector parked 1.05 m inboard (D is in beam-pass mode while E runs)
    'detector-d': on('de', 37.5, { build: (c) => ldDetector(c.beamY, { dist: 2, tiltRad: 0, tube: false }), pinUp: 0.3 }, -1.05),
    'scm-f': { side: inbZ(38.3), build: (c) => scm({ beamY: c.beamY, twoThetaDeg: BR.f.twoThetaDeg, crystal: 'diamond', tunableAt: TUN_DZ - inbZ(38.3) }), pinUp: 0.6 },
    'sc-2': { side: 0, build: (c) => shieldBlock({ beamY: c.beamY, len: 0.18, mat: 'lead', holes: [TUN_DZ, inbZ(39.0)], hole: 0.016 }), pinUp: 0.4 },
    'sl-9': slits('f', 39.5),
    'bs-3': stop('de', 39.9, { retracted: true }),
    'crl1-f': lenses('f', 40.0, 4),
    'bd-4': viewer('f', 40.2),
    'scm-g': { side: inbZ(40.2), build: (c) => scm({ beamY: c.beamY, twoThetaDeg: -BR.g.twoThetaDeg, crystal: 'silicon', tunableAt: TUN_DZ - inbZ(40.2) }), pinUp: 0.6 },
    'sh-3': monoShut('f', 41.0),
    'sl-8': slits('de', 41.2),
    'crl2-e': lenses('de', 41.5, 6),
    'sl-12': slits('g', 41.5),
    'wn-4': windowAt('de', 41.8),
    'st-3': on('f', 41.25, { build: (c) => shieldedPipe({ beamY: c.beamY, len: S_F_WALL + 0.12 - 41.25, rOut: 0.07, supports: 1 }), pinUp: 0.35 }),
    'crl1-g': lenses('g', 42.0, 4),
    'bd-5': viewer('g', 42.3),
    'sh-4': monoShut('g', 42.6),
    'st-4': on('g', 42.85, { build: (c) => shieldedPipe({ beamY: c.beamY, len: S_G_IN - 42.85, rOut: 0.07, supports: 2 }), pinUp: 0.35 }),
    // ---------------------------------------------------------------- 28-ID-E: PLD + HAXPES (running)
    'instrument-e': on('de', 43.0, { build: (c) => pldHaxpes(c.beamY), pinUp: 0.62 }),
    'detector-e': scatterDet('de', 43.0, DET_E.R, DET_E.tt),
    'bs-4': stop('de', 48.0),
    // ---------------------------------------------------------------- tunable transport through G (ST-1, SE-1)
    'st-1': on('tunable', ST1.x0, { build: (c) => shieldedPipe({ beamY: c.beamY, len: SE1.x0 - ST1.x0 - 0.02 }), pinUp: 0.4 }),
    'pm-1': on('tunable', 48.7, { build: (c) => shieldBlock({ beamY: c.beamY, len: 0.12, w: 0.2, h: 0.2, mat: 'copper', holes: [0], hole: 0.01 }), pinUp: 0.4 }),
    'bc-2': on('tunable', 49.1, { build: (c) => shieldBlock({ beamY: c.beamY, len: 0.2, w: 0.26, h: 0.26, mat: 'lead', holes: [0], hole: 0.016 }), pinUp: 0.4 }),
    'sl-3': slits('tunable', 49.7),
    'crl1-bc': lenses('tunable', 50.0, 8),
    'sh-1': on('tunable', 51.4, { build: (c) => whiteShutter(c.beamY), pinUp: 0.75 }),
    // ---------------------------------------------------------------- 28-ID-F: F/1 beam-pass, F/2 MOCVD (running)
    'sl-10': slits('f', 43.7),
    'crl2-f1': lenses('f', 44.0, 6),
    'wn-5': windowAt('f', 44.3),
    'instrument-f1': on('f', 45.5, { build: (c) => hexapodDiffractometer(c.beamY, { towerSide: 1, top: 'pass' }), pinUp: 1.45 }),
    'detector-f1': on('f', 47.0, { build: (c) => ldDetector(c.beamY, { dist: 1.5, tiltRad: 0, tube: false }), pinUp: 0.3 }, -1.0),
    'sl-11': slits('f', 47.7),
    'crl2-f2': lenses('f', 48.0, 6),
    'wn-6': windowAt('f', 48.3),
    'instrument-f2': on('f', 49.5, { build: (c) => mocvdChamber(c.beamY), pinUp: 0.5 }),
    'detector-f2': scatterDet('f', 49.5, DET_F2.R, DET_F2.tt),
    'bs-5': stop('f', 54.3),
    // ---------------------------------------------------------------- 28-ID-G: G/1 furnace + high-energy panel (running)
    'sl-13': slits('g', 49.2),
    'crl2-g1': lenses('g', 49.5, 8),
    'wn-7': windowAt('g', 49.8),
    // tower parked downstream-outboard (yaw 0.8 rad): clear of the SE-1 mini-hutch wall and of the view onto the furnace
    'instrument-g1': on('g', 52.0, { build: (c) => hexapodDiffractometer(c.beamY, { towerSide: 1, top: 'furnace', towerYaw: 0.8 }), pinUp: 0.5 }),
    'detector-g1': on('g', 52.0 + DET_G1.R, { build: (c) => hePanel(c.beamY, { size: 0.3, stop: true }), pinUp: 0.42 }),
    'sl-14': slits('g', 54.2),
    'crl2-g2': lenses('g', 54.5, 8),
    'wn-8': windowAt('g', 54.8),
    'instrument-g2': on('g', 56.0, { build: (c) => openPosition(c.beamY), pinUp: 0.3 }),
    'detector-g2': on('g', 57.6, { build: (c) => ldDetector(c.beamY, { dist: 1.6, tiltRad: 0, tube: false }), pinUp: 0.3 }),
    'bs-6': stop('g', 60.45),
    // ---------------------------------------------------------------- 28-ID-B (running) and 28-ID-C (being set up)
    'bd-2': viewer('tunable', 62.0),
    'sl-4': slits('tunable', 62.7),
    'crl2-b': lenses('tunable', 63.0, 8),
    'wn-1': windowAt('tunable', 63.3),
    'instrument-b': on('tunable', 64.5, { build: (c) => hexapodDiffractometer(c.beamY, { towerSide: 1, top: 'cell' }), pinUp: 0.5 }),
    'detector-b': scatterDet('tunable', 64.5, DET_B.R, DET_B.tt),
    'bs-1': stop('tunable', 69.3, { white: true }),
    'sl-5': slits('tunable', 69.7),
    'crl2-c': lenses('tunable', 70.0, 7),
    'wn-2': windowAt('tunable', 70.3),
    'instrument-c': on('tunable', 72.0, { build: (c) => mbeChamber(c.beamY), pinUp: 0.85 }),
    'detector-c': scatterDet('tunable', 72.0, 1.6, 6.0),
    'bs-2': stop('tunable', 77.4, { white: true }),
  },
  enclosure: {
    '28ID-SE-1': { side: SE1.z, widthM: SE1.w, heightM: SE1.h },
    // APS-overview footprints (the exhibit hides these boxes and draws the true outlines in custom())
    '28-ID-A': overviewBox(hutchA()),
    '28-ID-D': overviewBox(hutchD(), 0.78),
    '28-ID-E': overviewBox(hutchE(), 0.78),
    '28-ID-F': overviewBox(hutchF(), 0.78),
    '28-ID-G': overviewBox(hutchG()),
    '28-ID-B': overviewBox(hutchB()),
    '28-ID-C': overviewBox(hutchC()),
  },
  scatter: [
    { from: 'instrument-b', to: 'detector-b', spread: 0.03 },
    { from: 'instrument-e', to: 'detector-e', spread: 0.045 },
    { from: 'instrument-f2', to: 'detector-f2', spread: 0.03 },
    { from: 'instrument-g1', to: 'detector-g1', spread: 0.1 },
  ],
  quietPins: [
    'fe-grid-xbpm', 'fe-safety-shutters', 'fe-exit-collimator', 'wb-slits-1', 'wb-slits-2', 'graphite-filter', 'sc-1', 'sc-2', 'bc-1', 'bc-2', 'pm-1',
    'bd-1', 'bd-2', 'bd-3', 'bd-4', 'bd-5', 'st-1', 'st-2', 'st-3', 'st-4', 'sh-1', 'sh-2', 'sh-3', 'sh-4',
    'sl-3', 'sl-4', 'sl-5', 'sl-6', 'sl-7', 'sl-8', 'sl-9', 'sl-10', 'sl-11', 'sl-12', 'sl-13', 'sl-14',
    'wn-1', 'wn-2', 'wn-3', 'wn-4', 'wn-5', 'wn-6', 'wn-7', 'wn-8', 'bs-1', 'bs-2', 'bs-3', 'bs-4', 'bs-5', 'bs-6',
    'detector-d', 'detector-f1', 'detector-g2',
  ],
  camera: { along: 0.58, side: -0.82, up: 0.64, distanceScale: 0.92 },
  // overview lines stop where each beam really ends (last beam stop; the shared white beam at A's end wall)
  beamEndM: { tunable: 77.4, inboard: 43.3, de: bp('de', 48.0).x, f: bp('f', 54.3).x, g: bp('g', 60.45).x },
  // ruler along the inboard side, clear of the outboard D/E/F fan (labels sit 0.9 m outboard of the rail)
  rulerSide: -5.0,
  suppressSiteHutches: [27],
  people: [
    { x: 73.1, side: 1.45, rotY: Math.PI + 0.6, pose: 'point' }, // setting up the MBE in C while B runs behind the closed stop BS-1
    { x: 25.6, side: 2.3, rotY: Math.PI }, // on the hall floor beside the optics hutch nose
    { ...sideOf(bp('de', 45.5, 2.65)), rotY: -Math.PI / 2 - branchRotY('de') }, // outside E, toward its control room
    { x: 56.5, side: -3.3, rotY: Math.PI / 2 }, // outside G, toward its control room
  ],
  custom: (ctx) => custom(ctx),
};

/** Close-up framing for the big in situ instruments (the engine's default sample-environment radius is ~1.3 m). */
const SHOTS: Record<string, NonNullable<CompOverride['shot']>> = {
  'instrument-c': { r: 3.9, dir: [-0.8, 0.55, -0.9], target: [0.6, -0.2, 0] }, // MBE chamber + detector 1.6 m downstream
  'instrument-e': { r: 4.0, dir: [-0.55, 0.6, -1], target: [0.5, -0.2, 0.2] }, // PLD chamber, HAXPES analyser, laser port, detector
  'instrument-f2': { r: 4.0, dir: [-0.55, 0.6, -1], target: [0.9, -0.2, 0.3] }, // MOCVD reactor, gas lines, speckle detector 2.4 m away
  'instrument-b': { r: 3.6, target: [1.0, -0.1, 0] }, // diffractometer + reaction cell + LDDP detector
  'instrument-g1': { r: 3.9, target: [0.6, -0.2, 0] }, // furnace + high-energy panel 1.5 m downstream
  hdcm: { r: 3.6 },
};
for (const [id, shot] of Object.entries(SHOTS)) layout.comp![id] = { ...layout.comp![id], shot };

function custom(ctx: BuildCtx): void {
  const g = ctx.group;
  const beamY = ctx.beamY;
  const P = (b: BranchId, s: number, u = 0, up = 0) => {
    const p = bp(b, s, u);
    return ctx.at(p.x, b === 'tunable' ? p.z + tunableSide(s) : p.z, up);
  };

  // ---- beams: hide the engine's ramped polylines and redraw the five straight beams
  hideEngineBeams(g);
  const segs: BeamSeg[] = [
    // tunable (outboard) beam: white through the upstream undulator to the HDCM, then monochromatic, shifted 8 mm, to B
    { pts: [ctx.at(-2.3, 0), ctx.at(HDCM_X, 0)], kind: 'white', width: 2.6 },
    { pts: [ctx.at(HDCM_X, TUN_DZ), ctx.at(64.5, TUN_DZ)], kind: 'mono' },
    // shared inboard beam (downstream undulator), filtered white, tapped by three crystals, absorbed at A's end wall
    { pts: [ctx.at(0.19, inbZ(0.19)), ctx.at(43.3, inbZ(43.3))], kind: 'white', width: 2.2 },
    // fixed-energy branches from their crystals to the running sample position
    { pts: [P('de', BR.de.s0), P('de', 43.0)], kind: 'mono' },
    { pts: [P('f', BR.f.s0), P('f', 49.5)], kind: 'mono' },
    { pts: [P('g', BR.g.s0), P('g', 52.0)], kind: 'mono' },
  ];
  drawBeams(ctx, segs);

  // ---- hutches: true plan outlines replace the engine's axis-aligned boxes
  replaceEnclosure(ctx, '28-ID-A', hutchA(), { x: 29.2, z: 1.65 });
  replaceEnclosure(ctx, '28-ID-D', hutchD(), bp('de', 35.2, 1.85));
  replaceEnclosure(ctx, '28-ID-E', hutchE(), bp('de', 46.3, 1.85));
  replaceEnclosure(ctx, '28-ID-F', hutchF(), bp('f', 52.6, 1.55));
  replaceEnclosure(ctx, '28-ID-G', hutchG(), { x: 57.4, z: -1.95 });
  replaceEnclosure(ctx, '28-ID-B', hutchB(), { x: 61.2, z: 2.45 });
  replaceEnclosure(ctx, '28-ID-C', hutchC(), { x: 70.2, z: 2.45 });
  moveLabel(ctx, '28ID-SE-1', SE1.x0 + 1.6, SE1.z + 0.2, SE1.h - beamY + 0.3);
  const wallBox = g.getObjectByName('enclosure-Shield (ratchet) wall');
  if (wallBox) wallBox.visible = false;
  ratchetWall(ctx, 22.1, 23.6);
  moveLabel(ctx, 'Shield (ratchet) wall', 22.15, 1.9, 2.5);

  // ---- pipes the dossier implies but does not list as components
  const pipeOn = (b: BranchId, s0: number, s1: number) => {
    const p = passPipe(beamY, s1 - s0);
    p.position.copy(P(b, s0));
    p.rotation.y = branchRotY(b);
    g.add(p);
  };
  pipeOn('de', S_DE_WALL + 0.12, 33.6); // D/E: wall penetration → SL-7
  pipeOn('de', 34.4, 39.75); // D in beam-pass mode: pipe through the lowered diffractometer to E
  pipeOn('f', S_F_WALL + 0.12, 43.6); // F: wall penetration → SL-10
  pipeOn('f', 44.4, 47.55); // F/1 in beam-pass mode → F/2
  pipeOn('g', S_G_IN, 49.08); // G: in-hutch flight pipe → SL-13
  // ST-1 continues downstream of SE-1 to the B wall
  const st1b = shieldedPipe({ beamY, len: ST1.x1 - SE1.x1 - 0.02 });
  st1b.position.copy(P('tunable', SE1.x1 + 0.02));
  g.add(st1b);
  ctx.addPickable(st1b, 'st-1');

  // ---- hero extras: the excimer laser that drives the PLD (E) and the MOCVD gas cabinet (F)
  const laser = excimerLaser(beamY);
  laser.position.copy(P('de', 43.0 + PLD_LASER_ORIGIN.x, PLD_LASER_ORIGIN.z));
  laser.rotation.y = branchRotY('de');
  g.add(laser);
  ctx.addPickable(laser, 'instrument-e');
  const gas = gasCabinet(beamY);
  gas.position.copy(P('f', 48.35, 1.3));
  gas.rotation.y = branchRotY('f') + Math.PI;
  g.add(gas);
  ctx.addPickable(gas, 'instrument-f2');
}

export default layout;
