import type { BeamlineLayout, BuildCtx } from '../scene/beamline/layout';
import { buildContext } from './polar/context';
import { ARM_APD, ARM_PAD, CRYO_R, gPolar, H_SAMPLE_X, TABLE_TOP, VORTEX } from './polar/geometry';
import { polarizationWaves } from './polar/hero';
import {
  analyzerAPD, beamFlag, beamStopBlock, chopper, compactShutter, dacProbe, dcm, eiger, electromagnet2T, exitCollimator, exitMask, foCollimators, frontEnd,
  hhlMirrors, htsMagnet, huberDiffractometer, imagingStack, interferometerHeads, ionChamber, kb3, kbFixed, magnet4T, magnet911,
  phaseRetarderTank, phaseShifter, pinkBeamStop, polarimeter, ramanStation, sdd, spin, toroidMirror, transportStands,
} from './polar/parts';
import { box, pm } from './polar/kit';
import type * as THREE from 'three';

/**
 * 4-ID POLAR. One straight, non-canted line: two in-line planar undulators → windowless HHL front end → 4-ID-A FOE
 * (HHL mirrors, vertical DCM, diamond phase retarders) → 14 m shielded transport → 4-ID-B (toroids, 2 T electromagnet)
 * → new 4-ID-G (transfocator, KB1, Huber diffractometer + 2 T HTS magnet) → new 4-ID-H (KB2, 9-1-1 T magnet + DAC, 4 T magnet).
 *
 * No `branches`: the stations are in series on the same axis (beam for G/H passes through B). The real lateral offsets
 * (HHLM ~4 mm, DCM 15.6 mm vertical, toroid pair a few mm) are far below what can be seen at hall scale and are not drawn.
 * Hutch walls and the control room follow the 2021 'Sector 4 2024' plan (scaled ±0.3 m); all sizes are true scale except
 * where a comment says a detail is enlarged for visibility (phase plates, mirror stripes, DAC anvils, polarization drawing).
 */

const sideOf = (a: number, r: number) => gPolar(a, r);
const [apdX, apdZ] = sideOf(ARM_APD.twoTheta, ARM_APD.r);
const [padX, padZ] = sideOf(ARM_PAD.twoTheta, ARM_PAD.r);
const [vxX, vxZ] = sideOf(VORTEX.angle, VORTEX.tip);

/** Filter box small enough to sit between the 4-ID-H slits and the KB2 vessel. */
function compactFilter(): THREE.Object3D {
  const g = box(0.12, 0.16, 0.14, pm.steel(), 0.01);
  const legH = -TABLE_TOP - 0.08;
  const leg = box(0.08, legH, 0.1, pm.darkSteel(), 0.005);
  leg.position.y = -0.08 - legH / 2;
  g.add(leg);
  for (let i = 0; i < 3; i++) {
    const act = box(0.016, 0.07, 0.016, pm.black(), 0.002);
    act.position.set(-0.035 + i * 0.035, 0.115, 0);
    g.add(act);
  }
  return g;
}

let piezoMesh: THREE.Mesh | null = null;

