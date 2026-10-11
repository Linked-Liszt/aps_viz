/**
 * CHEX (28-ID) true plan geometry, in the beamline group's local frame: +X downstream along the OUTBOARD canted beam
 * (the tunable branch; the group is rotated +0.5 mrad so this beam runs along z = 0), +Y up (0 = beam height 1.4 m),
 * +Z outboard (away from the ring).
 *
 * Sources
 * • Branch take-off points and path lengths: FDR 2019 Tables 4.5-4.9 (every tabulated distance is a PATH length along
 *   its own branch from the straight-section centre).
 * • Deflection angles from the crystal reflections at fixed energy (2θ: C(111)@15 keV 23.15°, C(220)@25 keV 22.68°,
 *   C(400)@35 keV 22.91°, Si(220)@75 keV 4.93°, Si(400)@105 keV 4.98°; PDR Tables 6.10/6.13). The model uses 23.15°,
 *   22.8° and 4.95°.
 * • Hutch outlines: digitised from FDR Fig. 4.2 (plan with metre scale, 25.85 px/m; main beam axis = image row 407),
 *   cross-checked against the 2025 as-built ray-trace plan (MEDSI'25 TUOA01 Fig. 2; hutch G follows the as-built plan,
 *   which differs from the 2019 drawing). Wall positions are good to ~±0.15-0.3 m. Side walls of D/E and F run parallel to their beams and the partition/end walls are perpendicular to them,
 *   exactly as drawn in the FDR plan.
 *
 * No lateral exaggeration is used anywhere: the 1 mrad canting (28 mm at 28 m) and the 23° fan are drawn at true scale.
 */

export const DEG = Math.PI / 180;
/** Canting between the two undulator beams (rad); the inboard (downstream-ID) beam runs at −1 mrad in this frame. */
export const CANT = 0.001;

export interface BranchGeom {
  /** path length (m) at which the branch leaves its parent beam */
  s0: number;
  /** take-off point in the local frame */
  x0: number;
  z0: number;
  /** direction of travel (rad) in the x-z plane, + = toward outboard (+Z) */
  ang: number;
  /** 2θ actually applied by the crystal (deg, for labels/notes) */
  twoThetaDeg: number;
}

const inboardZ = (s: number) => -CANT * s;

export const BR: Record<'tunable' | 'inboard' | 'de' | 'f' | 'g', BranchGeom> = {
  tunable: { s0: 0, x0: 0, z0: 0, ang: 0, twoThetaDeg: 0 },
  inboard: { s0: 0, x0: 0, z0: 0, ang: -CANT, twoThetaDeg: 0 },
  // diamond (111) side-bounce at 28.3 m: 15 keV, 2θ = 23.15° outboard
  de: { s0: 28.3, x0: 28.3, z0: inboardZ(28.3), ang: 23.15 * DEG - CANT, twoThetaDeg: 23.15 },
  // diamond (022)/(004) at 38.3 m: 25/35 keV, 2θ = 22.7-22.9° outboard
  f: { s0: 38.3, x0: 38.3, z0: inboardZ(38.3), ang: 22.8 * DEG - CANT, twoThetaDeg: 22.8 },
  // silicon (022)/(004) at 40.2 m: 75/105 keV, 2θ ≈ 4.95° inboard
  g: { s0: 40.2, x0: 40.2, z0: inboardZ(40.2), ang: -4.95 * DEG - CANT, twoThetaDeg: 4.95 },
};

export type BranchId = keyof typeof BR;

export interface P2 {
  x: number;
  z: number;
}

/** Point on a branch at path length s (m from the straight-section centre), u metres to its outboard side. */
export function bp(b: BranchId, s: number, u = 0): P2 {
  const g = BR[b];
  const d = s - g.s0;
  const c = Math.cos(g.ang);
  const n = Math.sin(g.ang);
  return { x: g.x0 + d * c - u * n, z: g.z0 + d * n + u * c };
}

/** Lateral position of the inboard (shared fixed-energy) beam at x. */
export const inboardSide = (x: number) => inboardZ(x);

/** rotY that turns a part built along +X onto a branch (three.js: rotY = −angle toward +Z). */
export const branchRotY = (b: BranchId) => -BR[b].ang;

// ------------------------------------------------------------------ station positions (path lengths, FDR Table 4.5)

export const STATION = {
  B: 64.5,
  C: 72.0,
  D: 35.5,
  E: 43.0,
  F1: 45.5,
  F2: 49.5,
  G1: 52.0,
  G2: 56.0,
} as const;

// ------------------------------------------------------------------ hutch outlines (plan polygons in x,z)

/** Digitised z position of the outboard wall of 28-ID-A. Branches D and F are directly beside it. */
export const A_OUT = 1.8;
const GAP = 0.05; // keeps neighbouring translucent walls from z-fighting

/** Rectangle in a branch's own frame (s along the beam, u across), returned as x,z corners. */
function branchRect(b: BranchId, s0: number, s1: number, uIn: number, uOut: number): P2[] {
  return [bp(b, s0, uIn), bp(b, s1, uIn), bp(b, s1, uOut), bp(b, s0, uOut)];
}

/** Intersection of the branch line at offset u with the line z = zc (returns s). */
function sAtZ(b: BranchId, u: number, zc: number): number {
  const g = BR[b];
  const n = Math.sin(g.ang);
  const c = Math.cos(g.ang);
  return g.s0 + (zc - g.z0 - u * c) / n;
}

