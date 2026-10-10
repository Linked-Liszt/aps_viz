/**
 * PtychoProbe (33-ID) geometry, metres from the ID source point (straight-section centre).
 * Frame: +X downstream, +Y up (0 = beam height 1.4 m; floor at −1.4), +Z outboard.
 *
 * Sources (see the dossier for references):
 * • Component distances: FDR 2019 Table 4.39 (r1); 2024 elevation drawing on the feature page (r5) for the
 *   detector-mover tank (≈70.6–76.6 m), the instrument footprint (≈69.2–70.5 m) and the pipe supports in 33-ID-C.
 * • Hutch outlines: scaled from FDR Fig. 4.31 (plan) and the 2024 elevation (±0.2 m). On that plan the 33-BM hutches and
 *   the 33-ID-C control room lie on the same side of the ID line; the BM line of a sector leaves 5.06° downstream on the
 *   inboard side, so that side is INBOARD (−Z here).
 * • Instrument stack proportions: FDR Fig. 4.37 schematic, scaled so the beam sits at 1.4 m; chamber top ≈1.68 m
 *   (elevation drawing shows the endstation ≈1.5–1.7 m tall).
 * • Detector-mover tank: 5.6 m (IRELEC, r16); diameter ≈0.76 m from the elevation/plan (the vendor rendering, with a
 *   person for scale, agrees to ±0.1 m).
 */

export const FLOOR = -1.4;

export const UND = { center: 1.3, length: 2.35, periodMm: 21 };

/**
 * Outlines are wound CLOCKWISE in (x, z) (upstream-inboard → outboard → downstream), the engine's convention: wall normals
 * then point outward and its back-face glass hides the near walls (cut-away).
 *
 * 33-ID-A, inner wall faces read off FDR Fig. 4.31 (27.3 px/m): the outboard wall (the line carrying the removed
 * mini-hutch) splays from ≈0.22 m at 23.6 m to ≈0.9 m at the extension's end wall (36.0 m); the inboard wall sits ≈0.83 m
 * from the beam over the FE exit table and steps out to ≈1.3 m at ≈26.4 m (old FOE and the 'Extend FOE' addition). */
export const FOE_OUTLINE: [number, number][] = [
  [23.6, -0.83],
  [23.6, 0.22],
  [36.0, 0.9],
  [36.0, -1.32],
  [26.4, -1.32],
  [26.4, -0.83],
];
/** Roof heights scaled from the 2024 elevation drawing (beam 1.40 m = 38 px → 27.2 px/m): 33-ID-A and 33-ID-B ≈3.45 m. */
export const FOE_HEIGHT = 3.45;
export const B_HEIGHT = 3.45;

/** 33-ID-C: chamfered on the inboard side at the downstream end (≈73.4 → 77.5 m). */
export const C_OUTLINE: [number, number][] = [
  [57.4, -2.35],
  [57.4, 1.75],
  [77.5, 1.75],
  [77.5, -0.67],
  [73.4, -2.35],
];
/** 33-ID-C roof ≈4.4 m on the 2024 elevation (taller than the A/B hutches). */
export const C_HEIGHT = 4.4;

/** Inboard control room + vestibule along 33-ID-C (depth not documented; 3 m assumed). */
export const CONTROL = { x0: 57.4, x1: 71.2, depth: 3.0, wallZ: -2.35 };

export const M1_X = 28.3;
export const M1_LEN = 0.9; // footprint of a 2 mm beam at 2.5 mrad ≈ 0.9 m (estimate; length not published)
export const HDCM_X = 30.6;
export const DMM_X = 31.9;
export const M2_X = 33.1;
export const M2_LEN = 0.8;

export const SSA1_X = 47.9;
export const SSA2_X = 57.8;

export const ST1 = { x0: 35.7, x1: 41.5 };
export const ST2 = { x0: 51.8, x1: 57.5 };

/** Sample (point of interest) and the endstation stack, relative heights in the beam frame. */
export const SAMPLE_X = 69.7;
export const ZP_X = 69.69; // optic ~10 mm upstream (5.8–23 mm focal lengths)
export const OSA_X = 69.695;
export const INST = {
  x0: -0.58, // relative to the sample
  x1: 0.58,
  z0: -0.62,
  z1: 0.62,
  couplingTop: FLOOR + 0.1,
  baseTop: -0.72,
  crsyTop: -0.48,
  crsxTop: -0.28,
  chamberTop: 0.28,
  chamber: { x0: -0.46, x1: 0.44, z0: -0.5, z1: 0.5, floor: -0.28, plate: -0.24 },
};
export const WEDGE_DEG = 5.5;

/** XRF detector at 90° in the horizontal plane (side undocumented); built toward −Z, placed outboard by the layout. */
export const XRF = { tipZ: -0.02, wallZ: -0.5, bodyZ0: -0.56, bodyZ1: -0.9 };

/** Detector mover. */
export const TANK = { x0: 70.65, x1: 76.25, capFront: 70.55, capRear: 76.6, r: 0.38, flanges: [72.5, 75.05] };
export const COUPLING = { chamberPort: 70.14, valve0: 70.28, valve1: 70.4 };
export const SELUN_FACE = SAMPLE_X + 0.075;
export const EIGER_FACE = SAMPLE_X + 5.0;
export const RAILS = { x0: 70.68, x1: 76.15, y: -0.24, z: 0.13 };

export const BEAM_STOP_X = 77.1;

/** Pipe supports read from the 2024 elevation drawing. */
export const C_PIPE_STANDS = [60.2, 61.7, 63.3, 64.9, 66.9, 68.3];
export const B_PIPE_STANDS = [43.0, 44.3, 45.5, 46.6];
