/**
 * ISN (19-ID) geometry used by the layout. Distances are metres from the ID source point (straight-section centre).
 * Local frame: +X downstream, +Y up (0 = beam height, floor at −1.4 m), +Z outboard (away from the ring).
 *
 * Sources: FDR Table 4.49 (component positions), Sunil NIMA 2020 Figs. 2–3a (hutch plan, scaled at ~24 px/m and
 * ~129 px/m; ±0.1–0.3 m), MEDSI'25 TUOA02 Figs. 2–5 (endstation, instrument, KB numbers), site.json (Long Beamline Building
 * footprint, hall radius). Values marked "computed" are derived here.
 */
import { branchSide, type BranchLayout } from '../../scene/beamline/layout';

export const BEAM_Y = 1.4;
export const FLOOR = -BEAM_Y;

// ------------------------------------------------------------------ beam axis
/**
 * M3 (35.0 m) deflects the beam 5 mrad INBOARD (2θ for θ = 2.5 mrad), so everything downstream runs on a straight line
 * turned 5 mrad toward the ring: 0.925 m inboard of the straight-through line at the 220 m focus (185 m × 5 mrad,
 * computed; the unpublished DCM/DMM side offset of a few mm is ignored). Drawn as the engine's straight-line deflection
 * (angleMrad), i.e. the true geometry, NOT exaggerated: 0.10 m inboard at BDA-V, 0.145 m at BDA-H, 0.28 m at the
 * hall wall. Components downstream of M3 are yawed by BEAM_YAW so their pipes stay coaxial with the turned beam.
 */
export const M3_X = 35.0;
export const M3_DEFLECTION_MRAD = -5;
export const BRANCH: BranchLayout = { side: 0, angleMrad: M3_DEFLECTION_MRAD, divergeAtM: M3_X, label: '19-ID (ISN)' };
/** yaw (rad, about +Y) that turns a part's +X axis onto the beam direction downstream of M3 */
export const BEAM_YAW = -M3_DEFLECTION_MRAD / 1000;
const L = { id: 'isn', branches: { main: BRANCH } };
/** lateral position (m, + outboard) of the drawn beam at distance x */
export const beamSide = (x: number): number => branchSide(L, 'main', x);

// ------------------------------------------------------------------ source
/** two ~2.35 m revolver undulators either side of the straight-section centre, short phase shifter between them */
export const UND = { len: 2.35, us: -1.25, ds: 1.25 };

// ------------------------------------------------------------------ hutches on the experiment-hall floor
/**
 * 19-ID-A (FOE) inner outline from NIMA 2020 Fig. 3a (129 px/m): narrow upstream bay against the ratchet wall, then a
 * straight outboard wall at +1.40 m and an inboard wall that follows the tunnel, widening from ~1.1 m to ~2.3 m.
 * The inboard wall is drawn ~0.1 m further out than scaled so the 0.8 m mirror tank clears it.
 */
export const FOE_OUTLINE: [number, number][] = [
  [23.9, -0.32], [23.9, 0.85], [26.05, 0.85], [26.05, 1.4], [35.8, 1.4], [35.8, -0.98], [31.15, -0.64],
];
/** 19-ID-C (BDA-V) and 19-ID-D (BDA-H) from NIMA 2020 Fig. 2 (24 px/m), walls relative to the beam */
export const C = { x0: 48.2, x1: 59.0, out: 2.04, in0: -0.74, in1: -1.64 };
export const D = { x0: 59.0, x1: 66.2, out: 3.25, in: -1.64 };
export const C_OUTLINE: [number, number][] = [
  [C.x0, beamSide(C.x0) + C.out], [C.x1, beamSide(C.x1) + C.out], [C.x1, beamSide(C.x1) + C.in1], [C.x0, beamSide(C.x0) + C.in0],
];
export const D_OUTLINE: [number, number][] = [
  [D.x0, beamSide(D.x0) + D.out], [D.x1, beamSide(D.x1) + D.out], [D.x1, beamSide(D.x1) + D.in], [D.x0, beamSide(D.x0) + D.in],
];

// ------------------------------------------------------------------ transports
export const ST1 = { x0: 35.8, x1: 48.2 };
export const ST2 = { x0: 65.5, x1: 213.0 };
/** shielded ion-pump mini-enclosures on ST-2 (FDR Table 4.49) */
export const PUMPS = [95, 124, 153, 183];
/**
 * Where the line crosses the experiment-hall outer wall (r = 197.3 m, drawn at mid-wall r ≈ 197.5 m): solve
 * √(x² + (175.5 + side(x))²) = 197.5 → x ≈ 91 m (computed).
 */
export const HALL_EXIT_X = (() => {
  let x = 90;
  for (let i = 0; i < 30; i++) x = Math.sqrt(197.5 ** 2 - (175.5 + beamSide(x)) ** 2);
  return x;
})();
/** the enclosed corridor (OSM footprint of LOM 436's transport wing in site.json, ISN frame) reaches the LBB at ~201 m */
export const LBB_X = 201.0;

// ------------------------------------------------------------------ 19-ID-E (concrete endstation, Long Beamline Building)
/** beam side in 19-ID-E (constant to ±4 mm over the hutch) */
export const SE = beamSide(220);
/**
 * Inner 14.6 × 6.6 m (NIMA 2020), 12 in (0.30 m) concrete walls (MEDSI'25), roof ~2.8 m above the beam. The beam sits
 * 2.5 m from the outboard and 4.1 m from the inboard inner wall (NIMA 2020 Fig. 2, scaled to the 6.6 m width).
 */
