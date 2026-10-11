import { svg } from '../lib/dom';

export const CATEGORY_LABEL: Record<string, string> = {
  undulator: 'Light source · insertion device',
  frontEnd: 'Front end',
  shutter: 'Shutter',
  fastShutter: 'Fast exposure shutter',
  slits: 'Slits',
  window: 'Window',
  filter: 'Filter',
  attenuator: 'Attenuator',
  mirror: 'X-ray mirror',
  monochromator: 'Monochromator',
  multilayerMono: 'Multilayer monochromator',
  crl: 'Compound refractive lenses',
  transfocator: 'Transfocator zoom lens',
  kbMirror: 'Kirkpatrick–Baez focusing mirrors',
  zonePlate: 'Fresnel zone plate',
  mll: 'Multilayer Laue lens',
  phaseRetarder: 'Phase retarder',
  polarizationAnalyzer: 'Polarization analyzer',
  collimator: 'Collimator',
  beamStop: 'Beam stop',
  diagnostics: 'Beam diagnostics',
  beamPipe: 'Beam transport',
  sample: 'Sample position',
  diffractometer: 'Diffractometer',
  goniometer: 'Goniometer',
  sampleEnvironment: 'Sample environment',
  detector: 'Detector',
  spectrometer: 'Spectrometer',
  analyzer: 'Analyzer',
  flightTube: 'Flight tube',
  wire: 'Differential-aperture wire',
  codedAperture: 'Coded aperture',
  other: 'Component',
};

/**
 * Kind of one component, for labels and icons. Most come straight from the category; a "fast shutter" is a
 * millisecond exposure shutter (not part of the personnel safety system), so it gets its own kind even when the
 * dossier files it under `shutter`.
 */
export function componentKindKey(c: { category: string; name: string }): string {
  const cat = String(c.category);
  return cat === 'shutter' && /\bfast\b/i.test(c.name) ? 'fastShutter' : cat;
}

/** Human label for a component's kind (see componentKindKey). */
export function componentKind(c: { category: string; name: string }): string {
  const k = componentKindKey(c);
  return CATEGORY_LABEL[k] ?? k;
}

/** Tiny pictograms per component family, drawn on a 20×20 grid. */
const GLYPHS: Record<string, string> = {
  undulator: '<path d="M2 7h2v6H2zM6 7h2v6H6zM10 7h2v6h-2zM14 7h2v6h-2z" fill="currentColor" stroke="none" opacity=".55"/><path d="M1 10c1.5-3 3-3 4.5 0s3 3 4.5 0 3-3 4.5 0 3 3 4.5 0"/>',
  frontEnd: '<rect x="3" y="6" width="14" height="8" rx="1"/><path d="M1 10h18"/>',
  shutter: '<rect x="7" y="3" width="6" height="14" rx="1"/><path d="M1 10h5"/>',
  fastShutter: '<rect x="5" y="3" width="6" height="14" rx="1"/><path d="M1 10h3M16 3l-2.5 6h4L15 17"/>',
  slits: '<path d="M10 2v6M10 12v6M2 10h4M14 10h4"/>',
  window: '<ellipse cx="10" cy="10" rx="2" ry="6"/><path d="M1 10h18"/>',
  filter: '<path d="M8 4v12M12 4v12M1 10h18"/>',
  attenuator: '<path d="M8 4v12M12 4v12M1 10h18"/>',
  mirror: '<path d="M3 14l14-3"/><path d="M1 8l9 3 9-6"/>',
  monochromator: '<path d="M5 13l4-2M11 9l4-2"/><path d="M1 12h6l6-3h6"/>',
  multilayerMono: '<path d="M5 13l4-2M11 9l4-2"/><path d="M1 12h6l6-3h6"/>',
  crl: '<path d="M6 4c2 4 2 8 0 12M10 4c2 4 2 8 0 12M14 4c2 4 2 8 0 12"/>',
  transfocator: '<path d="M6 4c2 4 2 8 0 12M10 4c2 4 2 8 0 12M14 4c2 4 2 8 0 12"/>',
  kbMirror: '<path d="M2 6l16 4M2 14l16-4"/>',
  zonePlate: '<circle cx="10" cy="10" r="7"/><circle cx="10" cy="10" r="4.5"/><circle cx="10" cy="10" r="2"/>',
  mll: '<path d="M7 3v14M9 3v14M11 3v14M13 3v14"/>',
  phaseRetarder: '<path d="M10 3l5 7-5 7-5-7z"/>',
  polarizationAnalyzer: '<path d="M10 3l5 7-5 7-5-7z"/>',
  sample: '<circle cx="10" cy="10" r="2.5" fill="currentColor"/><path d="M10 2v4M10 14v4M2 10h4M14 10h4"/>',
  diffractometer: '<circle cx="10" cy="10" r="6"/><circle cx="10" cy="10" r="1.6" fill="currentColor"/><path d="M10 10l7-6"/>',
  goniometer: '<circle cx="10" cy="10" r="6"/><circle cx="10" cy="10" r="1.6" fill="currentColor"/>',
  sampleEnvironment: '<rect x="6" y="3" width="8" height="14" rx="3"/><circle cx="10" cy="13" r="1.4" fill="currentColor"/>',
  detector: '<rect x="4" y="3" width="12" height="14" rx="1"/><path d="M8 3v14M12 3v14M4 8h12M4 12h12"/>',
  spectrometer: '<path d="M3 15a12 12 0 0114-12"/><circle cx="5" cy="15" r="1.5" fill="currentColor"/>',
  analyzer: '<path d="M3 15a12 12 0 0114-12"/>',
  flightTube: '<rect x="2" y="7" width="16" height="6" rx="3"/>',
  wire: '<circle cx="10" cy="10" r="1.6" fill="currentColor"/><path d="M2 16l8-6 8-6"/>',
  codedAperture: '<rect x="4" y="4" width="12" height="12"/><path d="M6 6h3v3H6zM11 11h3v3h-3zM11 6h2v2h-2z" fill="currentColor" stroke="none"/>',
  beamStop: '<circle cx="10" cy="10" r="3" fill="currentColor"/><path d="M10 2v5"/>',
  diagnostics: '<rect x="5" y="5" width="10" height="10" rx="2"/><circle cx="10" cy="10" r="2"/>',
  collimator: '<path d="M10 2v6M10 12v6M2 10h4M14 10h4"/>',
  beamPipe: '<path d="M1 8h18M1 12h18"/>',
};

export function categoryIcon(cat: string, size = 16): SVGSVGElement {
  const s = svg('svg', {
    viewBox: '0 0 20 20',
    width: size,
    height: size,
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': 1.5,
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': 'true',
    class: 'cat-ico',
  });
  s.innerHTML = GLYPHS[cat] ?? '<rect x="5" y="5" width="10" height="10" rx="2"/>';
  return s;
}
