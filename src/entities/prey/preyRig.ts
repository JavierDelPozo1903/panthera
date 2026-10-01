import * as THREE from 'three';
import { smoothstep } from '../../core/math';
import {
  mergeParts,
  skinnedMeshFromGeometry,
  ellipsoid,
  limb,
  srgb,
  standardLegs,
  torsoLoft,
  type ColorFn,
  type TorsoSection,
} from '../animal/rigBuilder';
import { JOINTS, type V3 } from '../animal/skeleton';

export type PreySpecies = 'impala' | 'zebra' | 'wildebeest' | 'warthog';

interface UngulateDef {
  torso: TorsoSection[];
  legs: { frontUpper: number; frontLower: number; hindUpper: number; hindLower: number; paw: number };
  neck: { from: V3; to: V3; r0: number; r1: number };
  head: { center: V3; radii: V3; pitch: number };
  muzzle: { center: V3; radii: V3 };
  ear: { offset: V3; radii: V3 };
  coat: (seed: number) => ColorFn;
  extras: (parts: THREE.BufferGeometry[], coat: ColorFn, seed: number) => void;
}

const tmp = new THREE.Color();
const HOOF = srgb(0x1c1612);

/** Pezuñas oscuras en la parte baja de las patas. */
const withHooves = (coat: ColorFn): ColorFn => (n, p) => (p.y < 0.11 ? HOOF : coat(n, p));

function horn(parts: THREE.BufferGeometry[], points: V3[], r: number, color: THREE.Color): void {
  for (let i = 0; i < points.length - 1; i++) {
    parts.push(...limb(points[i], points[i + 1], r * (1 - i / points.length), r * (1 - (i + 1) / points.length) + 0.004, 'head', color));
  }
}

