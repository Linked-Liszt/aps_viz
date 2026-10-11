/**
 * 9-ID CSSI geometry constants (metres from the centre of the ID straight, the FDR distance origin; beam frame:
 * +X downstream, +Y up with 0 = beam height 1.4 m, +Z outboard).
 *
 * The 9-ID user manual ELOG 916 and XBPM drawing give exact z positions for the CSSI sample at 54.992 m,
 * the GIXS sample at 56.590 m and the XBPMs at 42.38 and 53.43 m. KB mirror centres are calculated from the manual's hexapod-to-KB
 * distances (1.552 m to KB-H, 1.818 m to KB-V) with the hexapod at ~55.9 m → H ≈ 54.35 m, V ≈ 54.08 m, i.e. a ~0.65 m
 * working distance to the CSSI sample (SPIE 2025). Grand Tube: 2.75 m bore × ~20.5 m, 57.5–78.0 m; detectors
 * 2.9–21.8 m from the CSSI sample.
 */

export const CSSI_X = 54.992;
export const GIXS_X = 56.59;
export const KB = { x: 54.2, vX: 54.08, hX: 54.35, vLen: 0.24, hLen: 0.2 };

/** Grazing incidence drawn at the true scale: α = 0.5° (CSSI works near the critical angle, ~0.1–1°). */
export const ALPHA = (0.5 * Math.PI) / 180;

/** CSSI sample chamber (round multi-port chamber in the as-built isometric). */
export const CHAMBER = { r: 0.36, h: 0.56 };

/** Common granite under the KB and CSSI chambers (granite air-bearing stages), top below the beam. */
export const KB_GRANITE = { x0: 53.82, x1: 55.42, w: 1.0, top: -0.62 };
/** GIXS stationary granite (hexapod) and translating granite (diffractometer). */
export const GIXS_GRANITE = { stat: { x0: 55.5, x1: 56.22, w: 1.1, top: -0.8 }, trans: { x0: 56.24, x1: 57.0, w: 1.15, top: -0.78 } };

/** Upstream optical table in 9-ID-D (fast shutter + attenuator). */
export const D_TABLE = { x0: 47.35, x1: 48.75, half: 0.55, top: -0.22 };

/** Grand Tube (9-ID-GT). Axis drawn 0.2 m above the beam (height unpublished) so the 2.75 m vessel clears its saddles. */
export const TUBE = {
  x0: 57.5,
  x1: 78.0,
  r: 1.375,
  wall: 0.008,
  axisY: 0.2,
  /** dished heads (torispherical, drawn as spherical caps of radius 2.75 m → depth ≈ 0.37 m) */
  headDepth: 0.37,
  /** four flanged sections delivered in Aug 2023 */
  sections: 4,
  /** inner deck carrying the detector rails, top this far below the beam */
  deckY: -0.95,
};
/** Pin / close-up anchor for the tube near its upstream end, so the component close-up looks down its length. */
export const TUBE_PIN_X = 59.0;
/**
 * The CSSI close-up aims this far above the sample (comp.shot.target) so it frames the chamber AND the magnifier above
 * it; the component anchor itself stays at the true sample position.
 */
export const CSSI_LIFT = 0.42;

/** Detector carriage: 20 m camera length from the CSSI sample (dossier: EIGER 16M shown at 75.0 m). */
export const DET_X = 75.0;
/**
 * Specular reflection at 2α lands this far to the side at the detector. The chip faces INBOARD in this model (toward
 * the exhibit cameras), so the reflection goes to −z; the real side is not documented.
 */
export const SPEC_SIDE = -Math.tan(2 * ALPHA) * (DET_X - CSSI_X);
/** EIGER 16M (311 × 328 mm active) beside the MM-PAD, catching larger exit angles (illustrative; mounting unpublished). */
export const EIGER = { side: SPEC_SIDE - 0.27, face: [0.311, 0.328] as const };
/** MM-PAD on its own arm 0.45 m ahead of the EIGER, centred on the specular spot (so neither hides the other). */
export const MMPAD_X = DET_X - 0.45;
export const MMPAD = { side: -Math.tan(2 * ALPHA) * (MMPAD_X - CSSI_X), face: [0.047, 0.049] as const };
/** End-of-line stop drawn just upstream of the downstream head (dossier/FDR: 78.0 m, the head apex). */
export const END_STOP_X = 77.45;

/** Pilatus 1M-F GIWAXS detector (169 × 179 mm active) ~0.3 m downstream of the GIXS sample, raised and outboard. */
export const PILATUS = { x: 56.9, side: 0.2, up: 0.14 };
