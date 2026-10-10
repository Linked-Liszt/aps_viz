/**
 * Physics + data for the "mba" station (multi-bend achromat lattice). Pure functions, no DOM — unit-tested in
 * tests/mba.test.ts.
 *
 * ── Emittance scaling ───────────────────────────────────────────────────────────────────────────────────────
 *  Natural emittance of an electron storage ring (Sands; Wiedemann, "Particle Accelerator Physics", ch. 13):
 *     ε_x = C_q γ² ⟨𝓗/|ρ|³⟩ / (J_x ⟨1/ρ²⟩),   C_q = 55ħc / (32√3 m_e c²) = 3.832e-13 m.
 *  For a lattice of N_s sectors with M dipoles each of bending angle θ = 2π/(N_s·M), 𝓗 ∝ ρθ³ and
 *     ε_x = F · C_q γ² θ³ / J_x     ⇒   ε ∝ E²/M³ at fixed N_s = 40   (scaling law; F = lattice "quality" factor).
 *  The station anchors that law at the old APS: ε(M = 2, 7 GeV) = 3100 pm·rad (FDR 2019 Table 2.1, the
 *  EFFECTIVE emittance of the last APS operating lattice), so ε(M, E) = 3100 pm · (2/M)³ · (E / 7 GeV)².
 *  At M = 7, 6 GeV the law gives 53 pm·rad; the real APS-U design is 41.7 pm·rad (FDR Table 2.3). Most of that
 *  gap is the anchor, not the tricks: the old optics deliberately leaked η_x ≈ 0.17 m into the straights, so
 *  its NATURAL emittance was 2.5 nm·rad (Sajaev & Emery, PAC 2005 MPPE064) and ε_eff = 3.1 nm·rad. Anchored at
 *  2.5 nm the same law gives 43 pm·rad. Writing ε = F·C_q γ² θ³ / J_x, both rings have nearly the same F/J_x
 *  (3.3 and 3.2 × the TME value 1/(12√15)), but reach it differently: the APS DBA has F ≈ 3.3 × TME, J_x ≈ 1;
 *  the APS-U hybrid cell raises η in its sextupole bumps, leaving F ≈ 7.3 × TME (per net 9°/7 bend), and wins
 *  that back with J_x = 2.25 (defocusing gradient in M3/M4, focusing reverse bends). Without the reverse bends
 *  the design reached only 67 pm·rad (FDR §2-2.1).
 *  Theoretical minimum for an M-bend achromat (Wolski, "Low-emittance storage rings", CAS 2015, arXiv
 *  1507.02213, eq. 180; Einfeld et al.): equal-field dipoles, outer ones shorter by 3^{1/3}, outer cells
 *  DBA-like and inner cells TME-like, θ = average bend angle per dipole; correct for the DBA at M = 2 and → TME
 *  as M → ∞:
 *     ε_min = C_q γ² θ³ / (12√15 J_x) · (M+1)/(M−1).
 *  Diffraction limit for photons of wavelength λ: ε_r = λ/4π (9.87 pm at 10 keV).
 *
 * ── Beam size ──────────────────────────────────────────────────────────────────────────────────────────────
 *     σ = √(εβ + (η σ_δ)²),  σ' = √(ε/β) (α = η' = 0 at the ID source point);
 *     effective emittance with dispersion in the straight: ε_eff = √(ε² + ε 𝓗 σ_δ²), 𝓗 = η²/β.
 *  APS (FDR Table 2.1): 275 × 10 µm rms, 11 × 3.5 µrad, ε_x,eff = 3.1 nm·rad, ε_y = 40 pm·rad. Those numbers are
 *  reproduced by the APS low-emittance operating optics: ε_0 = 2.5 nm·rad (Sajaev & Emery 2005) with β_x ≈ 19.5 m,
 *  η_x ≈ 0.17 m at the ID and σ_δ = 0.095 % (β_x, η_x: representative values, not in the dossier; they reproduce
 *  Table 2.1 to 1 %, see the unit test).
 *  APS-U (zero current, Storage Ring Parameters 2024 Table 5): β_x = 5.26 m, β_y = 2.38 m, η_x = 0.39 mm;
 *  round beam (κ = 1) ε_x = ε_y = 28.7 pm → 12.3 × 8.3 µm; flat (κ = 0.1) 39.7 / 3.98 pm → 14.5 × 3.1 µm.
 *
 * ── Dispersion η_x(s) ─────────────────────────────────────────────────────────────────────────────────────
 *  η'' = 1/ρ(s) − K(s) η. In dipoles η grows parabolically; between them it is linear; a thin focusing lens
 *  (focal length f) kinks it: Δη' = −η/f.
 *  • APS-U (M = 7): digitised from the 42-pm lattice-function plot (FDR 2019 Fig. 2.2 / M. Borland 2024),
 *    symmetrised, ±2 mm; η_max = 88 mm (FDR Table 2.3: 0.090 m), 0.39 mm in the straights.
 *  • APS (M = 2) and all other M: thin-lens achromat MODEL (illustrative) — equal dipoles, ρ from θ and L, lenses
 *    whose focal lengths are solved so that η = η' = 0 at both straights (the achromat condition). Inner dipoles
 *    are TME-like (η' = 0 at their centre). APS geometry: 3.06-m, 0.599-T dipoles (dossier: pac95), magnet
 *    positions schematic.
 *
 * ── Magnet data ────────────────────────────────────────────────────────────────────────────────────────────
 *  APS-U sector layout (s positions): facility dossier `lattice.sectorLayout` (FDR Fig. 2.2 vector paths).
 *  Bend angles and segment lengths: FDR 2019 Table 2.4 (M1/M2 five-step longitudinal-gradient dipoles, M3/M4
 *  transverse-gradient dipoles, Q4/Q5/Q8 offset quadrupoles as reverse bends). Field B = Bρ·θ/L,
 *  Bρ [T·m] = E[GeV]/0.299792458.
 */

