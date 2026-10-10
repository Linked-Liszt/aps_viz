import * as THREE from 'three';
import type { BeamlineLayout, BuildCtx, CompOverride } from '../scene/beamline/layout';
import { REDUCED_MOTION, tamePulses } from './atomic/kit';
import { cantingMagnets, foeMirror, frontEndTrain, pinkBeamStop, pinkShutter, shieldBlock, shieldedPipe, whiteBeamStop } from './atomic/infra';
import {
  ARM_MID_REL, BRANCH_ATOMIC, CANT_MRAD, DET_REL, DMN, E_OUTLINE, F_HEIGHT, F_OUTLINE, HUTCH_A, HUTCH_B, HUTCH_C, KB1, KB2, LAUE_REL,
  PIPE_E, PRECOND_X, SAMPLE_X, SDD_REL, SHOT, S_SIDE, TUBE_MID_REL, ZOOM, atomicSide, dmnSide,
} from './atomic/geom';
import {
  bcdiDetector, bpm, collar, detectorArm, diffractedFan, dmnContext, environmentCell, flightTube, fluorescenceDetector, hdcm, kb2, kbPair, laueDetector,
  photonMask, pipeStand, planarUndulator, preconditioningPlatform, revolverUndulator, sampleDiffractometer, sampleStages, slitUnit,
  zoomEnvelope,
} from './atomic/parts';

/**
 * ATOMIC — coherent imaging (BCDI), 34-ID-F: inboard branch of the canted 34-ID pair (3DMN = outboard partner).
 *
 * Geometry (see ./atomic/geom.ts for sources):
 * • The group is rotated −0.5 mrad (cantMrad) so local +X is ATOMIC's initial beam direction; the 3DMN exhibit uses +0.5 mrad,
 *   so both exhibits put the shared hutches and hardware at the same place on the floor. The partner 3DMN beam is drawn with
 *   its true geometry (+1 mrad, then +6 mrad after its outboard mirror at 29.6 m); ATOMIC's beam bends 6 mrad inboard at its
 *   mirror (31.3 m), modelled by the engine branch ramp (within ~2 cm of the straight line). No lateral exaggeration.
 * • 3DMN is a context-only partner: its four dossier items (U28, outboard mirror, HDCM, simplified 34-ID-E instruments) get
 *   explicit sides from the true geometry, quiet pins, and a dim beam without pulses drawn here; 34-ID-E (its hutch) is a
 *   partner enclosure, so the APS overview does not draw it twice. Shared hardware builders are vendored from the 3DMN
 *   exhibit into ./atomic/ (kit.ts, infra.ts) so the two exhibits look alike but evolve independently.
 * • Hutches: A/B/C boxes and the stepped E outline as in the 3DMN exhibit; 34-ID-F with its real trapezoidal outline (FDR Fig.
 *   4.58) and the taller roof of the PDR elevation. ATOMIC's shielded pipe crosses 34-ID-E ~0.4 m inboard of the 3DMN beam,
 *   between the micro-station gantry posts and through the nano enclosure walls (collars), as in FDR Fig. 4.58.
 * • Hero: the detector-positioning diffractometer — a 4.4 m boom on a δ ring + floor arc rail (radius ~4.3 m, FDR plan),
 *   posed at δ = 30°, γ = 16.8° (2θ = 34°, Au 111 at 9 keV) with a 2.5 m flight tube and the BCDI detector at 3.0 m — the
 *   granite sample platform carrying zoom KB2 and the goniometer, a Laue detector 28 mm from the crystal, an SDD at 90°, and an
 *   animated envelope of the two-stage zoom KB (KB1 in 34-ID-C → sliding intermediate focus → KB2), lateral scale ×~30.
 * • Exaggerations (stated in the dossier/part comments): undulator gaps 20 mm (real ≥ 8.5 mm), DCM crystal offset ×18, the
 *   nanocrystal drawn 6 mm, zoom envelope ×~30 laterally. KB and DCM deflection senses are not documented (drawn illustratively).
 */

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const sampleX = SAMPLE_X;

/** A component at a station-relative offset from the sample (focus). */
function atSample(o: THREE.Vector3, extra: CompOverride): CompOverride {
  return { distanceM: sampleX + o.x, side: S_SIDE + o.z, dy: o.y, ...extra };
}
/** 3DMN partner items: explicit lateral position from the true beam geometry. */
const dmn = (x: number, extra: CompOverride = {}): CompOverride => ({ side: dmnSide(x), ...extra });
/** Shield-block apertures for both beams (offsets relative to a null-branch component at side 0). */
const holes = (x: number) => [atomicSide(x), dmnSide(x)];

