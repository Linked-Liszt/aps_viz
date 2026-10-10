import * as THREE from 'three';
import type { BuildCtx } from '../../scene/beamline/layout';

/**
 * Beam drawing for CHEX.
 *
 * The engine draws each branch as a polyline whose lateral offset follows a smoothstep ramp (BranchLayout.side /
 * divergeAtM / rampM). CHEX's fixed-energy branches leave their crystals in STRAIGHT lines at 23° and 5°, so a ramp
 * would bend them into S-curves that miss every component. This module therefore hides the engine's branch polylines
 * and their pulses, and the layout redraws all beams along their true straight paths with ctx.addBeam (engine colours,
 * widths and travelling pulses). (Suggested engine change: BranchLayout { angleDeg } for straight side-bounce branches.)
 */

export interface BeamSeg {
  pts: THREE.Vector3[];
  kind: 'white' | 'mono';
  width?: number;
  pulses?: boolean;
}

/** Hide the engine's own branch beam lines and pulse sprites (call first in custom(); scatter cones are kept). */
export function hideEngineBeams(root: THREE.Group): void {
  for (const o of root.children) {
    const l = o as THREE.Mesh & { isLine2?: boolean };
    if (l.isLine2) l.visible = false;
    const m = o as THREE.Mesh;
    const geo = m.geometry as THREE.SphereGeometry | undefined;
    if (m.isMesh && geo?.type === 'SphereGeometry' && geo.parameters.radius === 0.035 && m.userData.u !== undefined) m.visible = false;
  }
}

/** Draw the true beam paths through the engine (call after hideEngineBeams). */
export function drawBeams(ctx: BuildCtx, segs: BeamSeg[]): void {
  for (const s of segs) ctx.addBeam(s.pts, s.kind, { width: s.width, pulses: s.pulses ?? true });
}