// D/E side walls: 2.0 m outboard and 2.18 m inboard of the D/E beam (FDR Fig. 4.2)
export const DE_U = { out: 2.0, in: -2.18 };
// F side walls: 1.77 m outboard (shared with D/E's inboard wall) and 1.88 m inboard of the F beam
export const F_U = { out: 1.77 - GAP, in: -1.88 };
/** D/E partition (perpendicular to the beam) and branch ends, path lengths. */
export const DE_SPLIT = 40.0;
export const E_END = 48.5;
export const F_END = 54.8;

/** 28-ID-D: clipped by A's outboard wall below and by the x = 30.35 m wall upstream (FDR plan). */
export function hutchD(): P2[] {
  const zb = A_OUT + GAP;
  const sIn = sAtZ('de', DE_U.in, zb); // where D/E's inboard wall meets the top of A
  const upOut = sAtZ('de', DE_U.out, 3.09); // outboard wall meets the x = 30.35 upstream wall at z ≈ 3.09
  const pUp = bp('de', upOut, DE_U.out);
  return [{ x: pUp.x, z: zb }, pUp, bp('de', DE_SPLIT, DE_U.out), bp('de', DE_SPLIT, DE_U.in), bp('de', sIn, DE_U.in)];
}

export function hutchE(): P2[] {
  return branchRect('de', DE_SPLIT + 0.06, E_END, DE_U.in, DE_U.out);
}

/** 28-ID-F: starts at x ≈ 39.9 against A, outboard wall shared with D/E, inboard wall parallel to the beam. */
export function hutchF(): P2[] {
  const zb = A_OUT + GAP;
  const sIn = sAtZ('f', F_U.in, zb);
  const sUp = sAtZ('f', F_U.out, 2.52);
  const pUp = bp('f', sUp, F_U.out);
  return [{ x: pUp.x, z: zb }, pUp, bp('f', F_END, F_U.out), bp('f', F_END, F_U.in), bp('f', sIn, F_U.in)];
}

/**
 * 28-ID-G as BUILT (2025 ray-trace plan, MEDSI'25 TUOA01 Fig. 2, read at its 5 m scale = 17.3 px/m): upstream wall at
 * 47.55 m (the 2019 FDR plan had 44.9 m), outboard wall 0.43 m outboard of the tunable axis so the ST-1 transport runs
 * inside G hugging that wall (FDR: likewise within ±0.45 m of the axis), inboard wall from 1.95 m to 2.72 m inboard,
 * roughly parallel to the G beam. A, B and C agree with the FDR outlines to ~0.2 m. Between A (43.3 m) and G the
 * as-built plan shows a ~2.6 m double-door walk-through vestibule; the shielded pipes cross it (not modelled as a room).
 */
export const G_X0 = 47.55;
export const G_OUT = 0.43;
export function hutchG(): P2[] {
  return [
    { x: G_X0, z: G_OUT },
    { x: 60.62, z: G_OUT },
    { x: 60.62, z: -2.72 },
    { x: G_X0, z: -1.95 },
  ];
}

/** 28-ID-A with its narrow upstream nose; the inboard wall is the (angled) ratchet wall of the ring tunnel. */
export function hutchA(): P2[] {
  return [
    { x: 23.6, z: 0.9 },
    { x: 26.45, z: 0.9 },
    { x: 26.45, z: A_OUT },
    { x: 43.4, z: A_OUT },
    { x: 43.4, z: -2.15 },
    { x: 38.5, z: -1.62 },
    { x: 38.5, z: -0.97 },
    { x: 23.6, z: -0.42 },
  ];
}

export function hutchB(): P2[] {
  return [
    { x: 60.7, z: 2.62 },
    { x: 69.5, z: 2.62 },
    { x: 69.5, z: -2.32 },
    { x: 60.7, z: -1.98 },
  ];
}

/** 28-ID-C: the outboard wall angles in toward the beam at the downstream end (FDR plan). */
export function hutchC(): P2[] {
  return [
    { x: 69.7, z: 2.62 },
    { x: 72.66, z: 2.62 },
    { x: 78.45, z: 0.21 },
    { x: 78.45, z: -2.36 },
    { x: 69.7, z: -2.36 },
  ];
}

/**
 * Mini shielded enclosure SE-1 around transfocator 1 of the tunable line (FDR Table 4.6: 48.2-52.2 m), inside hutch G
 * against its outboard wall. Width ~0.72 m (FDR Fig. 4.2 box: +0.40 / −0.33 m about the axis; centre z); its height
 * is not published and is drawn 2.3 m so the P4-40 white-beam shutter fits inside.
 */
export const SE1 = { x0: 48.2, x1: 52.2, w: 0.72, h: 2.3, z: 0.03 };

/**
 * Lateral (outboard) shift of the tunable beam after the horizontal fixed-exit DCM at 35.0 m. The 2025 ray trace notes
 * moving a photon mask 4-8 mm outboard for monochromatic mode; 8 mm is used.
 */
export const TUN_DZ = 0.008;
export const HDCM_X = 35.0;
export const tunableSide = (x: number) => (x > HDCM_X ? TUN_DZ : 0);

/** White-beam shielded transport ST-1 (43.5-60.6 m), interrupted by SE-1. */
export const ST1 = { x0: 43.5, x1: 60.6 };
