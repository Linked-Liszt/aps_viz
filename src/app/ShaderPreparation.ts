import * as THREE from 'three';
import { BeamlineScene } from '../scene/beamline/BeamlineScene';
import type { Stage } from '../scene/Stage';
import { BEAMLINES } from '../data/beamlines';
import { FEATURE_META } from '../data/meta';
import { layoutFor } from '../beamlines';
import { DEFAULT_LAYOUT } from '../scene/beamline/layout';

export interface CompilationState {
  status: 'idle' | 'compiling' | 'ready' | 'error';
  completed: number;
  total: number;
}

/** Keep material references for compiled programs, without keeping the detailed models. */
class ShaderSamples {
  private materials = new Set<THREE.Material>();
  private programs = new Set<string>();
  private hdrPrograms = new Set<string>();
  private lightPrograms = new Set<string>();
  readonly timings = { hdrMs: 0, lightMs: 0 };
  private scene = new THREE.Scene();
  private target = new THREE.WebGLRenderTarget(2, 2, { type: THREE.HalfFloatType });

  constructor(private stage: Stage) {
    this.scene.environment = stage.scene.environment;
    this.scene.fog = stage.scene.fog;
    for (const source of stage.scene.children) {
      if (!(source instanceof THREE.Light)) continue;
      const light = source.clone();
      if (light instanceof THREE.DirectionalLight) {
        light.castShadow = true;
        light.shadow.mapSize.set(32, 32);
        this.scene.add(light.target);
      }
      this.scene.add(light);
    }
  }

  async compile(source: THREE.Object3D): Promise<void> {
    const root = new THREE.Group();
    const copies = new Map<THREE.Material, THREE.Material>();
    const shapes = new Set<string>();
    source.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.geometry || !mesh.material) return;
      const originals = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const original of originals) {
        if (!original.visible) continue;
        const geometry = mesh.geometry;
        const shape = [original.uuid, o.type, mesh.castShadow, !!(mesh as THREE.InstancedMesh).instanceColor, ...Object.entries(geometry.attributes).map(([key, attr]) => `${key}:${attr.itemSize}`)].join('|');
        if (shapes.has(shape)) continue;
        shapes.add(shape);
        let material = copies.get(original);
        if (!material) {
          material = original.clone();
          material.onBeforeCompile = original.onBeforeCompile;
          material.customProgramCacheKey = original.customProgramCacheKey;
          copies.set(original, material);
        }
        const sample = mesh.clone(false);
        sample.material = material;
        sample.frustumCulled = false;
        root.add(sample);
        // Focusing a beamline changes opaque building materials to transparent ones.
        if ((material instanceof THREE.MeshStandardMaterial) && !material.transparent) {
          const faded = material.clone();
          faded.onBeforeCompile = material.onBeforeCompile;
          faded.customProgramCacheKey = material.customProgramCacheKey;
          faded.transparent = true;
          faded.opacity = 0.2;
          faded.depthWrite = false;
          const fadedSample = mesh.clone(false);
          fadedSample.material = faded;
          fadedSample.frustumCulled = false;
          root.add(fadedSample);
        }
      }
    });
    const pending = new Set(root.children.map((o) => (o as THREE.Mesh).material as THREE.Material));
    const instances = root.children.filter((o): o is THREE.InstancedMesh => o instanceof THREE.InstancedMesh);
    try {
      // High and Balanced use the same scene programs. Light needs a separate output and shadow variant.
      let started = performance.now();
      await withTimeout(this.stage.compileShaders(root, false, this.scene));
      this.timings.hdrMs += performance.now() - started;
      for (const material of pending) for (const key of programKeys(this.stage, material)) this.hdrPrograms.add(key);
      started = performance.now();
      await withTimeout(this.stage.compileShaders(root, true, this.scene));
      this.timings.lightMs += performance.now() - started;
      // Draw every mesh shape before disposing duplicate materials. Shadow programs also depend on the mesh.
      this.scene.add(root);
      this.stage.renderShaderSamples(this.scene, this.target);
      for (const material of pending) {
        // Three.js associates each material with the program cache keys it compiled.
        const all = programKeys(this.stage, material);
        for (const key of all) if (!this.hdrPrograms.has(key)) this.lightPrograms.add(key);
        if (all.some((key) => !this.programs.has(key))) {
          for (const key of all) this.programs.add(key);
          this.materials.add(material);
        }
      }
    } finally {
      root.removeFromParent();
      root.clear();
      for (const instance of instances) instance.dispose();
      for (const material of pending) if (!this.materials.has(material)) material.dispose();
    }
  }

  finish(): void {
    this.target.dispose();
    this.scene.traverse((o) => {
      if (o instanceof THREE.DirectionalLight) o.shadow.dispose();
    });
  }

  get stats(): { hdrPrograms: number; lightPrograms: number; retainedMaterials: number; hdrMs: number; lightMs: number } {
    return { hdrPrograms: this.hdrPrograms.size, lightPrograms: this.lightPrograms.size, retainedMaterials: this.materials.size, ...this.timings };
  }
}

/** Prepare shader programs during the welcome, one temporary beamline model at a time. */
export class ShaderPreparation {
  state: CompilationState = { status: 'idle', completed: 0, total: FEATURE_META.length + 1 };
  private listeners = new Set<(state: CompilationState) => void>();
  private samples: ShaderSamples;

  constructor(private stage: Stage, private layouts: Promise<void>, private retained: () => Iterable<BeamlineScene>) {
    this.samples = new ShaderSamples(stage);
  }

  subscribe(listener: (state: CompilationState) => void): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  get stats(): ShaderSamples['stats'] {
    return this.samples.stats;
  }

  start(): void {
    if (this.state.status === 'compiling' || this.state.status === 'ready') return;
    this.set({ status: 'compiling', completed: 0 });
    void this.run().then(() => {
      this.samples.finish();
      this.set({ status: 'ready', completed: this.state.total });
    }).catch((error) => {
      console.error('Shader preparation failed', error);
      this.set({ status: 'error' });
    });
  }

  private set(update: Partial<CompilationState>): void {
    this.state = { ...this.state, ...update };
    for (const listener of this.listeners) listener(this.state);
  }

  private async run(): Promise<void> {
    await this.layouts;
    await this.samples.compile(this.stage.scene);
    this.stage.prepareEffects();
    this.set({ completed: 1 });
    for (const meta of FEATURE_META) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      let model: BeamlineScene | null = null;
      for (const [attempt, layout] of [layoutFor(meta.id), DEFAULT_LAYOUT(meta.id)].entries()) {
        model = new BeamlineScene(this.stage, BEAMLINES[meta.id], meta, layout, () => {}, true);
        model.hide();
        try {
          await model.buildAsync(new AbortController().signal);
          break;
        } catch (error) {
          model.dispose(this.retained());
          model = null;
          if (attempt === 0) console.warn(`Preparing ${meta.id} with the default layout`, error);
          else throw error;
        }
      }
      if (!model) throw new Error(`Could not prepare ${meta.id}`);
      try {
        await this.samples.compile(model.group);
      } finally {
        model.dispose(this.retained());
      }
      this.set({ completed: this.state.completed + 1 });
    }
  }
}

function programKeys(stage: Stage, material: THREE.Material): string[] {
  const properties = stage.renderer.properties.get(material) as { programs?: Map<string, unknown> };
  return properties.programs ? [...properties.programs.keys()] : [];
}

async function withTimeout(promise: Promise<void>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Shader compilation timed out')), 30_000);
    })]);
  } finally {
    clearTimeout(timer);
  }
}