export const N_SECTORS = 40;
/** sector length (m): APS-U circumference 1103.609 m / 40 (srp2024 Table 3) */
export const C_SECTOR = 1103.609 / N_SECTORS;
export const SECTOR_BEND_DEG = 360 / N_SECTORS;
export const ME_GEV = 0.51099895e-3;
/** quantum constant C_q = 55ħc/(32√3 m_e c²) (m) */
export const CQ = 3.8319e-13;
const DEG = Math.PI / 180;

/** Old APS (as last operated, FDR 2019 Table 2.1). */
export const APS = {
  E: 7,
  M: 2,
  epsX: 3100, // pm·rad (effective, incl. η_x ≈ 0.17 m in the straights)
  /** natural emittance of the low-emittance lattice (Sajaev & Emery, PAC 2005: "the APS operates at 2.5 nm-rad") */
  epsNat: 2500,
  epsY: 40,
  sigX: 275, // µm rms
  sigY: 10,
  divX: 11, // µrad rms
  divY: 3.5,
  dipoleL: 3.06, // m (θ = 4.5°, B = 0.599 T at 7 GeV)
  dipoleB: 0.599,
  sigmaDelta: 0.00095,
};

/** APS-U (design / zero-current model). */
export const APSU = {
  E: 6,
  M: 7,
  epsNat: 41.7, // pm·rad, FDR Table 2.3 (41.68; srp2024: 41.52)
  epsNoRB: 67, // pm·rad, H7BA design without reverse bends (FDR §2-2.1)
  Jx: 2.25,
  Jy: 1.0,
  Jd: 0.75,
  betaX: 5.26, // m, srp2024 Table 5
  betaY: 2.38,
  etaX: 0.39e-3, // m
  sigmaDelta: 0.00136,
  etaMax: 0.09, // m, FDR Table 2.3
  round: { epsX: 28.7, epsY: 28.7, sigX: 12.3, sigY: 8.3, divX: 2.34, divY: 3.47 },
  flat: { epsX: 39.7, epsY: 3.98, sigX: 14.5, sigY: 3.1, divX: 2.75, divY: 1.29 },
};