const layout: BeamlineLayout = {
  id: 'atomic',
  cantMrad: CANT_MRAD,
  branches: {
    atomic: { ...BRANCH_ATOMIC, label: 'ATOMIC (inboard)' },
  },
  partnerBranches: ['3dmn'],
  beamEndM: { atomic: 78.7 },
  rulerSide: -3.1,
  comp: {
    // ---------------------------------------------------------------- straight section
    'u28-undulator-3dmn': dmn(-1.2, { side: 0, build: (c) => planarUndulator({ beamY: c.beamY, L: 2.1, periodMm: 28 }), pinUp: 0.75 }),
    'canting-magnets': { build: (c) => cantingMagnets(c.beamY), pinUp: 0.5 },
    'atomic-revolver-undulator': {
      build: (c) => revolverUndulator({ beamY: c.beamY, L: 2.1 }),
      pinUp: 0.85,
      shot: { r: 2.4, dir: [-0.55, 0.45, -0.9] },
    },
    // ---------------------------------------------------------------- front end (tunnel) + 34-ID-A (FOE)
    // schematic CUFE train ~15.6–24.4 m (only the 19.4 m mask position is documented); its chamber runs through the ratchet
    // wall into the exit-mask stub in 34-ID-A
    'cufe-front-end': {
      build: (c) => frontEndTrain(c.beamY, -3.8, 5.64),
      pinUp: 0.55,
      shot: { r: 4.4, dir: [-0.2, 0.9, -0.38], target: [0.7, -0.05, 0.25] },
    },
    'fe-exit-mask': { build: (c) => shieldBlock({ beamY: c.beamY, len: 0.22, mat: 'copper', holes: holes(25.4), hole: 0.012 }), pinUp: 0.4 },
    'fe-exit-collimator': { build: (c) => shieldBlock({ beamY: c.beamY, len: 0.25, mat: 'tungsten', holes: holes(26.1), hole: 0.016 }), pinUp: 0.4 },
    // from outboard: at 26.8 m sector 35's storage-ring tunnel wall is only ~0.2 m inboard of the beam, so an infield
    // camera would look at the slits through it
    'atomic-wb-slits': { build: (c) => slitUnit({ beamY: c.beamY, size: 0.2, w: 0.24, outJaw: 0.012 }), pinUp: 0.42, shot: { r: 1.1, dir: [-0.6, 0.55, 0.8] } },
    'w-collimator': { build: (c) => shieldBlock({ beamY: c.beamY, len: 0.2, mat: 'tungsten', holes: holes(28.4), hole: 0.016 }), pinUp: 0.4 },
    'pb-collimator': { build: (c) => shieldBlock({ beamY: c.beamY, len: 0.2, w: 0.36, h: 0.36, mat: 'lead', holes: holes(28.7), hole: 0.018 }), pinUp: 0.4 },
    '3dmn-outboard-mirror': dmn(29.6, { build: (c) => foeMirror({ beamY: c.beamY, deflect: 1 }), pinUp: 0.5 }),
    'atomic-white-beam-mirror': {
      build: (c) => foeMirror({ beamY: c.beamY, deflect: -1 }),
      pinUp: 0.5,
      // steep and close to the beam: sector 35's storage-ring tunnel wall runs < 1 m inboard of the beam here (top 2 m
      // above it), so a lower or wider infield camera would sit inside that wall
      shot: { r: 1.8, dir: [-0.45, 1.2, -0.3] },
    },
    'atomic-secondary-collimator': { build: (c) => shieldBlock({ beamY: c.beamY, len: 0.18, mat: 'lead', holes: [0, dmnSide(32.2) - atomicSide(32.2)], hole: 0.02 }), pinUp: 0.4 },
    // steep, for the same reason as the mirror above (the tunnel wall is ~1.2 m inboard of the beam at 33 m)
    'pink-mask-wb-stop': { build: (c) => whiteBeamStop(c.beamY, holes(34.0)), pinUp: 0.55, shot: { r: 2.0, dir: [-0.6, 1.0, -0.4], target: [-0.3, 0, 0] } },
    'shielded-transport-1': {
      side: 0.04,
      build: (c) => shieldedPipe({ beamY: c.beamY, len: 6.5, rIn: 0.13, rOut: 0.17, supports: [0.35, 3.25, 6.15] }),
      pinUp: 0.4,
    },
    // ---------------------------------------------------------------- 34-ID-B
    'atomic-photon-mask': { build: (c) => photonMask({ beamY: c.beamY }), pinUp: 0.38 },
    'brems-stop': { build: (c) => shieldBlock({ beamY: c.beamY, len: 0.25, w: 0.56, h: 0.36, mat: 'lead', holes: holes(47.3), hole: 0.02 }), pinUp: 0.4 },
    // ---------------------------------------------------------------- 34-ID-C (optics)
    'atomic-bpm': { build: (c) => bpm({ beamY: c.beamY }), pinUp: 0.32 },
    'atomic-coherence-slits': { build: (c) => slitUnit({ beamY: c.beamY, size: 0.2 }), pinUp: 0.42, shot: { r: 1.2, dir: [-0.6, 0.55, -0.8] } },
    'atomic-hdcm': { build: (c) => hdcm({ beamY: c.beamY, R: 0.24, bypass: false, heater: true, sense: -1 }), pinUp: 0.55, shot: { r: 1.7, dir: [-0.45, 0.8, -0.6] } },
    '3dmn-hdcm': dmn(DMN.hdcmX, { build: (c) => hdcm({ beamY: c.beamY, R: 0.24, bypass: true, heater: true, sense: 1 }), pinUp: 0.55 }),
    'atomic-zoom-kb1': {
      build: (c) =>
        kbPair({
          beamY: c.beamY,
          mirrors: [
            { x: KB1.hX - KB1.x, len: KB1.len, plane: 'H', side: -1 },
            { x: KB1.vX - KB1.x, len: KB1.len, plane: 'V' },
          ],
          vessel: [-0.44, 0.44],
          w: 0.26,
          h: 0.3,
          zOff: -0.05,
        }),
      pinUp: 0.42,
      shot: { r: 1.5, dir: [-0.4, 0.75, -0.75] },
    },
    'atomic-pink-shutter': { build: (c) => pinkShutter(c.beamY), pinUp: 0.72 },
    // ---------------------------------------------------------------- 34-ID-E (3DMN hutch, ATOMIC passes through)
    'atomic-transport-through-e': {
      build: (c) => {
        const g = shieldedPipe({
          beamY: c.beamY,
          len: PIPE_E.x1 - PIPE_E.x0,
          rIn: PIPE_E.rIn,
          rOut: PIPE_E.rOut,
          supports: PIPE_E.supports.map((x) => x - PIPE_E.x0),
        });
        // follow the drawn ATOMIC beam (chord of the engine ramp across 34-ID-E; ≤ 1 cm from it)
        g.rotation.y = -Math.atan2(atomicSide(PIPE_E.x1) - atomicSide(PIPE_E.x0), PIPE_E.x1 - PIPE_E.x0);
        return g;
      },
      pinUp: 0.35,
      // wide enough for the whole of 34-ID-E, with the target close enough to the pipe's upstream end (its pin anchor)
      // that the selected pin stays in frame
      shot: { r: 9, dir: [-0.3, 0.72, -0.62], target: [3.2, -0.2, 0.25] },
    },
    '3dmn-instruments': dmn(DMN.microX, {
      build: () => {
        const z0 = dmnSide(DMN.microX);
        const zE = dmnSide(DMN.nanoEncl0) - z0; // enclosure walls as in the 3DMN exhibit: −0.62 / +0.70 m about the 3DMN beam
        return dmnContext({
          nano: v(DMN.nanoX - DMN.microX, 0, dmnSide(DMN.nanoX) - z0),
          encl: { x0: DMN.nanoEncl0 - DMN.microX, x1: DMN.nanoEncl1 - DMN.microX, zIn: zE - 0.62, zOut: zE + 0.7 },
        });
      },
      pinUp: 1.0,
      shot: { r: 7.5, dir: [-0.3, 0.75, 0.6], target: [2.8, -0.3, 0.05] },
    }),
    // ---------------------------------------------------------------- 34-ID-F (ATOMIC endstation)
    'atomic-preconditioning-platform': { distanceM: PRECOND_X, side: atomicSide(PRECOND_X), build: (c) => preconditioningPlatform({ beamY: c.beamY }), pinUp: 0.32 },
    'atomic-zoom-kb2': atSample(v(KB2.x - sampleX, 0, 0), {
      build: () => kb2(v(KB2.x - sampleX, 0, 0)),
      pinUp: 0.3,
      shot: { r: 1.15, dir: [-0.35, 0.55, -0.75], target: [0.1, -0.08, 0] },
    }),
    // anchored on the granite's inboard face so its pin sits on the platform, clear of the KB2 vessel and the sample pins
    'atomic-sample-diffractometer': atSample(v(-0.1, -0.62, -0.45), {
      build: () => sampleDiffractometer(v(-0.1, -0.62, -0.45)),
      pinUp: -0.2,
      shot: { r: 1.9, dir: [-0.55, 0.5, -0.7], target: [0.1, 0.3, 0.45] },
    }),
    // close-up from outboard-above: the Laue detector's face sits behind the crystal, the SDD points in from the right and
    // the flight-tube entrance is in view (from inboard the Laue housing blocks the stages)
    'atomic-sample-stages': atSample(v(0, 0, 0), { build: () => sampleStages(), pinUp: 0.08, shot: { r: 0.46, dir: [0.5, 0.5, 0.72], target: [0, -0.1, 0] } }),
    'atomic-sample-environments': atSample(v(0, 0, 0), { build: () => environmentCell(), pinUp: 0.16, shot: { r: 0.16, dir: [0.25, 0.6, 0.75] } }),
    'laue-detector': atSample(LAUE_REL, { build: () => laueDetector(), pinUp: 0.2, shot: { r: 0.34, dir: [0.3, 0.5, 0.82], target: [-0.02, -0.01, 0.03] } }),
    'fluorescence-detector': atSample(SDD_REL, { build: () => fluorescenceDetector(), pinUp: 0.12, shot: { r: 0.55, dir: [-0.45, 0.6, 0.65], target: [0, 0, -0.12] } }),
    'detector-arm': atSample(ARM_MID_REL, { build: () => detectorArm(), pinUp: 0.45, shot: { r: 5.0, dir: SHOT.armBroadside, target: [-0.45, -0.45, -0.25] } }),
    'flight-tube': atSample(TUBE_MID_REL, { build: () => flightTube(), pinUp: 0.22, shot: { r: 1.7, dir: SHOT.armBroadside } }),
    'bcdi-area-detector': atSample(DET_REL, { build: () => bcdiDetector(), pinUp: 0.25, shot: { r: 0.5, dir: SHOT.detFace } }),
    'atomic-pink-beam-stop': { build: (c) => pinkBeamStop(c.beamY), pinUp: 0.45, shot: { r: 2.6, dir: [-0.7, 0.6, -0.55], target: [-0.6, 0, 0] } },
  },
  enclosure: {
    '34-ID-A': HUTCH_A,
    Transport: { hidden: true }, // 36–42.5 m: no hutch, only the shielded-transport-1 pipe across the floor (short name keeps the subway-map labels apart)
    '34-ID-B': HUTCH_B,
    '34-ID-C': HUTCH_C,
    '34-ID-E': { outline: E_OUTLINE },
    '34-ID-F': { outline: F_OUTLINE, heightM: F_HEIGHT },
  },
  // the diffracted beam is drawn in custom() (the engine cone's 5 cm minimum radius would swamp the 28 mm sensor)
  scatter: [],
  quietPins: [
    'u28-undulator-3dmn', 'fe-exit-mask', 'fe-exit-collimator', 'w-collimator', 'pb-collimator', '3dmn-outboard-mirror', 'atomic-secondary-collimator',
    'diag-flag', 'pink-mask-wb-stop', 'shielded-transport-1', 'atomic-photon-mask', 'brems-stop', 'atomic-bpm', '3dmn-hdcm', '3dmn-instruments',
    'atomic-preconditioning-platform', 'atomic-sample-environments', 'fluorescence-detector', 'flight-tube',
  ],
  people: [
    { x: 69.2, side: S_SIDE - 1.45, rotY: -Math.PI / 2, pose: 'point' },
    { x: 49.0, side: 1.45, rotY: Math.PI / 2 }, // 34-ID-C aisle, upstream of the DCM close-up's field of view
  ],
  // from the infield (inboard) side: downstream reads left → right like the subway map, the neighbouring sector-33 hutch
  // train stays behind the beamline, and 34-ID-F (the reason to visit) sits large and clear of the side panel; the
  // in-tunnel source is just off the left edge (pins 1–3 are one click away on the map)
  camera: { along: 0.68, side: -0.85, up: 0.55, distanceScale: 1.0 },
  custom: (ctx) => custom(ctx),
};

