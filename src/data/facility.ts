import facilityJson from './facility.json';

/**
 * Researched accelerator facts (APS vs APS-U). Shape follows the facility dossier.
 * facility.json is generated: python3 scripts/build-facility.py research/facility.json src/data/facility.json
 * (exhibit wording lives in scripts/exhibit-overrides/facility.json; do not hand-edit the JSON).
 */
export interface Param {
  value: number | string;
  unit?: string;
  source?: string;
  note?: string;
}

export interface Facility {
  ring?: { before?: Record<string, Param>; after?: Record<string, Param> };
  lattice?: Record<string, unknown>;
  injector?: Record<string, unknown>;
  insertionDevices?: Record<string, unknown>[];
  swapOut?: Record<string, unknown>;
  harmonicCavity?: Record<string, unknown>;
  brightness?: { statements?: string[]; dataPoints?: Record<string, unknown>[] };
  /** Sorted by date. `event` is the Specialist wording; `plain` (when present) is the Visitor wording. */
  timeline?: { date: string; event: string; plain?: string; source?: string; note?: string }[];
  /** "By the numbers" cards. `plain` (when present) is a Visitor-mode replacement for `explanation`. */
  exhibitNumbers?: { label: string; value: string; explanation: string; plain?: string; source?: string; note?: string }[];
  plainExplainers?: Record<string, string>;
  project?: Record<string, unknown>;
  references?: { id: string; title: string; url?: string; year?: number | string; venue?: string; authors?: string }[];
  openQuestions?: string[];
}

export const FACILITY = facilityJson as unknown as Facility;