export const HAIR_UM = 70; // typical human hair diameter (range ~17–180 µm)
export const RBC_UM = 7.5; // human red blood cell diameter

// ------------------------------------------------------------------ emittance

export function gamma(EGeV: number): number {
  return EGeV / ME_GEV;
}

/** Magnetic rigidity Bρ (T·m) for electrons of energy E (GeV, β ≈ 1). */
export function brho(EGeV: number): number {
  return EGeV / 0.299792458;
}

/**
 * Scaling law ε ∝ E²/M³ (F/J_x fixed) anchored at the APS (M = 2, 7 GeV). Default anchor: the effective
 * 3100 pm·rad users saw; pass APS.epsNat (2500) to anchor on the natural emittance. Returns pm·rad.
 */
export function emittanceScaling(M: number, EGeV: number, anchorPm: number = APS.epsX): number {
  return anchorPm * Math.pow(APS.M / M, 3) * Math.pow(EGeV / APS.E, 2);
}

/** TME minimum-emittance factor 1/(12√15): ε_TME = F_TME · C_q γ² θ³ / J_x. */
export const F_TME = 1 / (12 * Math.sqrt(15));

/**
 * Lattice quality factor of a real ring, in units of the TME value: F/F_TME with ε = F·C_q γ² θ³ / J_x and
 * θ = 2π/(40·M) the average (net) bend per dipole. APS (2.5 nm, M = 2, 7 GeV, J_x = 1) ≈ 3.3;
 * APS-U (41.7 pm, M = 7, 6 GeV, J_x = 2.25) ≈ 7.3.
 */
export function qualityFactor(epsPm: number, M: number, EGeV: number, Jx = 1): number {
  const th = bendAngle(M);
  const g = gamma(EGeV);
  return (epsPm * 1e-12 * Jx) / (CQ * g * g * th * th * th) / F_TME;
}

/** Bending angle per dipole (rad) for M equal dipoles per sector. */
export function bendAngle(M: number): number {
  return (2 * Math.PI) / (N_SECTORS * M);
}

/** Theoretical minimum emittance of an M-bend achromat (pm·rad), Wolski 2015 eq. 180; M ≥ 2 (M = 2: DBA). */
export function emittanceMin(M: number, EGeV: number, Jx = 1): number {
  const th = bendAngle(M);
  const g = gamma(EGeV);
  return ((F_TME * CQ * g * g * th * th * th) / Jx) * ((M + 1) / (M - 1)) * 1e12;
}

/** Photon wavelength (m) for an energy in keV. */
export function wavelength(keV: number): number {
  return 12.398419843e-10 / keV;
}

/** Diffraction-limited emittance λ/4π (pm·rad). */
export function diffractionLimit(keV: number): number {
  return (wavelength(keV) / (4 * Math.PI)) * 1e12;
}

/** rms beam size (µm) from emittance (pm·rad), beta (m), dispersion (m) and energy spread. */
export function beamSize(epsPm: number, beta: number, eta = 0, sigmaDelta = 0): number {
  return Math.sqrt(epsPm * 1e-12 * beta + (eta * sigmaDelta) ** 2) * 1e6;
}

/** Effective emittance (pm·rad) with dispersion η at a symmetry point (α = η' = 0): √(ε² + ε(η²/β)σ_δ²). */
export function effectiveEmittance(epsPm: number, beta: number, eta: number, sigmaDelta: number): number {
  const e = epsPm * 1e-12;
  return Math.sqrt(e * e + e * ((eta * eta) / beta) * sigmaDelta * sigmaDelta) * 1e12;
}

/**
 * Transverse emittances with betatron coupling κ = ε_y/ε_x and damping partition numbers J_x, J_y.
 * The sum J_x ε_x + J_y ε_y = J_x ε_0 is invariant, so ε_x = ε_0 J_x/(J_x + κ J_y), ε_y = κ ε_x.
 * APS-U (ε_0 = 41.52 pm, J_x = 2.25): κ = 1 → 28.7/28.7 pm; κ = 0.1 → 39.7/3.98 pm (srp2024 Table 5).
 */
