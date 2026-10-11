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
  /**
   * Sorted by date. `event` is the single exhibit text (one sentence or two, for every reader); `date` is ISO-like
   * ('2024-04-13', '2024-08', '2024-03-25/28', '2025-09 (late)', 'c. 2014'). `source`/`note` are research annotations.
   */
  timeline?: { date: string; event: string; source?: string; note?: string }[];
  /** "By the numbers" cards: `value` is the headline figure, `explanation` the single exhibit text under it. */
  exhibitNumbers?: { label: string; value: string; explanation: string; source?: string; note?: string }[];
  /**
   * Primer answers keyed whatIsSynchrotron, whatIsUndulator, whatIsMBA, whyEmittanceMatters, whatIsCoherence,
   * whatIsSwapOut, whatIsBunchLengthening, whyLowerEnergy, whyRoundBeams. Each is one or two paragraphs separated by a
   * blank line ('\n\n'); render each paragraph as its own <p>. Keys ending in `_source` / `_note` are research
   * annotations and are not shown.
   */
  explainers?: Record<string, string>;
  project?: Record<string, unknown>;
  references?: { id: string; title: string; url?: string; year?: number | string; venue?: string; authors?: string }[];
  openQuestions?: string[];
}

export const FACILITY = facilityJson as unknown as Facility;