const layout: BeamlineLayout = {
  id: 'polar',
  monoAtM: 30.6,
  enclosureDefaults: { heightM: 3.35 },
  enclosure: {
    // FOE: the ratchet wall forms its inboard side, so the room sits mostly outboard of the beam (plan: −0.2…−0.8 / +1.3 m)
    '4-ID-A': { side: 0.35, widthM: 2.1 },
    'Shielded transport': { widthM: 0.9 },
    // Heights from the 2021 town-hall elevation drawing (scaled, ±0.1 m): A and B ~3.4 m, the mini-hutch ~2.0 m, the new
    // G ~4.2 m (2 m detector-arm sweep) and H ~6.2 m (the PDR asked for ~6 m so the 9-1-1 T magnet's sample probe can be
    // top-loaded with the overhead crane).
    '4-ID-MH': { side: -0.1, widthM: 1.2, heightM: 2.0 },
    '4-ID-B': { side: -0.15, widthM: 2.7, heightM: 3.4 },
    '4-ID-G': { side: 0.15, widthM: 4.7, heightM: 4.2 },
    '4-ID-H': { side: 0.15, widthM: 4.7, heightM: 6.2 },
    '4-ID control room': { side: 3.0, widthM: 3.0, heightM: 2.7 },
  },
  comp: {
    // ---------------- source (tunnel)
    'undulator-us-aps30-4': { pinUp: 1.1 },
    'undulator-ds-aps30-9': { pinUp: 1.1 },
    'phase-shifter': { build: (c) => phaseShifter(c.beamY), pinUp: 0.55 },
    // the inboard default camera would sit among the storage-ring magnets; look from outboard at the shutters instead
    'hhl-front-end': { build: (c) => frontEnd(c.beamY), pinUp: 0.75, shot: { r: 3.2, dir: [-0.1, 0.5, 1], target: [0.9, -0.15, 0] } },
    // ---------------- 4-ID-A FOE
    'fe-exit-mask': { build: (c) => exitMask(c.beamY), pinUp: 0.45 },
    'fe-exit-collimator': { build: () => exitCollimator(), pinUp: 0.35 },
    'wb-slits': { pinUp: 0.45 },
    'hhl-mirrors-m1-m2': { build: (c) => hhlMirrors(c.beamY), pinUp: 0.7 },
    'pink-beam-stop': { build: (c) => pinkBeamStop(c.beamY), pinUp: 0.4 },
    // retractable YAG flags on the pipe (the pipe stand at 29.75 m carries it)
    'flags-4ida': { build: () => beamFlag(0, -0.05), pinUp: 0.3 },
    vdcm: { build: (c) => dcm(c.beamY), pinUp: 1.15 },
    'mono-slits': { pinUp: 0.4 },
    'fo-collimators-wb-stop': { build: (c) => foCollimators(c.beamY), pinUp: 0.45 },
    'phase-retarders': {
      build: (c) => {
        const { group, piezo } = phaseRetarderTank(c.beamY);
        piezoMesh = piezo;
        return group;
      },
      pinUp: 0.75,
      // close and steep enough to look into the open tank at the plates
      shot: { r: 1.25, dir: [-0.55, 0.85, -0.75], target: [0.05, -0.03, 0] },
    },
    'shutter-a': { pinUp: 0.85 },
    // ---------------- transport
    'transport-a-to-b': { build: (c) => transportStands(c.beamY, 43.3), pinUp: 0.6 },
    // ---------------- 4-ID-B
    'slits-b-entrance': { pinUp: 0.4 },
    'toroid-m3': { build: (c) => toroidMirror(c.beamY, 'M3'), pinUp: 0.65 },
    'toroid-m4': { build: (c) => toroidMirror(c.beamY, 'M4'), pinUp: 0.65 },
    'flag-4idb-post-toroid': { build: () => beamFlag(0, -0.05), pinUp: 0.3 },
    'diamond-window': { pinUp: 0.35 },
    polarimeter: {
      build: (c) => {
        const { group, rotor } = polarimeter();
        spin(rotor, 'x', 0.35, c.onFrame);
        return group;
      },
      pinUp: 0.4,
    },
    'xbpm-b': { props: { beamY: -TABLE_TOP }, pinUp: 0.4 },
    chopper: {
      build: (c) => {
        const { group, wheel } = chopper();
        spin(wheel, 'x', 9, c.onFrame);
        return group;
      },
      pinUp: 0.35,
    },
    'attenuators-b': { props: { beamY: -TABLE_TOP }, pinUp: 0.5 },
    'kb3-bendable': { build: () => kb3(), pinUp: 0.4 },
    'i0-b': { build: () => ionChamber(TABLE_TOP), pinUp: 0.3 },
    'electromagnet-2t-b': { build: (c) => electromagnet2T(c.beamY), pinUp: 0.95 },
    'diode-i-b': { build: (c) => ionChamber(-c.beamY, 0.05), pinUp: 0.3 },
    // ---------------- 4-ID-G
    'xbpm-g': { props: { beamY: -TABLE_TOP }, pinUp: 0.4 },
    transfocator: { props: { beamY: -TABLE_TOP, cartridges: 8 }, pinUp: 0.45 },
    kb1: {
      // VFM 275 mm centred 362.5 mm and HFM 115 mm centred 157.5 mm before the 67.2 m focus (FDR KB1); slim nose enters
      // the HTS magnet's 100 mm radial opening
      build: (c) => kbFixed(c.beamY, { vfmX: -0.0625, vfmL: 0.275, hfmX: 0.1425, hfmL: 0.115, x0: -0.3, x1: 0.075, noseTo: 0.215, supportY: TABLE_TOP, granite: true }),
      pinUp: 0.45,
    },
    // G close-ups look from outboard-downstream-above, where the detector arm swings and the magnet's radial opening faces
    'diffractometer-g': { build: (c) => huberDiffractometer(c.beamY), pinUp: 1.15, shot: { r: 2.5, dir: [0.3, 0.8, 0.6], target: [0.35, -0.35, 0.4] } },
    'hts-magnet-2t': { build: () => htsMagnet(), pinUp: 0.62, shot: { r: 0.85, dir: [0.5, 0.45, 0.75], target: [0, 0.02, 0] } },
    'imaging-stack': {
      // parked beside the diffractometer (it swaps in for the χ cradle); see the dossier distanceNote
      distanceM: 68.65,
      side: -1.45,
      build: (c) => imagingStack(c.beamY),
      pinUp: -0.25,
    },
    'vortex-g': {
      distanceM: vxX,
      side: vxZ,
      // snout (+x of the part) aimed back at the sample
      rotY: Math.PI - VORTEX.angle,
      build: (c) => sdd({ elements: 4, supportY: -c.beamY + 0.18 }),
      pinUp: 0.3,
      shot: { r: 1.1, dir: [-0.35, 0.6, 0.75], target: [0, -0.05, 0.12] },
    },
    'polarization-analyzer-apd': {
      distanceM: apdX,
      side: apdZ,
      rotY: -ARM_APD.twoTheta,
      build: () => analyzerAPD(),
      pinUp: 0.42,
      shot: { r: 1.0, dir: [0.75, 0.55, 0.35], target: [-0.25, -0.05, -0.25] },
    },
    'eiger-1m': { distanceM: padX, side: padZ, rotY: -ARM_PAD.twoTheta, build: () => eiger(), pinUp: 0.32, shot: { r: 1.4, dir: [-0.3, 0.7, 0.65], target: [-0.25, -0.06, -0.15] } },
    // inferred G/H station shutter (FDR 4ID-SH-2; box on a stand at the G/H wall in the 2021 elevation): generic shutter part
    'shutter-g': { build: (c) => compactShutter(c.beamY), pinUp: 0.6 },
    // ---------------- 4-ID-H
    'xbpm-h': { props: { beamY: -TABLE_TOP }, pinUp: 0.4 },
    'slits-h': { props: { beamY: -TABLE_TOP }, pinUp: 0.45 },
    'attenuators-h': { build: () => compactFilter(), pinUp: 0.35 },
    kb2: {
      // FDR KB2 lengths (VFM 405 mm, HFM 215 mm) with the as-built 600 mm working distance to the 73.3 m sample
      build: (c) => kbFixed(c.beamY, { vfmX: -0.17, vfmL: 0.405, hfmX: 0.19, hfmL: 0.215, x0: -0.42, x1: 0.32, supportY: TABLE_TOP }),
      pinUp: 0.45,
    },
    'i0-h': { build: (c) => ionChamber(-c.beamY + 0.26, 0.05), pinUp: 0.3 },
    // whole cryostat, platform and probe drive in view (the engine's 'sample' radius would frame only the coils)
    'magnet-911': { build: (c) => magnet911(c.beamY), pinUp: 1.6, shot: { r: 2.4, dir: [-0.55, 0.45, -0.9], target: [0, 0.3, 0] } },
    // through the wedge cut in the 9 T split pair, from inboard-above
    'dac-h': { build: () => dacProbe(), pinUp: 0.3, shot: { r: 0.62, dir: [-0.2, 0.6, -0.8], target: [0, 0.01, 0] } },
    'raman-ruby': {
      // outboard breadboard (plan: 73.05–73.67 m, +0.8…+1.7 m); objective reaches the side bore at +0.47 m
      distanceM: 73.36,
      side: 1.27,
      build: () => ramanStation(1.4, CRYO_R + 0.09 - 1.27),
      pinUp: 0.2,
      // from outboard, where the breadboard stands (the magnet hides it from the inboard side)
      shot: { r: 1.5, dir: [-0.35, 0.6, 0.85], target: [0, -0.15, -0.35] },
    },
    'interferometer-h': {
      distanceM: H_SAMPLE_X + 0.2,
      side: -0.62,
      dy: 0.1,
      build: (c) => interferometerHeads(-c.beamY + 0.26 - 0.1, 0.62 - Math.sqrt(CRYO_R ** 2 - 0.2 ** 2)),
      pinUp: 0.25,
    },
    'sdd-7el': {
      side: -(CRYO_R + 0.095),
      rotY: -Math.PI / 2,
      build: (c) => sdd({ elements: 7, supportY: -c.beamY + 0.26 }),
      pinUp: 0.3,
      shot: { r: 1.5, dir: [-0.55, 0.5, -0.75], target: [0, -0.05, -0.25] },
    },
    'transmission-detector-h': { build: (c) => ionChamber(-c.beamY, 0.06), pinUp: 0.3 },
    'magnet-4t': { build: (c) => magnet4T(c.beamY), pinUp: 1.05, shot: { r: 2.3, dir: [-0.6, 0.55, -0.85], target: [0, 0.05, 0] } },
    'beam-stop': { build: (c) => beamStopBlock(c.beamY), pinUp: 0.35 },
  },
  scatter: [
    { from: 'hts-magnet-2t', to: 'eiger-1m', spread: 0.03, kind: 'cone' },
    { from: 'hts-magnet-2t', to: 'polarization-analyzer-apd', spread: 0.03, kind: 'cone' },
    { from: 'hts-magnet-2t', to: 'vortex-g', spread: 0.16, kind: 'fluorescence' },
    { from: 'dac-h', to: 'sdd-7el', spread: 0.07, kind: 'fluorescence' },
  ],
  quietPins: [
    'phase-shifter', 'fe-exit-collimator', 'flags-4ida', 'flag-4idb-post-toroid', 'pink-beam-stop', 'mono-slits', 'fo-collimators-wb-stop', 'slits-b-entrance', 'diamond-window',
    'xbpm-b', 'chopper', 'attenuators-b', 'i0-b', 'diode-i-b', 'xbpm-g', 'shutter-g', 'xbpm-h', 'slits-h', 'attenuators-h', 'i0-h',
    'interferometer-h', 'transmission-detector-h', 'beam-stop',
  ],
  // Whole-line shot from the infield side, looking outward over the storage-ring tunnel: nothing stands between the camera
  // and the hutches (the outboard view puts the lab/office wing in front), and the beam runs left→right like the path strip.
  // The engine centres the target on the full canvas (half of which the side panel covers) and sizes the distance with a
  // 0.82 crop, so the target is pushed downstream (along 0.66) and the camera pulled back sideways (side −1.35): the whole
  // 78 m line, from the undulators to the 4-ID-H beam stop, then fits in the visible area left of the panel at 1440×900.
  camera: { along: 0.66, side: -1.35, up: 0.66 },
  custom: (ctx: BuildCtx) => {
    buildContext(ctx);
    // The engine draws transport enclosures as a polished steel pipe; this one is a lead-shielded line, so give it a lead
    // finish (the polished pipe also blooms in close-ups).
    ctx.group.getObjectByName('enclosure-Shielded transport')?.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.geometry?.type === 'CylinderGeometry') m.material = pm.lead();
    });
    // POLAR's signature: linear-H light before the first diamond plate, a flipping corkscrew after it
    polarizationWaves(ctx, {
      linear: [32.5, 33.24],
      circular: [33.27, 36.05],
      onFlip: (_h, strength) => {
        if (piezoMesh) ((piezoMesh.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.25 + 2.5 * strength);
      },
    });
  },
};

export default layout;
