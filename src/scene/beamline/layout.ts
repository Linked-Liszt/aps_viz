import type * as THREE from 'three';
import type { Beamline, BeamlineComponent } from '../../data/types';

/**
 * Per-beamline geometric interpretation of a dossier. The dossier says WHAT is WHERE (distance from source);
 * The layout defines branch positions and supplies beamline-specific models.
 * Local frame: +X downstream from the ID source point, +Y up (0 = beam height), +Z outboard.
 */
export interface BranchLayout {
  /** Lateral offset (m, +outboard) once fully diverged (ignored when angleMrad is set). */
  side: number;
  /** straight-line deflection: side grows linearly by angleMrad/1000 per metre after divergeAtM (+ = outboard) */
  angleMrad?: number;
  /** lateral offset already present at divergeAtM when angleMrad is used (e.g. from canting), default 0 */
  side0?: number;
  /** Distance from source where the branch starts to separate (e.g. at a side-bounce optic or canted ID). */
  divergeAtM: number;
  /** Length over which the separation ramps in (straight-line divergence = canting). */
  rampM?: number;
  label?: string;
  color?: string;
}

export interface CompOverride {
  distanceM?: number;
  side?: number;
  dy?: number;
  hidden?: boolean;
  /** extra options forwarded to the part builder (e.g. { sizeM: 0.4 } for a detector, { lengthM: 8 } for a flight tube) */
  props?: Record<string, unknown>;
  rotY?: number;
  /** full Euler rotation [x, y, z] in radians (applied in the beamline frame: +X downstream, +Y up, +Z outboard) */
  rot?: [number, number, number];
  scale?: number;
  /** replace the generic model entirely */
  build?: (ctx: BuildCtx) => THREE.Object3D;
  /** pin label height above the component origin (m) */
  pinUp?: number;
  /** close-up camera: radius (m), view direction FROM target TO camera in the local frame, and target offset */
  shot?: { r?: number; dir?: [number, number, number]; target?: [number, number, number] };
  /** pin declutter priority (1 plumbing … 3 headline; >3 always shown when in view). Only pins ≥ 3 (or of a headline
   *  category) appear during the guided tour. */
  pinPriority?: number;
}

export interface EnclosureOverride {
  side?: number;
  widthM?: number;
  heightM?: number;
  startM?: number;
  endM?: number;
  /** do not draw this enclosure (layout draws its own, or it is not a physical hutch) */
  hidden?: boolean;
  /** hutch (default) · room (support space: floor + low outline) · ghost (legacy/unused: outline only) · transport (pipe) */
  style?: 'hutch' | 'room' | 'ghost' | 'transport';
  /** non-rectangular footprint as local [x, z] points (x along beam from the source, z outboard) */
  outline?: [number, number][];
  /** hutch-name label: 'always' survives decluttering (default for the beamline's experiment stations), 'auto', or 'hidden' */
  label?: 'always' | 'auto' | 'hidden';
}

export interface ScatterSpec {
  /** component id of the sample / interaction point */
  from: string;
  /** component id of the detector receiving the scattered or emitted X-rays */
  to: string;
  /** cone half-angle in radians (visual) */
  spread?: number;
  kind?: 'cone' | 'fan' | 'fluorescence';
  /** minimum cone radius at the detector (m), default 0.05 */
  minRadius?: number;
  /** cone opacity (additive), default 0.14 */
  opacity?: number;
}

export interface BuildCtx {
  group: THREE.Group;
  data: Beamline;
  color: string;
  beamY: number;
  /** local position helper: x along beam (m from source), side (+ = outboard), up (m above beam centre).
   *  The group's local frame is +X downstream, +Y up, +Z outboard; parts are added to ctx.group. */
  at: (x: number, side?: number, up?: number) => THREE.Vector3;
  sideAt: (branch: string | null | undefined, x: number) => number;
  addPickable: (obj: THREE.Object3D, componentId: string) => void;
  /** per-frame callback while this beamline is shown (dt, elapsed seconds); removed on dispose */
  onFrame: (fn: (dt: number, t: number) => void) => void;
  /** add a small CSS label at a local position; it joins the scene's label layer and is cleaned up on dispose */
  addLabel: (text: string, local: THREE.Vector3, opts?: { className?: string; maxDist?: number; bare?: boolean }) => HTMLElement;
  /** draw an extra beam path with engine colours + travelling pulses (local points). Pulses of all beams are one
   *  instanced draw call; a beam's pulses disappear while its line (or a parent) is hidden, so hiding an engine beam
   *  line also hides its pulses. They freeze under prefers-reduced-motion. */
  addBeam: (points: THREE.Vector3[], kind?: 'white' | 'pink' | 'mono' | 'scatter', opts?: { width?: number; dashed?: boolean; pulses?: boolean; opacity?: number }) => THREE.Object3D;
}