export function coupledEmittances(eps0: number, kappa: number, Jx = APSU.Jx, Jy = APSU.Jy): { x: number; y: number } {
  const x = (eps0 * Jx) / (Jx + kappa * Jy);
  return { x, y: kappa * x };
}

/** Damping partition numbers from damping times (J_i ∝ 1/τ_i), normalised with the Robinson sum J_x + J_y + J_E = 4. */
export function partitionFromDampingTimes(tx: number, ty: number, tE: number): { Jx: number; Jy: number; JE: number } {
  const a = 1 / tx;
  const b = 1 / ty;
  const c = 1 / tE;
  const k = 4 / (a + b + c);
  return { Jx: a * k, Jy: b * k, JE: c * k };
}

// ------------------------------------------------------------------ lattices

export type Kind = 'bend' | 'reverse' | 'quad' | 'sext';

export interface Element {
  /** magnet the element belongs to (segments of a longitudinal-gradient dipole share it) */
  magnet: string;
  /** short label (e.g. "M1") */
  tag: string;
  kind: Kind;
  s0: number;
  s1: number;
  /** bending angle (rad); negative for reverse bends; 0 for quads/sextupoles */
  angle: number;
}

export interface Lattice {
  id: 'aps' | 'apsu' | 'generic';
  M: number;
  C: number;
  elements: Element[];
  /** dispersion η_x (m) sampled at s = i·ds, i = 0..n−1 (n·ds ≥ C) */
  ds: number;
  eta: Float32Array;
  /** horizontal betatron phase advance per sector / 2π (APS-U real, others illustrative) */
  nuSector: number;
  /** thin lenses of the dispersion model (absent for the digitised APS-U curve) */
  lenses: { s: number; f: number }[];
  /** true where η comes from a model rather than the real lattice */
  modelEta: boolean;
}

/** Field (T) of a bending element at energy E. */
export function fieldOf(el: Element, EGeV: number): number {
  const L = el.s1 - el.s0;
  return L > 0 ? (brho(EGeV) * el.angle) / L : 0;
}

/** Linear interpolation of η (m) at s, wrapping the sector. */
export function etaAt(lat: Lattice, s: number): number {
  const C = lat.C;
  let x = s % C;
  if (x < 0) x += C;
  const f = x / lat.ds;
  const i = Math.min(lat.eta.length - 2, Math.floor(f));
  const t = f - i;
  return lat.eta[i] * (1 - t) + lat.eta[i + 1] * t;
}

export function etaMax(lat: Lattice): number {
  let m = 0;
  for (let i = 0; i < lat.eta.length; i++) if (lat.eta[i] > m) m = lat.eta[i];
  return m;
}

const mirror = (C: number, els: Element[], rename: (n: string) => string): Element[] =>
  els.map((e) => ({ ...e, magnet: rename(e.magnet), s0: C - e.s1, s1: C - e.s0 })).reverse();

const DS = 0.01;

/**
 * η along the sector by integrating η'' = 1/ρ exactly, piece by piece (constant 1/ρ between element edges and
 * lenses), with thin lenses that set the slope to prescribed values (their focal lengths f = η/Δη' are returned;
 * positive = focusing).
 */
