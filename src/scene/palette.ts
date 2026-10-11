import * as THREE from 'three';

/** Scene palette: an "architect's white model" world in which only the light (electrons, X-rays) glows. */
export const COLORS = {
  bg: 0x070b12,
  ground: 0x0d131d,
  grid: 0x22324a,
  model: 0xd6d2c9,
  modelShade: 0xaaa59b,
  concrete: 0x9d9a93,
  hallFloor: 0x1a2230,
  hutch: 0xdfe6ee,
  lead: 0x7d8794,
  steel: 0xb8c2cc,
  copper: 0xc7835a,
  silicon: 0x8fa3c4,
  detector: 0x1d2633,
  electron: new THREE.Color(1.0, 0.62, 0.18),
  xray: new THREE.Color(0.32, 0.86, 1.0),
  feature: 0x5cd3ff,
};

/** Emissive "HDR" basic material for beams: values > 1 so the bloom pass picks them up. */
export function glowMaterial(color: THREE.ColorRepresentation, intensity = 4, opacity = 1): THREE.MeshBasicMaterial {
  const c = new THREE.Color(color).multiplyScalar(intensity);
  return new THREE.MeshBasicMaterial({
    color: c,
    toneMapped: false,
    transparent: opacity < 1,
    opacity,
    depthWrite: opacity >= 1,
  });
}

/**
 * Resources the overview and every beamline scene share (palette materials, engine singletons). A beamline scene
 * frees everything else it created when it is closed, but never these: the site keeps rendering with them.
 */
const shared = new WeakSet<object>();
export function markShared<T extends object>(o: T): T {
  shared.add(o);
  return o;
}
export const isShared = (o: object): boolean => shared.has(o);

const cache = new Map<string, THREE.Material>();
function cached<T extends THREE.Material>(key: string, make: () => T): T {
  let m = cache.get(key) as T | undefined;
  if (!m) {
    m = markShared(make());
    cache.set(key, m);
  }
  return m;
}

let hutchPostprocessing = true;
const hutchOpacities = new Map<THREE.Material, number | null>();

/** Register hutch walls so their transparency stays similar in the two rendering paths. */
export function configureHutchMaterial<T extends THREE.Material>(m: T): T {
  const opacity = m.transparent ? m.opacity : null;
  hutchOpacities.set(m, opacity);
  m.opacity = hutchOpacity(opacity);
  return m;
}

function hutchOpacity(opacity: number | null): number {
  // High and Balanced blend in linear HDR before tone mapping. The same alpha makes walls much paler
  // than Light, which blends after tone mapping. Reduce only the translucent hutch fill in the HDR path.
  return opacity === null ? 1 : opacity * (hutchPostprocessing ? 0.4 : 1);
}

/** Update existing and cached hutch materials when the renderer switches quality. */
export function setHutchPostprocessing(enabled: boolean): void {
  hutchPostprocessing = enabled;
  for (const [m, opacity] of hutchOpacities) m.opacity = hutchOpacity(opacity);
}

