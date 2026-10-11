import { afterEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { configureHutchMaterial, mats, setFaded, setHutchPostprocessing } from '../src/scene/palette';

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

describe('hutch transparency', () => {
  afterEach(() => setHutchPostprocessing(true));

  it('reduces the wall fill in HDR and restores the existing Light appearance without recompiling', () => {
    setHutchPostprocessing(false);
    const wall = mats.hutchWall();
    expect(wall.opacity).toBe(0.2);
    const version = wall.version;
    setHutchPostprocessing(true);
    expect(wall.opacity).toBeLessThan(0.2);
    expect(wall.transparent).toBe(true);
    expect(wall.depthWrite).toBe(false);
    expect(wall.side).toBe(THREE.BackSide);
    expect(wall.forceSinglePass).toBe(true);
    setHutchPostprocessing(false);
    expect(mats.hutchWall()).toBe(wall);
    expect(wall.opacity).toBe(0.2);
    expect(wall.version).toBe(version);
  });

  it('preserves neighbouring hutches fading and returning to the opaque overview across quality changes', () => {
    const wall = configureHutchMaterial(new THREE.MeshStandardMaterial());
    const version = wall.version;
    setFaded(wall, 0.22);
    expect(wall.opacity).toBeLessThan(0.22);
    expect(wall.version).toBe(version + 1);
    setHutchPostprocessing(false);
    expect(wall.opacity).toBe(0.22);
    expect(wall.transparent).toBe(true);
    setFaded(wall, null);
    setHutchPostprocessing(true);
    expect(wall.opacity).toBe(1);
    expect(wall.transparent).toBe(false);
    expect(wall.depthWrite).toBe(true);
    expect(wall.version).toBe(version + 2);
  });

  it('applies the current quality to newly created walls and leaves other materials and hutch edges alone', () => {
    setHutchPostprocessing(false);
    const first = configureHutchMaterial(new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.2 }));
    const vessel = new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.2 });
    const edge = mats.hutchEdge();
    const edgeOpacity = edge.opacity;
    setHutchPostprocessing(true);
    const second = configureHutchMaterial(new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.2 }));
    expect(second.opacity).toBe(first.opacity);
    expect(second.opacity).toBeLessThan(vessel.opacity);
    expect(vessel.opacity).toBe(0.2);
    expect(edge.opacity).toBe(edgeOpacity);
  });
});