function thinLensDispersion(C: number, elements: Element[], lensPlan: { s: number; slope: number }[]): { eta: Float32Array; lenses: { s: number; f: number }[] } {
  const bends = elements.filter((e) => e.kind === 'bend' || e.kind === 'reverse');
  const plan = [...lensPlan].sort((a, b) => a.s - b.s);
  const cuts = new Set<number>([0, C]);
  for (const b of bends) {
    cuts.add(b.s0);
    cuts.add(b.s1);
  }
  for (const l of plan) cuts.add(l.s);
  const edges = [...cuts].filter((x) => x >= 0 && x <= C).sort((a, b) => a - b);
  const invRho = (s: number) => {
    for (const b of bends) if (s >= b.s0 && s < b.s1) return b.angle / (b.s1 - b.s0);
    return 0;
  };
  // pieces: start s, η, η', 1/ρ
  const ps: number[] = [];
  const pe: number[] = [];
  const pp: number[] = [];
  const pk: number[] = [];
  const lenses: { s: number; f: number }[] = [];
  let h = 0;
  let hp = 0;
  let li = 0;
  for (let i = 0; i < edges.length - 1; i++) {
    const a = edges[i];
    const b = edges[i + 1];
    while (li < plan.length && Math.abs(plan[li].s - a) < 1e-12) {
      const d = hp - plan[li].slope;
      lenses.push({ s: a, f: Math.abs(d) > 1e-15 ? h / d : Infinity });
      hp = plan[li].slope;
      li++;
    }
    const k = invRho((a + b) / 2);
    ps.push(a);
    pe.push(h);
    pp.push(hp);
    pk.push(k);
    const L = b - a;
    h += hp * L + 0.5 * k * L * L;
    hp += k * L;
  }
  const n = Math.ceil(C / DS) + 2;
  const eta = new Float32Array(n);
  let j = 0;
  for (let i = 0; i < n; i++) {
    const s = Math.min(i * DS, C);
    while (j < ps.length - 1 && ps[j + 1] <= s) j++;
    const x = s - ps[j];
    eta[i] = pe[j] + pp[j] * x + 0.5 * pk[j] * x * x;
  }
  return { eta, lenses };
}

/** Old APS double-bend achromat — schematic magnet positions, real dipole length/angle; thin-lens η model. */
function apsLattice(): Lattice {
  const C = C_SECTOR;
  const th = (SECTOR_BEND_DEG / 2) * DEG;
  const half: Element[] = [
    { magnet: 'A:Q1', tag: 'Q1', kind: 'quad', s0: 2.95, s1: 3.45, angle: 0 },
    { magnet: 'A:Q2', tag: 'Q2', kind: 'quad', s0: 3.9, s1: 4.5, angle: 0 },
    { magnet: 'A:Q3', tag: 'Q3', kind: 'quad', s0: 4.95, s1: 5.45, angle: 0 },
    { magnet: 'A:S1', tag: 'S1', kind: 'sext', s0: 5.58, s1: 5.82, angle: 0 },
    { magnet: 'A:B', tag: 'B', kind: 'bend', s0: 5.95, s1: 5.95 + APS.dipoleL, angle: th },
    { magnet: 'A:S2', tag: 'S2', kind: 'sext', s0: 9.15, s1: 9.4, angle: 0 },
    { magnet: 'A:Q4', tag: 'Q4', kind: 'quad', s0: 9.6, s1: 10.2, angle: 0 },
    { magnet: 'A:S3', tag: 'S3', kind: 'sext', s0: 10.4, s1: 10.65, angle: 0 },
    { magnet: 'A:Q5', tag: 'Q5', kind: 'quad', s0: 10.85, s1: 11.45, angle: 0 },
  ];
  const mid: Element = { magnet: 'S4', tag: 'S4', kind: 'sext', s0: C / 2 - 0.125, s1: C / 2 + 0.125, angle: 0 };
  const elements = [...half, mid, ...mirror(C, half, (n) => n.replace('A:', 'B:'))];
  const q4 = 9.9;
  const q5 = 11.15;
  const plan = [
    { s: q4, slope: th / 2 },
    { s: q5, slope: 0 },
    { s: C - q5, slope: -th / 2 },
    { s: C - q4, slope: -th },
  ];
  const r = thinLensDispersion(C, elements, plan);
  return { id: 'aps', M: 2, C, elements, ds: DS, eta: r.eta, nuSector: 0.9, lenses: r.lenses, modelEta: true };
}