export const E = { x0: 212.6, x1: 227.2, out: 2.5, in: -4.1, wall: 0.3, roof: 2.8 };
/** inner/outer wall faces as absolute local z */
export const E_Z = { inOut: SE + E.out, inIn: SE + E.in, outOut: SE + E.out + E.wall, outIn: SE + E.in - E.wall };

/** Long Beamline Building, ISN wing footprint from site.json (Bldg 444 polygon transformed to this frame; ±1 m). */
export const LBB_OUTLINE: [number, number][] = [
  [201.1, -0.64], [211.4, -0.51], [212.2, 4.62], [230.6, 3.88], [230.8, -12.3], [222.1, -12.35], [221.5, -18.15], [200.9, -18.9],
];
/** support rooms (control area, airlock, sample prep, wet lab) inboard of 19-ID-E (MEDSI'25 Fig. 2a; extent approx) */
export const ROOMS = { x0: 205.0, x1: 227.5, z0: -11.8, z1: E_Z.outIn - 0.15 };

// ------------------------------------------------------------------ endstation layout (MEDSI'25 Fig. 3, FDR Table 4.49)
export const SAMPLE_X = 220.0;
/** KB pair as built (MEDSI'25 Fig. 5a): KBV 404 mm, q 396 mm; KBH 129 mm, q 125.5 mm; 4 mm gap; 61 mm working distance */
export const KBV = { len: 0.404, q: 0.396, x: SAMPLE_X - 0.396 };
export const KBH = { len: 0.129, q: 0.1255, x: SAMPLE_X - 0.1255 };
export const WD = 0.061;
/**
 * Direction change of the focused beam relative to the M3 line: KBV reflects UP (MEDSI'25 Fig. 5a) and the KBH mirror is
 * drawn on the outboard side of the beam, so it turns the beam INBOARD (its side is not published); each 2θ = 5 mrad.
 * The direct beam therefore reaches the ptychography detector 3 m downstream ~15 mm higher and ~15 mm further inboard.
 */
export const KB_EXIT = { up: 0.005, side: -0.005 };
/** granite table + Invar baseplate shared by the optics and sample chambers (metrology loop 466 mm down to the base) */
export const TABLE = { x0: 218.95, x1: 220.65, top: -0.53, base: -0.466, halfW: 0.55 };
/**
 * UHV optics chamber and HV/air sample chamber, separated by diamond windows and a 2 mm He gap. MEDSI'20: 47 mm of
 * in-vacuum sample space between the chamber wall and the focus, so the sample chamber starts 47 mm upstream of the focus
 * and the optics chamber ends ~2.5 mm before that (the KBH itself ends 61 mm before the focus).
 */
export const KB_CHAMBER = { x0: 219.2, x1: SAMPLE_X - 0.0495, y1: 0.3, halfW: 0.25 };
export const SAMPLE_CHAMBER = { x0: SAMPLE_X - 0.047, x1: 220.42, y1: 0.34, halfW: 0.35 };
/** beam-conditioning granite blocks (MEDSI'25 Fig. 3), fast shutter on a post between them (215.8 m, FDR) */
export const COND = { b1: [213.45, 215.25] as const, b2: [216.35, 218.15] as const, top: -0.42, halfW: 0.5 };

const deg = (d: number) => (d * Math.PI) / 180;
/** XRD Be dome axis: tipped 10° up and 25° outboard of the beam (MEDSI'25); detector face drawn 0.62 m from the sample */
export const XRD_DIR = { x: Math.cos(deg(10)) * Math.cos(deg(25)), y: Math.sin(deg(10)), z: Math.cos(deg(10)) * Math.sin(deg(25)) };
export const XRD_R = 0.62;
export const XRD = { x: SAMPLE_X + XRD_R * XRD_DIR.x, up: XRD_R * XRD_DIR.y, side: SE + XRD_R * XRD_DIR.z };
/** robot (Stäubli TX2-160L) pedestal: outboard and just downstream of the sample chamber (MEDSI'25 Fig. 3) */
export const ROBOT = { x: 221.0, z: SE + 1.05 };
/**
 * 7-element SDD at 90° in the horizontal (polarisation) plane, on the OUTBOARD side: MEDSI'25 Figs. 3–4 are drawn from the
 * inboard side (beam left → right, control area in front), with the 7-element SDD and the diffraction robot beyond the
 * beam, i.e. outboard (consistent with the Be dome's stated 25° outboard tilt). Snout tip 30 mm from the sample; flange and
 * preamplifier body 0.46–0.58 m out (proportions from Fig. 4; exact dimensions not published).
 */
export const XRF = { snoutTip: 0.03, bodyFace: 0.46, bodyDepth: 0.12, bodyCentre: 0.52 };
/** 12-element backscatter SDD looking back at the sample from above-inboard-upstream (MEDSI'25 Fig. 4 near side; angle approx) */
export const BSDD_DIR = { x: -0.35, y: 0.5, z: -0.79 };
/** ptychography detector table: 6 m of travel along the beam (≈220.5–226.5 m); detector shown at 223.0 m */
export const PTYCHO = { tableX0: 220.75, tableX1: 226.9, detX: 223.0, top: -0.5 };
