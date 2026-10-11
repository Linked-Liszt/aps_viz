/**
 * Content model. Beamline dossiers are researched JSON files (src/data/beamlines/*.json), fact-checked
 * against the APS-U Final Design Report (2019) and newer publications; every number carries a reference id.
 *
 * Every displayed text exists once, written like a museum label for every reader: a plain lead, the mechanism with
 * each technical term defined in passing, then one or two telling numbers and the caveat a specialist would look for.
 * Dense detail lives in compact tables (`specs`, `keyParameters`) and in fine-print fields shown to everyone in small
 * type (`distanceNote`, `detectors`, `sampleEnvironments`, `quantitative`, `geometryNotes`, `whatItShows`,
 * `openQuestions`, `source.*`).
 */

export type ComponentCategory =
  | 'undulator'
  | 'frontEnd'
  | 'shutter'
  | 'slits'
  | 'window'
  | 'filter'
  | 'attenuator'
  | 'mirror'
  | 'monochromator'
  | 'multilayerMono'
  | 'crl'
  | 'transfocator'
  | 'kbMirror'
  | 'zonePlate'
  | 'mll'
  | 'phaseRetarder'
  | 'polarizationAnalyzer'
  | 'collimator'
  | 'beamStop'
  | 'diagnostics'
  | 'beamPipe'
  | 'sample'
  | 'diffractometer'
  | 'goniometer'
  | 'sampleEnvironment'
  | 'detector'
  | 'spectrometer'
  | 'analyzer'
  | 'flightTube'
  | 'wire'
  | 'codedAperture'
  | 'other';

export interface Reference {
  id: string;
  title: string;
  authors?: string;
  year?: number | string;
  venue?: string;
  url?: string;
  type?: string;
}

export interface BeamlineComponent {
  id: string;
  name: string;
  category: ComponentCategory | string;
  branch?: string | null;
  distanceM: number | null;
  distanceNote?: string;
  enclosure?: string;
  deflection?: 'horizontal' | 'vertical' | 'none' | string;
  /** what this part does and why it is there, 2–4 sentences */
  text: string;
  /** compact key → value table (key spelled for people, or a research key that `specLabel` formats) */
  specs?: Record<string, string | number>;
  source?: string;
}

export interface Enclosure {
  name: string;
  role: string;
  startM: number;
  endM: number;
  widthM?: number | null;
  branch?: string | null;
  notes?: string;
}

export interface Instrument {
  name: string;
  enclosure?: string;
  text: string;
  detectors?: string[];
  sampleEnvironments?: string[];
  source?: string;
}

export interface InsertionDevice {
  name: string;
  type: string;
  periodMm?: number | null;
  lengthM?: number | null;
  count?: number | null;
  polarization?: string;
  notes?: string;
  source?: string;
}

export interface Figure {
  file: string;
  caption: string;
  source?: string;
  page?: number;
  whatItShows?: string;
}

export interface Beamline {
  id: string;
  sector: string;
  acronym: string;
  fullName: string;
  status2026: { state: string; detail: string; sources?: string[] };
  tagline: string;
  /** one paragraph: what the beamline is for and how it works */
  summary: string;
  /** `text` ends with the key quantitative gain and its caveat; `quantitative` is the fine-print list of numbers */
  whatAPSUEnables: { text: string; quantitative: string[] };
  techniques: { name: string; abbrev?: string; text: string }[];
  scienceCases: { title: string; text: string; refs?: string[] }[];
  keyParameters: { label: string; value: string; source?: string; note?: string }[];
  source: {
    insertionDevices: InsertionDevice[];
    canting?: string;
    frontEnd?: string;
    sourceSizeAndDivergence?: string;
  };
  branches?: { id: string; name: string; description: string }[];
  components: BeamlineComponent[];
  enclosures: Enclosure[];
  instruments: Instrument[];
  totalLengthM: number;
  geometryNotes?: string;
  interactiveIdeas?: { title: string; concept: string; whatUserLearns: string; physicsToGetRight?: string }[];
  funFacts?: string[];
  figures?: Figure[];
  references: Reference[];
  openQuestions?: string[];
}

/** Presentation metadata that is not research content (colors, which explainer to mount, etc.). */
export interface BeamlineMeta {
  id: string;
  sectorNumber: number;
  color: string;
  /** Expanded name only (no acronym, sector or station), e.g. 'X-ray Photon Correlation Spectroscopy'. Titles use `${acronym} — ${displayName}`. */
  displayName: string;
  /** Experiment stations, e.g. '4-ID-B, G, H'. */
  stations: string;
  /** short technique label for the overview chip */
  short: string;
  explainers: string[];
  /** Branch canting / placement within the sector (e.g. 34-ID hosts two canted beamlines). */
  cantOffsetDeg?: number;
}