/*
 * Engine conventions layout code can rely on:
 * - Materials must not use `transmission` (it costs a full extra scene pass every frame): the engine draws any that do
 *   as plain transparency and warns in development. Use alpha + clearcoat glass instead.
 * - Static batching merges meshes that did not move during the first second(s) once the camera has settled; mark
 *   meshes that move later with `userData.noBatch = true`. Pickable meshes and invisible-material hit volumes are
 *   never merged.
 * - Everything the scene creates (geometries, materials, textures) is disposed when the beamline closes, except
 *   palette / engine singletons (see markShared in scene/palette.ts); module-cached resources re-upload on reuse.
 * - The engine hides hutch names, ruler marks and addLabel captions that overlap pins or interface panels. After
 *   custom() hides a label with `visible = false` or detaches it during construction, the engine stops changing it.
 */

export interface BeamlineLayout {
  id: string;
  /** Rotate the whole beamline about the source (canted pairs), mrad. */
  cantMrad?: number;
  /** Lateral shift of the whole beamline in metres, used for the second line of a canted sector. */
  sideOffsetM?: number;
  /** Source point shift along the straight (m), e.g. for canted ID pairs. */
  sourceShiftM?: number;
  branches?: Record<string, BranchLayout>;
  comp?: Record<string, CompOverride>;
  enclosure?: Record<string, EnclosureOverride>;
  enclosureDefaults?: { widthM?: number; heightM?: number };
  /** Distance where the beam becomes monochromatic (default: first mono component). */
  monoAtM?: number | Record<string, number>;
  scatter?: ScatterSpec[];
  /** Extra building / bespoke geometry (e.g. long-beamline corridor). */
  custom?: (ctx: BuildCtx) => void;
  /** Camera framing for the "whole beamline" shot (distanceScale > 1 backs off). */
  camera?: { along?: number; side?: number; up?: number; distanceScale?: number };
  /** where each branch's engine beam ends (m from source); default = last sample-like component */
  beamEndM?: number | Record<string, number>;
  /** Context-only branches, such as a canted partner beamline, use dimmer beams, no pulses and lower-priority pins. */
  partnerBranches?: string[];
  /** lateral position of the distance ruler (m, + outboard); default 3.4 */
  rulerSide?: number;
  /** scale figures: false = none, or explicit local positions {x, side, rotY} */
  people?: false | { x: number; side: number; rotY?: number; pose?: 'stand' | 'point' }[];
  /** neighbouring sectors whose schematic hutch trains (and schematic beams) overlap this beamline's real footprint */
  suppressSiteHutches?: number[];
  /** documented distance (m) where this sector's front end exits the ratchet shield wall (default site value ~23.8) */
  ratchetFaceM?: number;
  /** name for the shared (branch-less) row of the subway map, default 'shared' */
  sharedRowLabel?: string;
  /** Which components to hide from the pin list (still shown in 3D). */
  quietPins?: string[];
  /** Components to treat as on a given branch when the dossier leaves branch null. */
  defaultBranch?: string;
}

export const DEFAULT_LAYOUT = (id: string): BeamlineLayout => ({ id });

export function compBranch(c: BeamlineComponent, layout: BeamlineLayout): string | null {
  return (c.branch as string | null | undefined) ?? layout.defaultBranch ?? null;
}

/** Lateral offset of a branch at distance x (shared by the detailed scene and the overview lines). */
export function branchSide(layout: BeamlineLayout, branch: string | null | undefined, x: number): number {
  const b = branch ? layout.branches?.[branch] : undefined;
  if (!b) return 0;
  if (b.angleMrad !== undefined) return (b.side0 ?? 0) + Math.max(0, x - b.divergeAtM) * (b.angleMrad / 1000);
  const ramp = b.rampM ?? 0;
  if (ramp <= 0) return x >= b.divergeAtM ? b.side : 0;
  const t = Math.max(0, Math.min(1, (x - b.divergeAtM) / ramp));
  return b.side * t * t * (3 - 2 * t);
}
