/**
 * HEXM (20-ID) geometry used by the layout. Distances are metres from the ID source point (straight-section centre).
 * Local frame: +X downstream, +Y up (0 = beam height, floor at −1.4 m), +Z outboard (away from the ring).
 *
 * Sources: FDR Table 4.28 (component positions), APSU-2.04.03.20-ESD-010 Fig. 2 (20-ID-E plan/elevation, D3 rails),
 * site.json (Long Beamline Building footprint, hall radius). Values marked "computed" are derived here.
 */

export const BEAM_Y = 1.4;
export const FLOOR = -BEAM_Y;

// ------------------------------------------------------------------ optics enclosure 20-ID-A
/** Bent double-Laue monochromator centre (FDR Table 4.28). */
export const M1_X = 29.5;
/** Monochromatic-beam offset: 25–35 mm outboard, parallel to the white beam (FDR 4-4). True scale, NOT exaggerated. */
export const MONO_OFFSET = 0.03;
/**
 * Inter-crystal distance drawn for the bent Laue pair at 70 keV (computed): Si(111) θB = asin(λ/2d) = 1.62° with
 * λ = 0.1771 Å, d = 3.1356 Å; a 30 mm parallel offset needs D = 0.030 / tan(2θB) = 0.53 m. (At 35 keV D ≈ 0.26 m,
 * at 120 keV ≈ 0.91 m — the second crystal must travel along the beam to keep a fixed offset.)
 */
export const THETA_B_70 = Math.asin(0.17712 / (2 * 3.1356));
export const M1_SEP = MONO_OFFSET / Math.tan(2 * THETA_B_70);

// ------------------------------------------------------------------ transports and the hall
export const ST1 = { x0: 36.0, x1: 65.3 };
export const ST2 = { x0: 77.0, x1: 177.5 };
/** Window boxes at the transport ends: WN-3 (77.0 m, inside 20-ID-D) and WN-4 (177.7 m, inside 20-ID-E). */
export const WN3_X = 77.0;
export const WN4_X = 177.7;
/** Where the line crosses the experiment-hall outer wall (drawn at r = 197.3 + 0.4 m): √(197.7² − 175.5²) ≈ 91 m (computed). */
export const HALL_EXIT_X = Math.sqrt(197.7 ** 2 - 175.5 ** 2);

// ------------------------------------------------------------------ 20-ID-D
export const D_SAMPLE_X = 70.2;
export const D_DET_X = 72.5;
export const D_DET_RAIL = { x0: 72.5, x1: 75.0 };
/**
 * 20-ID-D is drawn in pass-through (the beam continues to 20-ID-E): no sample on the HT-HEDM stage and the area detector
 * slid this far inboard on its cross-slide, out of the beam (schematic state; travel not documented).
 */
export const D_DET_PARK = -0.7;

// ------------------------------------------------------------------ 20-ID-E (ESD-010 Fig. 2)
export const E = {
  x0: 177.5,
  /** step between the low upstream part (11.3 m) and the tall downstream part (8.5 m) */
  xStep: 177.5 + 11.3,
  x1: 197.3,
  narrowW: 6.8,
  narrowH: 3.98,
  wideW: 10.8,
  wideH: 6.9,
  /** shielding-wall thickness drawn (as-built lead/steel panel thickness not published) */
  wall: 0.15,
};
export const SAMPLE_X = 180.7;
/** D6 SAXS detector face (component at 195.0 m); the transmitted beam ends on its beamstop just upstream. */
export const D6_X = 195.0;
/** D3 floor rails: three Z-rails at 0 and ±2.2 m (scaled from ESD Fig. 2), ~183.9–193.4 m ("Z = 183–193 m"). */
export const D3_RAILS = { x0: 183.9, x1: 193.4, sides: [-2.2, 0, 2.2] };
/** D3 'park' positions either side, next to the doorways (~184 m). */
export const DOOR_X = 185.0;

/**
 * Snapshot configuration shown in the model (schematic, one consistent experiment): far-field HEDM on a Ni-base
 * superalloy (fcc, a ≈ 3.59 Å) at 70 keV. Debye-ring angles 2θ (computed): 111 4.90°, 200 5.66°, 220 8.00°, 311 9.38°.
 * D3 sits 6.0 m behind the sample on the outboard rail and intercepts the 220 ring; D4 on the back wall (16.0 m)
 * catches one 220 Bragg spot from a single grain (vff-HEDM, 16 m); the direct beam runs to the SAXS detector D6.
 */
export const RINGS_70KEV_DEG = { '111': 4.9, '200': 5.66, '220': 8.0, '311': 9.38 };
const t220 = Math.tan((8.0 * Math.PI) / 180);
export const D3_DET = { x: SAMPLE_X + 6.0, side: 0.62, up: Math.sqrt((6.0 * t220) ** 2 - 0.62 ** 2) };
export const D4_DET = { x: 196.7, side: -1.1, up: Math.sqrt(((196.7 - SAMPLE_X) * t220) ** 2 - 1.1 ** 2) };
/** ESD design envelope: 2θ = 17.8° (1 Å at 40 keV), reaching the back wall ~16.4 m away with r ≈ 5.3 m. */
export const ENVELOPE_2THETA = (17.8 * Math.PI) / 180;

/** Debye–Scherrer angle in radians from 2θ in degrees. */
export const deg = (d: number) => (d * Math.PI) / 180;
