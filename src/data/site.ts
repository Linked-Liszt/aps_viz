import * as THREE from 'three';
import siteJson from './site.json';

/**
 * Site geometry. Ground coordinates are metres with x = east, y = north, origin at the storage-ring centre
 * (fit to OpenStreetMap footprints). In three.js world space: X = east, Y = up, Z = south (Z = -north).
 */
export interface SiteBuilding {
  id: string;
  name: string;
  fullName?: string;
  role: string;
  polygon: [number, number][];
  heightM: number;
}

export interface SiteData {
  /** perpendicular distance from the ring centre to each ID straight (source points sit here) */
  orbitRadiusM: number;
  /** mean electron-orbit radius (C / 2π), used to draw the orbit */
  orbitDrawRadiusM?: number;
  rfSectors?: number[];
  bunchLengtheningSector?: number;
  /** distance from the source at which front ends exit the ratchet (shield) wall */
  ratchetFaceM?: number;
  roads?: { name: string; kind: string; polyline: [number, number][] }[];
  circumferenceM: number;
  sectors: number;
  /** Angle of sector-1 ID straight centre, CCW from east (degrees). */
  sector1AngleDeg: number;
  /** Sector numbers (and electron motion) increase clockwise when seen from above. */
  clockwise: boolean;
  injectionSector?: number;
  tunnelInnerM: number;
  tunnelOuterM: number;
  hallInnerM: number;
  hallOuterM: number;
  beamHeightM: number;
  buildings: SiteBuilding[];
  injector: {
    linac: [number, number][];
    par: { center: [number, number]; radiusM: number };
    booster: { center: [number, number]; radiusM: number; outline?: [number, number][] };
    bts: [number, number][];
  };
  notes: string[];
}

export const SITE: SiteData = siteJson as unknown as SiteData;

export const toWorld = (x: number, y: number, h = 0): THREE.Vector3 => new THREE.Vector3(x, h, -y);

export interface SectorFrame {
  sector: number;
  angle: number;
  /** ID straight-section centre on the electron orbit (beam height). */
  source: THREE.Vector3;
  /** Unit vector along electron motion = X-ray beam direction for the ID beamline. */
  dir: THREE.Vector3;
  /** Horizontal unit vector pointing to the right of the beam (outboard side, away from ring centre). */
  right: THREE.Vector3;
  /** Quaternion that rotates local +X onto `dir` with +Y up. */
  quat: THREE.Quaternion;
}

const TWO_PI = Math.PI * 2;

export function sectorAngle(n: number): number {
  const step = TWO_PI / SITE.sectors;
  const sgn = SITE.clockwise ? -1 : 1;
  return THREE.MathUtils.degToRad(SITE.sector1AngleDeg) + sgn * (n - 1) * step;
}

/** Frame of the ID beamline in sector n. `cantMrad` rotates the beam about the source (canted undulators). */
export function sectorFrame(n: number, cantMrad = 0, offsetAlongM = 0): SectorFrame {
  const a = sectorAngle(n);
  const R = SITE.orbitRadiusM;
  const sgn = SITE.clockwise ? -1 : 1;
  // ground-plane tangent for motion in the numbering direction
  let tx = -sgn * Math.sin(a);
  let ty = sgn * Math.cos(a);
  if (cantMrad) {
    const c = cantMrad / 1000;
    const cx = tx * Math.cos(c) - ty * Math.sin(c);
    const cy = tx * Math.sin(c) + ty * Math.cos(c);
    tx = cx;
    ty = cy;
  }
  const source = toWorld(R * Math.cos(a) + tx * offsetAlongM, R * Math.sin(a) + ty * offsetAlongM, SITE.beamHeightM);
  const dir = new THREE.Vector3(tx, 0, -ty).normalize();
  const up = new THREE.Vector3(0, 1, 0);
  const right = new THREE.Vector3().crossVectors(dir, up).normalize();
  // ensure "right" points away from the ring centre
  const radial = new THREE.Vector3(source.x, 0, source.z).normalize();
  if (right.dot(radial) < 0) right.negate();
  const m = new THREE.Matrix4().makeBasis(dir, up, new THREE.Vector3().crossVectors(dir, up));
  const quat = new THREE.Quaternion().setFromRotationMatrix(m);
  return { sector: n, angle: a, source, dir, right, quat };
}

/** Point along an ID beamline: d metres from the source, `side` metres to the outboard side, `h` above beam. */
export function alongBeam(f: SectorFrame, d: number, side = 0, h = 0): THREE.Vector3 {
  return f.source.clone().addScaledVector(f.dir, d).addScaledVector(f.right, side).add(new THREE.Vector3(0, h, 0));
}

/** Radial position of a point d metres down the beamline (useful to see where it exits the hall). */
export function radiusAt(d: number): number {
  return Math.hypot(SITE.orbitRadiusM, d);
}