const DEFS: Record<PreySpecies, UngulateDef> = {
  impala: {
    torso: [
      [-0.95, 0.06, 0.07, 0.97],
      [-0.86, 0.15, 0.2, 0.98],
      [-0.62, 0.18, 0.24, 0.98],
      [-0.3, 0.17, 0.23, 0.96],
      [0.0, 0.18, 0.25, 0.97],
      [0.25, 0.19, 0.27, 0.99],
      [0.45, 0.17, 0.25, 1.03],
      [0.6, 0.12, 0.17, 1.08],
    ],
    legs: { frontUpper: 0.075, frontLower: 0.04, hindUpper: 0.11, hindLower: 0.045, paw: 0.038 },
    neck: { from: [0, 1.04, 0.5], to: [0, 1.42, 0.84], r0: 0.11, r1: 0.075 },
    head: { center: [0, 1.47, 0.96], radii: [0.07, 0.08, 0.17], pitch: 0.55 },
    muzzle: { center: [0, 1.37, 1.08], radii: [0.045, 0.05, 0.08] },
    ear: { offset: [0.07, 1.58, 0.9], radii: [0.03, 0.07, 0.015] },
    coat: () => {
      const back = srgb(0xa8622f);
      const flank = srgb(0xcb8d54);
      const belly = srgb(0xf2ebe0);
      const black = srgb(0x1d1612);
      return (n, p) => {
        tmp.copy(back).lerp(flank, smoothstep(0.5, 0.0, n.y)).lerp(belly, smoothstep(-0.25, -0.6, n.y));
        // Franjas negras en la grupa ("M" del impala).
        if (p.z < -0.8 && Math.abs(Math.abs(p.x) - 0.08) < 0.025 && p.y > 0.8) tmp.copy(black);
        return tmp;
      };
    },
    extras: (parts, coat, seed) => {
      // Cola corta y cuernos en lira (solo machos: la mitad de la manada).
      parts.push(...limb(JOINTS.tail1, [0, 0.88, -1.08], 0.03, 0.025, 'tail1', coat));
      if (seed % 2 === 0) {
        const c = srgb(0x2b231c);
        for (const s of [1, -1]) {
          horn(parts, [[0.04 * s, 1.56, 0.86], [0.08 * s, 1.72, 0.8], [0.06 * s, 1.86, 0.84], [0.09 * s, 1.98, 0.8]], 0.022, c);
        }
      }
    },
  },
  zebra: {
    torso: [
      [-1.0, 0.07, 0.08, 1.0],
      [-0.9, 0.18, 0.22, 1.0],
      [-0.64, 0.24, 0.3, 1.0],
      [-0.3, 0.23, 0.29, 0.98],
      [0.0, 0.24, 0.3, 0.98],
      [0.25, 0.24, 0.31, 1.0],
      [0.45, 0.21, 0.29, 1.03],
      [0.6, 0.15, 0.2, 1.08],
    ],
    legs: { frontUpper: 0.1, frontLower: 0.055, hindUpper: 0.14, hindLower: 0.06, paw: 0.05 },
    neck: { from: [0, 1.04, 0.5], to: [0, 1.36, 0.84], r0: 0.16, r1: 0.11 },
    head: { center: [0, 1.38, 1.0], radii: [0.08, 0.1, 0.24], pitch: 0.75 },
    muzzle: { center: [0, 1.22, 1.15], radii: [0.065, 0.07, 0.08] },
    ear: { offset: [0.06, 1.55, 0.88], radii: [0.03, 0.08, 0.02] },
    coat: (seed) => {
      const white = srgb(0xf0ece0);
      const black = srgb(0x1a1716);
      const phase = seed * 0.7;
      return (_n, p) => {
        // Rayas verticales en el cuerpo y horizontales en las patas.
        const stripe = p.y < 0.65 ? Math.sin(p.y * 38 + phase) : Math.sin(p.z * 24 + p.y * 5 + phase);
        return stripe > 0.15 ? black : white;
      };
    },
    extras: (parts, coat) => {
      // Crin erguida y cola con borla negra.
      parts.push(ellipsoid([0, 1.36, 0.66], [0.03, 0.1, 0.24], 'neck', coat, 1, -0.8));
      parts.push(...limb(JOINTS.tail1, JOINTS.tail2, 0.035, 0.025, 'tail1', coat));
      parts.push(ellipsoid([0, 0.78, -1.17], [0.04, 0.1, 0.04], 'tail2', srgb(0x1a1716), 1));
    },
  },
  wildebeest: {
    torso: [
      [-0.95, 0.07, 0.08, 0.95],
      [-0.85, 0.18, 0.22, 0.95],
      [-0.62, 0.22, 0.27, 0.96],
      [-0.3, 0.22, 0.28, 0.97],
      [0.0, 0.24, 0.31, 1.0],
      [0.25, 0.26, 0.35, 1.04],
      [0.45, 0.24, 0.34, 1.08],
      [0.6, 0.17, 0.24, 1.12],
    ],
    legs: { frontUpper: 0.1, frontLower: 0.05, hindUpper: 0.12, hindLower: 0.05, paw: 0.045 },
    neck: { from: [0, 1.1, 0.5], to: [0, 1.32, 0.84], r0: 0.17, r1: 0.12 },
    head: { center: [0, 1.32, 1.0], radii: [0.09, 0.11, 0.24], pitch: 0.95 },
    muzzle: { center: [0, 1.12, 1.12], radii: [0.08, 0.07, 0.08] },
    ear: { offset: [0.09, 1.45, 0.9], radii: [0.04, 0.05, 0.015] },
    coat: () => {
      const grey = srgb(0x66646a);
      const dark = srgb(0x3a383c);
      return (n, p) => {
        tmp.copy(grey).lerp(dark, smoothstep(-0.2, -0.7, n.y) * 0.6);
        if (Math.sin(p.z * 15) > 0.6 && p.y > 0.7 && p.z > -0.5) tmp.lerp(dark, 0.6);
        return tmp;
      };
    },
    extras: (parts) => {
      const black = srgb(0x1c1a1b);
      // Crin negra, barba y cuernos curvos.
      parts.push(ellipsoid([0, 1.36, 0.66], [0.04, 0.12, 0.25], 'neck', black, 1, -0.7));
      parts.push(ellipsoid([0, 1.0, 0.8], [0.05, 0.16, 0.08], 'neck', black, 1, 0.3));
      parts.push(...limb(JOINTS.tail1, JOINTS.tail2, 0.035, 0.03, 'tail1', black));
      parts.push(ellipsoid([0, 0.75, -1.17], [0.05, 0.14, 0.05], 'tail2', black, 1));
      const c = srgb(0x2a2726);
      for (const s of [1, -1]) {
        horn(parts, [[0.06 * s, 1.47, 0.9], [0.18 * s, 1.47, 0.9], [0.22 * s, 1.58, 0.92], [0.16 * s, 1.64, 0.96]], 0.03, c);
      }
    },
  },
  warthog: {
    torso: [
      [-0.95, 0.06, 0.07, 0.9],
      [-0.85, 0.2, 0.24, 0.9],
      [-0.6, 0.24, 0.3, 0.92],
      [-0.3, 0.25, 0.32, 0.93],
      [0.0, 0.27, 0.34, 0.95],
      [0.25, 0.27, 0.36, 0.98],
      [0.45, 0.24, 0.32, 1.0],
      [0.62, 0.17, 0.22, 1.04],
    ],
    legs: { frontUpper: 0.1, frontLower: 0.06, hindUpper: 0.12, hindLower: 0.06, paw: 0.05 },
    neck: { from: [0, 1.0, 0.5], to: [0, 1.08, 0.82], r0: 0.2, r1: 0.18 },
    head: { center: [0, 1.04, 1.02], radii: [0.17, 0.15, 0.26], pitch: 0.55 },
    muzzle: { center: [0, 0.9, 1.22], radii: [0.09, 0.07, 0.06] },
    ear: { offset: [0.12, 1.2, 0.9], radii: [0.04, 0.06, 0.015] },
    coat: () => {
      const grey = srgb(0x6e655c);
      return (n) => tmp.copy(grey).multiplyScalar(0.85 + 0.2 * n.y);
    },
    extras: (parts) => {
      const ivory = srgb(0xe9e0cc);
      const dark = srgb(0x2d2622);
      // Crin dorsal, colmillos curvados y cola fina erguida.
      parts.push(ellipsoid([0, 1.3, 0.1], [0.03, 0.08, 0.55], 'spine', dark, 1));
      for (const s of [1, -1]) {
        horn(parts, [[0.08 * s, 0.92, 1.18], [0.14 * s, 0.98, 1.22], [0.13 * s, 1.06, 1.2]], 0.02, ivory);
      }
      parts.push(...limb(JOINTS.tail1, [0, 1.2, -1.12], 0.02, 0.015, 'tail1', dark));
    },
  },
};

