/**
 * Shared POLAR (4-ID) geometry constants, in metres from the source point unless noted.
 * Positions come from the 2021 'Sector 4 2024' town-hall plan (scaled, ±0.3 m) and the FDR 2019 Table 4.16;
 * see the dossier distanceNotes.
 */
export const DEG = Math.PI / 180;

/** Optical-table top height relative to the beam (beam 1.4 m above the floor, tables ~0.98 m). */
export const TABLE_TOP = -0.42;

/** 4-ID-G Huber diffractometer sample position and the two branches of the split detector arm (outboard side). */
export const G_SAMPLE_X = 67.2;
/** The sample-circle setting shown in the model (μ = θ for a 60° reflection). */
export const G_MU = 30 * DEG;
export const ARM_APD = { twoTheta: 60 * DEG, r: 0.9 };
/** PAD branch, 25° from the analyzer branch. */
export const ARM_PAD = { twoTheta: 35 * DEG, r: 1.5 };
/** Arm beams run just below the scattering plane. */
export const ARM_Y = -0.15;
/** Vortex SDD: looks at the sample from the outboard side, slightly upstream of 90°. */
export const VORTEX = { angle: 95 * DEG, tip: 0.17 };

/** Point at scattering angle a (radians, + toward outboard) and radius r from the 4-ID-G sample, as [x, side]. */
export function gPolar(a: number, r: number): [number, number] {
  return [G_SAMPLE_X + r * Math.cos(a), r * Math.sin(a)];
}

/** 4-ID-H 9-1-1 T magnet. */
export const H_SAMPLE_X = 73.3;
export const CRYO_R = 0.38;

/** Optical tables (x0, x1 along the beam; half-width across). */
export const TABLES = {
  B: { x0: 57.5, x1: 59.95, half: 0.6 },
  G: { x0: 64.1, x1: 66.7, half: 0.72 },
  H: { x0: 70.28, x1: 72.73, half: 0.61 },
};

/** Stands of the shielded transport U1-40 (2021 plan, scaled). */
export const TRANSPORT_STANDS = [37.8, 39.0, 41.2, 43.3, 45.3, 46.5, 48.8];