function custom(ctx: BuildCtx): void {
  const g = ctx.group;
  const beamY = ctx.beamY;
  const at = (x: number, side: number, up = 0) => ctx.at(x, side, up);

  // ---- partner 3DMN beam (true geometry): white inside/after the U28, pink after its outboard mirror, dashed into the nano station
  const dmnPts = (x0: number, x1: number, step = 1) => {
    const pts: THREE.Vector3[] = [];
    for (let x = x0; x < x1; x += step) pts.push(at(x, dmnSide(x)));
    pts.push(at(x1, dmnSide(x1)));
    return pts;
  };
  ctx.addBeam(dmnPts(-2.25, 29.6, 2), 'white', { width: 1.7, opacity: 0.55, pulses: false });
  ctx.addBeam(dmnPts(29.6, DMN.microX), 'pink', { width: 1.6, opacity: 0.5, pulses: false });
  ctx.addBeam(dmnPts(DMN.microX + 0.15, DMN.nanoX), 'pink', { width: 1.4, opacity: 0.4, pulses: false, dashed: true });
  // ATOMIC's X-rays start inside the revolver (the engine beam starts at the straight centre)
  ctx.addBeam([at(0.15, 0), at(0, 0)], 'white', { width: 2.6, pulses: false });

  // ---- 3DMN context hardware without a dossier entry: its pink shutter next to ATOMIC's, and its pink beam stop
  const sh2 = pinkShutter(beamY);
  sh2.position.copy(at(DMN.shutterX, dmnSide(DMN.shutterX)));
  const bs = pinkBeamStop(beamY);
  bs.position.copy(at(DMN.stopX, dmnSide(DMN.stopX)));
  g.add(sh2, bs);
  ctx.addLabel('3DMN beam (partner)', at(58.2, dmnSide(58.2), 0.32), { maxDist: 22 });

  // ---- ATOMIC pipe: wall pass-throughs (C/E wall, nano enclosure walls, E/F wall), stub pipes in 34-ID-F
  for (const x of [55.0, DMN.nanoEncl0 - 0.012, DMN.nanoEncl1 + 0.012, 67.5]) {
    const c = collar(PIPE_E.rOut);
    c.position.copy(at(x, atomicSide(x)));
    g.add(c);
  }
  const pipeF = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.16, 16), new THREE.MeshStandardMaterial({ color: 0xb8c2cc, roughness: 0.5, metalness: 0.7 }));
  pipeF.rotation.z = Math.PI / 2;
  pipeF.position.copy(at(67.58, atomicSide(67.58)));
  g.add(pipeF);
  const st = pipeStand(beamY, 0.025);
  st.position.copy(at(KB2.v0 - 0.2, atomicSide(KB2.v0 - 0.2)));
  g.add(st);

  // ---- zoom KB envelope: intermediate focus slides between KB1 and KB2 (lateral ×~30; schematic)
  const env = zoomEnvelope();
  g.add(env.group);
  const rA = 0.012;
  const pt = (x: number) => at(x, ctx.sideAt('atomic', x));
  const a = pt(ZOOM.from);
  const b = pt(ZOOM.kb2);
  const f = pt(sampleX);
  const update = (u: number) => {
    const q = ZOOM.qMin + (ZOOM.qMax - ZOOM.qMin) * u;
    const xI = ZOOM.from + q;
    const rB = Math.min(0.036, (rA * (ZOOM.kb2 - xI)) / q);
    env.set(xI, a, pt(xI), b, f, rA, Math.max(0.0012, rB));
  };
  update(0.35);
  if (!REDUCED_MOTION) ctx.onFrame((_dt, t) => update(0.5 - 0.5 * Math.cos((2 * Math.PI * t) / 18)));
  ctx.addLabel('Zoom optics: the intermediate focus slides between the two KB pairs', at(61.2, atomicSide(61.2) - 0.05, 0.42), { maxDist: 16 });

  // ---- the diffracted (Bragg) beam: sample → BCDI detector through the flight tube; the coherent speckle fan is drawn as a
  // narrow cone that just covers the 28 mm sensor
  const S = at(sampleX, S_SIDE);
  const D = S.clone().add(DET_REL);
  ctx.addBeam([S, D], 'mono', { width: 1.8 });
  const fan = diffractedFan(DET_REL.length(), 0.012);
  fan.position.copy(S);
  fan.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), DET_REL.clone().normalize());
  g.add(fan);

  // ---- keep the travelling pulses from blooming over the 0.3–0.5 m close-ups of the sample, Laue detector and SDD
  tamePulses(g);
}

export default layout;