/** Variantes de geometría por especie (cuernos, patrón de rayas); se comparten entre individuos. */
const VARIANTS = 4;
const geometryCache = new Map<string, THREE.BufferGeometry>();

export function preyGeometry(species: PreySpecies, seed: number): THREE.BufferGeometry {
  const variant = seed % VARIANTS;
  const key = `${species}-${variant}`;
  let g = geometryCache.get(key);
  if (!g) {
    g = buildPreyGeometry(species, variant);
    geometryCache.set(key, g);
  }
  return g;
}

/** Ungulado placeholder con el esqueleto estándar (las animaciones del león le sirven). */
export function createPreyMesh(species: PreySpecies, material: THREE.Material, seed: number) {
  return skinnedMeshFromGeometry(preyGeometry(species, seed), material, species);
}

function buildPreyGeometry(species: PreySpecies, seed: number): THREE.BufferGeometry {
  const def = DEFS[species];
  const coat = def.coat(seed);
  const legCoat = withHooves(coat);
  const parts: THREE.BufferGeometry[] = [];
  parts.push(torsoLoft(def.torso, coat, species === 'zebra' ? 0.035 : 0.08));
  parts.push(...limb(def.neck.from, def.neck.to, def.neck.r0, def.neck.r1, 'neck', coat, species === 'zebra' ? 10 : 1));
  parts.push(ellipsoid(def.head.center, def.head.radii, 'head', coat, 2, def.head.pitch));
  parts.push(ellipsoid(def.muzzle.center, def.muzzle.radii, 'head', srgb(0x231c18), 1));
  parts.push(ellipsoid(def.muzzle.center, [def.muzzle.radii[0] * 0.9, def.muzzle.radii[1] * 0.5, def.muzzle.radii[2]], 'jaw', srgb(0x231c18), 1));
  for (const s of [1, -1]) {
    const [ex, ey, ez] = def.ear.offset;
    parts.push(ellipsoid([ex * s, ey, ez], def.ear.radii, 'head', coat, 1, -0.3));
    const [, hy, hz] = def.head.center;
    parts.push(ellipsoid([def.head.radii[0] * 0.85 * s, hy + 0.04, hz - 0.02], [0.018, 0.018, 0.012], 'head', srgb(0x0d0a08), 1));
  }
  parts.push(...standardLegs(legCoat, def.legs, species === 'zebra' ? 10 : 2));
  def.extras(parts, coat, seed);
  return mergeParts(parts);
}
