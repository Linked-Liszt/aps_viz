import sectorsJson from './sectors.json';

/**
 * Per-sector overview info (beamline presence, names, operators, APS-U enhancements).
 * sectors.json is generated: python3 scripts/build-sectors.py research/sectors.json src/data/sectors.json
 * (exhibit wording lives in scripts/exhibit-overrides/sectors.json; do not hand-edit the JSON).
 */
export interface SectorBeamline {
  name: string;
  title?: string;
  summary?: string;
  url?: string;
  status?: string;
  type: 'ID' | 'BM';
  stations?: string[];
  operator?: string;
  techniques?: string[];
  feature?: boolean;
  enhanced?: boolean;
  enhancement?: { plain: string; expert: string; source?: string } | null;
  notes?: string;
}

export interface SectorInfo {
  sector: number;
  /** Short plain-language label for the sector's enhancement program (present on every enhanced sector). */
  plainLabel?: string;
  lom?: string;
  canted?: boolean;
  operators?: string;
  id: boolean;
  bm: boolean;
  idLengthM?: number;
  bmLengthM?: number;
  beamlines: SectorBeamline[];
}

const raw = (sectorsJson as unknown as { sectors: Record<string, SectorInfo> }).sectors ?? {};

export const SECTOR_INFO: Record<number, SectorInfo> = Object.fromEntries(
  Array.from({ length: 40 }, (_, i) => {
    const n = i + 1;
    return [n, raw[n] ?? { sector: n, id: n <= 35, bm: n <= 35, beamlines: [] }];
  }),
);

/** Sectors with at least one beamline that received APS-U enhancements. */
export const enhancedSectors = (): number[] =>
  Object.values(SECTOR_INFO)
    .filter((s) => s.beamlines.some((b) => b.enhanced))
    .map((s) => s.sector);