/** Generic M-bend achromat with equal dipoles (illustrative model). */
function genericLattice(M: number): Lattice {
  const C = C_SECTOR;
  const th = (SECTOR_BEND_DEG / M) * DEG;
  const sa = 3.84;
  const sb = C - 3.84;
  const r = 1.2; // gap / dipole length
  const Lb = (sb - sa) / (M + r * (M - 1));
  const g = r * Lb;
  const elements: Element[] = [
    { magnet: 'A:Q1', tag: 'Q1', kind: 'quad', s0: 2.932, s1: 3.14, angle: 0 },
    { magnet: 'A:Q2', tag: 'Q2', kind: 'quad', s0: 3.594, s1: 3.776, angle: 0 },
  ];
  const plan: { s: number; slope: number }[] = [];
  for (let k = 0; k < M; k++) {
    const s0 = sa + k * (Lb + g);
    elements.push({ magnet: `B${k + 1}`, tag: `B${k + 1}`, kind: 'bend', s0, s1: s0 + Lb, angle: th });
    if (k < M - 1) {
      const gc = s0 + Lb + g / 2;
      const qL = Math.min(0.3, 0.3 * g);
      const sL = Math.min(0.2, 0.14 * g);
      const off = qL / 2 + 0.06 * g + sL / 2;
      elements.push({ magnet: `S${k + 1}a`, tag: 'S', kind: 'sext', s0: gc - off - sL / 2, s1: gc - off + sL / 2, angle: 0 });
      elements.push({ magnet: `Q${k + 1}`, tag: 'Q', kind: 'quad', s0: gc - qL / 2, s1: gc + qL / 2, angle: 0 });
      elements.push({ magnet: `S${k + 1}b`, tag: 'S', kind: 'sext', s0: gc + off - sL / 2, s1: gc + off + sL / 2, angle: 0 });
      // dispersion steering: first lens takes η' from θ to −θ/2 (TME-like inner cells), last from +θ/2 to −θ
      let slope = -th / 2;
      if (M === 2 || k === M - 2) slope = -th;
      plan.push({ s: gc, slope });
    }
  }
  elements.push({ magnet: 'B:Q2', tag: 'Q2', kind: 'quad', s0: C - 3.776, s1: C - 3.594, angle: 0 });
  elements.push({ magnet: 'B:Q1', tag: 'Q1', kind: 'quad', s0: C - 3.14, s1: C - 2.932, angle: 0 });
  elements.sort((a, b) => a.s0 - b.s0);
  const res = thinLensDispersion(C, elements, plan);
  const nu = 0.9 + ((M - 2) * (APSU_NU_SECTOR - 0.9)) / 5;
  return { id: 'generic', M, C, elements, ds: DS, eta: res.eta, nuSector: nu, lenses: res.lenses, modelEta: true };
}

/** APS-U horizontal tune per sector: ν_x = 95.12 (srp2024 Table 2) / 40. */
export const APSU_NU_SECTOR = 95.12 / N_SECTORS;

/**
 * APS-U η_x (mm), s = 0, 0.1, …, 13.8 m (upstream ID centre → sector centre), symmetrised digitisation of the
 * 42-pm lattice-function plot (FDR 2019 Fig. 2.2; Borland 2024). Baseline set to the design 0.39 mm.
 */
const APSU_ETA_HALF_MM = [
  0.4, 0.4, 0.4, 0.4, 0.4, 0.4, 0.4, 0.4, 0.4, 0.4, 0.4, 0.4, 0.4, 0.4, 0.4, 0.4, 0.4, 0.4, 0.4, 0.4, 0.4, 0.4, 0.4, 0.4, 0.4, 0.4, 0.4, 0.4, 0.4,
  0.4, 0.4, 0.4, 0.4, 0.4, 0.4, 0.4, 0.4, 0.4, 0.4, 1.3, 3.0, 4.8, 6.5, 8.2, 10.2, 11.8, 13.6, 15.4, 17.2, 18.9, 20.7, 22.5, 24.2, 26.0, 27.8, 29.5,
  31.3, 33.1, 34.9, 36.6, 38.4, 40.7, 43.8, 47.5, 51.9, 57.0, 61.8, 67.5, 72.8, 78.3, 83.8, 86.8, 88.3, 88.1, 85.7, 83.2, 80.9, 78.5, 76.1, 72.8,
  68.8, 64.8, 60.6, 56.2, 52.1, 48.1, 43.8, 40.1, 37.0, 34.6, 33.2, 32.1, 31.0, 29.8, 28.6, 27.5, 26.4, 25.3, 24.2, 23.1, 22.0, 20.9, 19.7, 18.6,
  17.4, 16.3, 15.4, 14.2, 13.1, 12.1, 11.8, 11.2, 10.4, 9.8, 8.5, 7.0, 5.6, 5.1, 5.1, 5.0, 5.0, 5.0, 4.9, 4.9, 5.0, 6.5, 7.4, 7.6, 7.8, 7.9, 8.0,
  8.1, 7.4, 6.5, 5.2, 4.3, 4.2, 4.2, 4.2,
];

