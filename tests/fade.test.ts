import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { setFaded } from '../src/scene/palette';

describe('setFaded', () => {
  it('recompiles when transparency toggles, so the OPAQUE define cannot force a faded mesh solid', () => {
    const m = new THREE.MeshStandardMaterial();
    const v0 = m.version;
    setFaded(m, 0.11);
    expect(m.version).toBe(v0 + 1);
    expect(m.transparent).toBe(true);
    expect(m.opacity).toBeCloseTo(0.11);
    expect(m.depthWrite).toBe(false);
    // changing only the opacity is a uniform update, no recompile
    setFaded(m, 0.2);
    expect(m.version).toBe(v0 + 1);
    setFaded(m, null);
    expect(m.version).toBe(v0 + 2);
    expect(m.transparent).toBe(false);
    expect(m.opacity).toBe(1);
    expect(m.depthWrite).toBe(true);
  });
});
