/**
 * 8-ID XPCS geometry, metres from the source point (centre of the ID straight), beam frame (+Z outboard).
 *
 * Component positions: APS-U FDR (2019) Table 4.33 via the dossier. Hutch outlines, table extents and the control room
 * are read from the 2021 'XPCS Beamline overview' plan (Dufresne & Narayanan, APS/CNM Users Meeting; scale bar 24–82 m,
 * ~26.7 px/m, read to ±0.3 m). In that plan the control room and the 8-BM line lie on the outboard side, 9-BM inboard.
 */
export const DEG = Math.PI / 180;

/** 8-ID-E wide-angle station. */
export const WA = {
  sampleX: 56.3,
  /** illustrative scattering angle: first sharp diffraction peak of a metallic glass (q ≈ 2.6 Å⁻¹) at ~10 keV → 2θ ≈ 30° */
  twoTheta: 30 * DEG,
  /** LDDP sample–detector distance (FDR 8ID-DT-1 at 60.0 m ≈ 3.7 m from the sample; range 2.5–4 m) */
  lddpR: 3.7,
  /** vertical-arm detector distance (1.5–2 m) */
  nearR: 1.6,
};
export const LDDP_POS = { x: WA.sampleX + WA.lddpR * Math.cos(WA.twoTheta), side: WA.lddpR * Math.sin(WA.twoTheta) };
export const NEAR_POS = { x: WA.sampleX + WA.nearR * Math.cos(WA.twoTheta), up: WA.nearR * Math.sin(WA.twoTheta) };

/** 8-ID-E upstream 6-DOF optics table (dark grey, MEDSI 2020 render) and its nose under the window and guard slits. */
export const E_TABLE = { x0: 54.25, x1: 55.58, half: 0.45, top: -0.35, noseX1: 56.03, noseHalf: 0.14 };
/** 8-ID-E downstream table carrying BD-5, SL-7, CRL-2 and SH-3 (plan: ~61.0–63.6 m). */
export const E_TABLE2 = { x0: 60.75, x1: 63.6, half: 0.42, top: -0.45 };

/** 8-ID-I small-angle station. */
export const SA = {
  sampleX: 67.5,
  tubeX0: 68.0,
  detX: 79.0,
  /** illustrative swing of the flight tube shown as a floor arc (0–5° toward inboard in the 2021 plan) */
  swing: 5 * DEG,
};
export const I_TABLE = { x0: 64.1, x1: 66.8, half: 0.45, top: -0.42 };

/** Hutch heights read from the 2021 elevation (8-ID-E is the tallest, to clear the vertical detector arm). */
export const HEIGHT = { A: 3.1, D: 3.4, E: 4.2, I: 3.4 };

/** Floor outlines (x along the beam, z outboard), clockwise seen from above. */
export const OUTLINE_E: [number, number][] = [
  [53.93, -1.37],
  [53.93, 4.05],
  [61.8, 4.05],
  [61.8, 1.85],
  [63.7, 1.85],
  [63.7, -2.2],
];
export const OUTLINE_I: [number, number][] = [
  [63.7, -2.2],
  [63.7, 1.9],
  [75.1, 1.9],
  [75.1, 1.6],
  [78.6, 1.6],
  [81.6, 0.0],
  [80.7, -2.4],
  [70.7, -2.77],
];
/** Control room (outboard wedge between the hutch walls and the aisle). */
export const OUTLINE_CR: [number, number][] = [
  [54.1, 4.05],
  [54.1, 7.3],
  [55.1, 8.83],
  [56.67, 8.83],
  [75.55, 1.9],
  [61.8, 1.9],
  [61.8, 4.05],
];
/** Outer (aisle) wall of the control room: z = CR_WALL(x). */
export const CR_WALL = (x: number) => 8.83 - ((8.83 - 1.9) / (75.55 - 56.67)) * (x - 56.67);

/** Shielded-transport stands (plan) between 8-ID-A and 8-ID-D. */
export const TRANSPORT_STANDS = [37.2, 39.3, 41.6, 43.8, 46.1];