export const mats = {
  genericHutch: () => cached('genericHutch', () => configureHutchMaterial(new THREE.MeshStandardMaterial({ color: 0x5d6673, roughness: 0.95, metalness: 0 }))),
  model: () => cached('model', () => new THREE.MeshStandardMaterial({ color: COLORS.model, roughness: 0.92, metalness: 0 })),
  modelShade: () => cached('modelShade', () => new THREE.MeshStandardMaterial({ color: COLORS.modelShade, roughness: 0.95 })),
  concrete: () => cached('concrete', () => new THREE.MeshStandardMaterial({ color: COLORS.concrete, roughness: 0.97 })),
  hallFloor: () => cached('hallFloor', () => new THREE.MeshStandardMaterial({ color: COLORS.hallFloor, roughness: 0.9 })),
  steel: () => cached('steel', () => new THREE.MeshStandardMaterial({ color: COLORS.steel, roughness: 0.5, metalness: 0.7 })),
  darkSteel: () => cached('darkSteel', () => new THREE.MeshStandardMaterial({ color: 0x4a5563, roughness: 0.45, metalness: 0.6 })),
  copper: () => cached('copper', () => new THREE.MeshStandardMaterial({ color: COLORS.copper, roughness: 0.3, metalness: 0.85 })),
  silicon: () => cached('silicon', () => new THREE.MeshStandardMaterial({ color: COLORS.silicon, roughness: 0.12, metalness: 0.5 })),
  mirror: () => cached('mirror', () => new THREE.MeshStandardMaterial({ color: 0xdfe8f5, roughness: 0.04, metalness: 1.0 })),
  detector: () => cached('detector', () => new THREE.MeshStandardMaterial({ color: COLORS.detector, roughness: 0.6, metalness: 0.3 })),
  granite: () => cached('granite', () => new THREE.MeshStandardMaterial({ color: 0x2b2f36, roughness: 0.75 })),
  hutchWall: () =>
    cached('hutchWall', () =>
      configureHutchMaterial(new THREE.MeshStandardMaterial({ color: COLORS.hutch, roughness: 0.6, transparent: true, opacity: 0.2, depthWrite: false, side: THREE.BackSide, forceSinglePass: true })),
    ),
  hutchEdge: () => cached('hutchEdge', () => new THREE.LineBasicMaterial({ color: 0xc9d6e6, transparent: true, opacity: 0.55 })),
  magnetDipole: () => cached('magDip', () => new THREE.MeshStandardMaterial({ color: 0x3f7fd6, roughness: 0.5, metalness: 0.2 })),
  magnetQuad: () => cached('magQuad', () => new THREE.MeshStandardMaterial({ color: 0xd8473f, roughness: 0.5, metalness: 0.2 })),
  magnetSext: () => cached('magSext', () => new THREE.MeshStandardMaterial({ color: 0x3fae6a, roughness: 0.5, metalness: 0.2 })),
  magnetReverse: () => cached('magRev', () => new THREE.MeshStandardMaterial({ color: 0xe0782f, roughness: 0.5, metalness: 0.2 })),
  magnetCorrector: () => cached('magCor', () => new THREE.MeshStandardMaterial({ color: 0x8a7fb8, roughness: 0.6, metalness: 0.2 })),
  undulator: () => cached('und', () => new THREE.MeshStandardMaterial({ color: 0x8a95a5, roughness: 0.35, metalness: 0.8 })),
};

/** Ground material with an anti-aliased world-space survey grid baked into the standard lighting model. */
export function groundMaterial(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color: COLORS.ground, roughness: 1, metalness: 0 });
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWorldPos;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
         varying vec3 vWorldPos;
         float gridLine(vec2 p, float spacing, float width) {
           vec2 g = abs(fract(p / spacing - 0.5) - 0.5) / fwidth(p / spacing);
           return 1.0 - min(min(g.x, g.y) / width, 1.0);
         }`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
         float r = length(vWorldPos.xz);
         float major = gridLine(vWorldPos.xz, 50.0, 1.0);
         float minor = gridLine(vWorldPos.xz, 10.0, 0.8) * 0.45;
         float fade = 1.0 - smoothstep(380.0, 900.0, r);
         vec3 gridCol = vec3(0.10, 0.15, 0.23);
         diffuseColor.rgb = mix(diffuseColor.rgb, gridCol, max(major, minor) * fade * 0.45);
         diffuseColor.rgb *= mix(0.55, 1.0, fade);`,
      );
  };
  return m;
}

/**
 * Fade a lit material to `opacity` (null: back to opaque). Toggling `transparent` must recompile: a program built while
 * the material was opaque carries `#define OPAQUE`, which forces alpha to 1 and would draw the "faded" mesh solid.
 */
export function setFaded(m: THREE.Material, opacity: number | null): void {
  const on = opacity !== null;
  if (m.transparent !== on) m.needsUpdate = true;
  m.transparent = on;
  if (hutchOpacities.has(m)) {
    hutchOpacities.set(m, opacity);
    m.opacity = hutchOpacity(opacity);
  } else m.opacity = opacity ?? 1;
  m.depthWrite = !on;
}