/** FDR 2019 Table 2.4 — segment lengths (m) and angles (deg) of the longitudinal-gradient dipoles, upstream→centre. */
export const M1_SEG = { L: [0.192, 0.233, 0.493, 0.671, 0.636], deg: [0.357, 0.267, 0.381, 0.375, 0.257] };
export const M2_SEG = { L: [0.292, 0.359, 0.487, 0.308, 0.54], deg: [0.135, 0.187, 0.297, 0.222, 0.495] };
export const APSU_BENDS_DEG = { M3: 1.437, M4: 1.125, Q4: -0.098, Q5: -0.066, Q8: -0.307 };

function segmented(magnet: string, tag: string, s0: number, s1: number, seg: { L: number[]; deg: number[] }): Element[] {
  const tot = seg.L.reduce((a, b) => a + b, 0);
  const k = (s1 - s0) / tot;
  const out: Element[] = [];
  let s = s0;
  seg.L.forEach((L, i) => {
    out.push({ magnet, tag, kind: 'bend', s0: s, s1: s + L * k, angle: seg.deg[i] * DEG });
    s += L * k;
  });
  return out;
}

/** The real APS-U hybrid 7BA sector (dossier lattice.sectorLayout + FDR Table 2.4). */
function apsuLattice(): Lattice {
  const C = C_SECTOR;
  const B = APSU_BENDS_DEG;
  const half: Element[] = [
    { magnet: 'A:Q1', tag: 'Q1', kind: 'quad', s0: 2.932, s1: 3.14, angle: 0 },
    { magnet: 'A:Q2', tag: 'Q2', kind: 'quad', s0: 3.594, s1: 3.776, angle: 0 },
    ...segmented('A:M1', 'M1', 3.84, 6.072, M1_SEG),
    { magnet: 'A:Q3', tag: 'Q3', kind: 'quad', s0: 6.215, s1: 6.396, angle: 0 },
    { magnet: 'A:S1', tag: 'S1', kind: 'sext', s0: 6.565, s1: 6.747, angle: 0 },
    { magnet: 'A:Q4', tag: 'Q4', kind: 'reverse', s0: 7.045, s1: 7.265, angle: B.Q4 * DEG },
    { magnet: 'A:S2', tag: 'S2', kind: 'sext', s0: 7.421, s1: 7.629, angle: 0 },
    { magnet: 'A:Q5', tag: 'Q5', kind: 'reverse', s0: 7.823, s1: 7.927, angle: B.Q5 * DEG },
    { magnet: 'A:S3', tag: 'S3', kind: 'sext', s0: 8.29, s1: 8.472, angle: 0 },
    { magnet: 'A:Q6', tag: 'Q6', kind: 'quad', s0: 8.667, s1: 8.848, angle: 0 },
    ...segmented('A:M2', 'M2', 8.926, 10.911, M2_SEG),
    { magnet: 'A:Q7', tag: 'Q7', kind: 'quad', s0: 10.989, s1: 11.352, angle: 0 },
    { magnet: 'A:M3', tag: 'M3', kind: 'bend', s0: 11.625, s1: 12.39, angle: B.M3 * DEG },
    { magnet: 'A:Q8', tag: 'Q8', kind: 'reverse', s0: 12.572, s1: 13.142, angle: B.Q8 * DEG },
  ];
  const m4: Element = { magnet: 'M4', tag: 'M4', kind: 'bend', s0: 13.48, s1: 14.115, angle: B.M4 * DEG };
  const elements = [...half, m4, ...mirror(C, half, (n) => n.replace('A:', 'B:'))];
  const n = Math.ceil(C / DS) + 2;
  const eta = new Float32Array(n);
  const dsT = 0.1;
  const look = (x: number) => {
    const f = Math.min(APSU_ETA_HALF_MM.length - 1.0001, x / dsT);
    const i = Math.floor(f);
    const t = f - i;
    return APSU_ETA_HALF_MM[i] * (1 - t) + APSU_ETA_HALF_MM[i + 1] * t;
  };
  for (let i = 0; i < n; i++) {
    const s = Math.min(i * DS, C);
    eta[i] = look(s <= C / 2 ? s : C - s) * 1e-3;
  }
  return { id: 'apsu', M: 7, C, elements, ds: DS, eta, nuSector: APSU_NU_SECTOR, lenses: [], modelEta: false };
}

const cache = new Map<number, Lattice>();
/** Lattice shown for M bends per sector: M = 2 → APS DBA (schematic), M = 7 → real APS-U H7BA, else model. */
export function latticeFor(M: number): Lattice {
  const m = Math.max(2, Math.min(10, Math.round(M)));
  let l = cache.get(m);
  if (!l) {
    l = m === 2 ? apsLattice() : m === 7 ? apsuLattice() : genericLattice(m);
    cache.set(m, l);
  }
  return l;
}

/** Plain generic model for any M (used by tests to check the achromat condition, including M = 2 and 7). */
export function genericModel(M: number): Lattice {
  return genericLattice(M);
}

/** End-of-sector dispersion and slope of a thin-lens model (both ≈ 0 for an achromat). */
export function closure(lat: Lattice): { eta: number; deta: number } {
  const i = Math.floor(lat.C / lat.ds);
  const e1 = lat.eta[i];
  const e0 = lat.eta[i - 1];
  return { eta: e1, deta: (e1 - e0) / lat.ds };
}

export interface BendStats {
  forward: number;
  reverse: number;
  /** min/max bending angle of the forward magnets (deg) */
  minDeg: number;
  maxDeg: number;
  /** sum of forward and reverse angles (deg) */
  sumForwardDeg: number;
  sumReverseDeg: number;
}

export function bendStats(lat: Lattice): BendStats {
  const per = new Map<string, { kind: Kind; ang: number }>();
  for (const e of lat.elements) {
    if (e.kind !== 'bend' && e.kind !== 'reverse') continue;
    const p = per.get(e.magnet) ?? { kind: e.kind, ang: 0 };
    p.ang += e.angle / DEG;
    per.set(e.magnet, p);
  }
  let forward = 0;
  let reverse = 0;
  let minDeg = Infinity;
  let maxDeg = 0;
  let sf = 0;
  let sr = 0;
  for (const p of per.values()) {
    if (p.kind === 'bend') {
      forward++;
      sf += p.ang;
      minDeg = Math.min(minDeg, p.ang);
      maxDeg = Math.max(maxDeg, p.ang);
    } else {
      reverse++;
      sr += p.ang;
    }
  }
  return { forward, reverse, minDeg, maxDeg, sumForwardDeg: sf, sumReverseDeg: sr };
}

// ------------------------------------------------------------------ formatting

/** Emittance with a sensible unit: "3.1 nm·rad" / "53 pm·rad". */
export function fmtEps(pm: number, unit = true): string {
  const u = unit ? '·rad' : '';
  if (pm >= 1000) return `${(pm / 1000).toFixed(pm >= 10000 ? 0 : 1)} nm${u}`;
  if (pm >= 100) return `${pm.toFixed(0)} pm${u}`;
  if (pm >= 10) return `${pm.toFixed(0)} pm${u}`;
  return `${pm.toFixed(1)} pm${u}`;
}
