import * as THREE from 'three';
import lionData from '../../data/lion.json';
import { clamp, lerp, mulberry32, smoothstep } from '../../core/math';
import {
  assembleSkinnedMesh,
  ellipsoid,
  limb,
  srgb,
  standardLegs,
  torsoLoft,
  type ColorFn,
  type TorsoSection,
} from '../animal/rigBuilder';
import { JOINTS, type QuadBone, type V3 } from '../animal/skeleton';

// Compatibilidad: el león usa el esqueleto estándar de cuadrúpedo.
export { JOINTS, QUAD_BONES as LION_BONES, PARENTS } from '../animal/skeleton';
export type { V3 } from '../animal/skeleton';
export type LionBone = QuadBone;

export type Sex = 'male' | 'female';

export interface LionAppearance {
  sex: Sex;
  ageYears: number;
  /** Oscuridad de la melena [0, 1]: depende de salud y testosterona. */
  maneDarkness: number;
  /** Tono base del pelaje (herencia genética en la Fase 4). */
  furTint?: number;
  /** Variante de pelaje: el león blanco de Timbavati. */
  coat?: 'normal' | 'white';
  /** Rosetas de leopardo (para El Fantasma). */
  pattern?: 'rosettes';
}

/** Escala global del modelo según sexo y edad. */
export function lionScale(app: LionAppearance): number {
  const adult = app.sex === 'male' ? lionData.bodySize.maleScale : lionData.bodySize.femaleScale;
  const growth = smoothstep(0, 4.5, app.ageYears);
  return lerp(lionData.bodySize.cubScale, adult, Math.pow(growth, 0.7));
}

/** Desarrollo de la melena [0, 1]: comienza hacia el año y se completa hacia los 5. */
export function maneGrowth(app: LionAppearance): number {
  if (app.sex !== 'male') return 0;
  const { start, full } = lionData.maturity.maneGrowthYears;
  return smoothstep(start, full, app.ageYears);
}

const TORSO_PROFILE: TorsoSection[] = [
  [-1.0, 0.07, 0.08, 0.95],
  [-0.94, 0.16, 0.19, 0.95],
  [-0.84, 0.21, 0.25, 0.95],
  [-0.66, 0.235, 0.275, 0.95],
  [-0.46, 0.225, 0.255, 0.93],
  [-0.26, 0.215, 0.245, 0.91],
  [-0.04, 0.23, 0.27, 0.91],
  [0.18, 0.255, 0.315, 0.92],
  [0.38, 0.25, 0.32, 0.94],
  [0.54, 0.2, 0.25, 0.99],
  [0.64, 0.15, 0.18, 1.04],
];

/**
 * Crea el león placeholder estilizado (low-poly, sombreado suave) con su esqueleto.
 * Proporciones: cachorros con cabeza y patas relativamente grandes; los machos con melena
 * progresiva cuya oscuridad depende de `maneDarkness`.
 */
export function createLionMesh(app: LionAppearance, material: THREE.Material) {
  const youth = 1 - smoothstep(0, 3, app.ageYears);
  const mane = maneGrowth(app);
  const rng = mulberry32(Math.round(app.ageYears * 100) + (app.sex === 'male' ? 7 : 3));

  // Paleta
  const tint = app.furTint ?? 0;
  const white = app.coat === 'white';
  const rosettes = app.pattern === 'rosettes';
  const fur = srgb(rosettes ? 0xd9a24a : white ? 0xeee4cf : app.sex === 'male' ? 0xcfa56b : 0xd8b47e).offsetHSL(tint * 0.02, 0, tint * 0.04);
  const rosette = srgb(0x2a1a10);
  const belly = srgb(0xf1e4c4);
  const dark = srgb(0x2b1d15);
  const nose = srgb(0x4a2c26);
  const eye = srgb(0xc8902c);
  const maneColor = white ? srgb(0xe8d9bb).lerp(srgb(0xb59a6e), clamp(app.maneDarkness, 0, 1)) : srgb(0xb4803f).lerp(srgb(0x24170f), clamp(app.maneDarkness, 0, 1));
  const spot = srgb(0x8f6c44);

  const tmpC = new THREE.Color();
  /** Pelaje con vientre claro y, en cachorros, manchas. */
  const furShade: ColorFn = (n, p) => {
    tmpC.copy(fur).lerp(belly, smoothstep(-0.15, -0.75, n.y));
    if (youth > 0.2) {
      const s = Math.sin(p.x * 41 + p.z * 23) * Math.sin(p.z * 37 - p.y * 29);
      if (s > 0.55) tmpC.lerp(spot, 0.55 * youth);
    }
    if (rosettes && n.y > -0.5) {
      // Anillos oscuros: un patrón de manchas con el centro algo más claro.
      const r = Math.sin(p.x * 52 + p.z * 31) * Math.sin(p.z * 47 - p.y * 43 + p.x * 9);
      if (r > 0.42 && r < 0.78) tmpC.lerp(rosette, 0.85);
    }
    return tmpC;
  };
  const maneShade: ColorFn = (n) => {
    const k = 0.82 + 0.3 * rng();
    tmpC.copy(maneColor).multiplyScalar(k).lerp(fur, smoothstep(0.1, -0.6, n.y) * 0.25);
    return tmpC;
  };
  const tuftColor = srgb(0x2e1f15).lerp(maneColor, 0.3);

  const headScale = 1 + 0.35 * youth;
  const H = (v: V3): V3 => {
    // Escala la cabeza alrededor de la articulación cuello-cabeza.
    const j = JOINTS.head;
    return [j[0] + (v[0] - j[0]) * headScale, j[1] + (v[1] - j[1]) * headScale, j[2] + (v[2] - j[2]) * headScale];
  };
  const hs = (r: V3): V3 => [r[0] * headScale, r[1] * headScale, r[2] * headScale];

  const parts: THREE.BufferGeometry[] = [];

  // Tronco: torso continuo con piel ponderada + masas de hombro y muslo.
  parts.push(torsoLoft(TORSO_PROFILE, furShade));
  for (const side of [1, -1]) {
    parts.push(ellipsoid([0.15 * side, 0.9, 0.38], [0.11, 0.2, 0.15], 'chest', furShade, 1));
    parts.push(ellipsoid([0.15 * side, 0.9, -0.66], [0.11, 0.2, 0.19], 'hips', furShade, 1));
  }
  parts.push(...limb([0, 1.0, 0.52], [0, 1.26, 0.86], 0.17, 0.15, 'neck', furShade));

  // Cabeza
  parts.push(ellipsoid(H([0, 1.33, 0.97]), hs([0.15, 0.15, 0.17]), 'head', furShade));
  parts.push(ellipsoid(H([0, 1.28, 1.12]), hs([0.1, 0.085, 0.12]), 'head', furShade, 2, -0.1));
  parts.push(ellipsoid(H([0, 1.3, 1.235]), hs([0.045, 0.032, 0.025]), 'head', nose, 1));
  parts.push(ellipsoid(H([0, 1.2, 1.09]), hs([0.075, 0.04, 0.11]), 'jaw', furShade, 1));
  for (const side of [1, -1]) {
    parts.push(ellipsoid(H([0.1 * side, 1.46, 0.93]), hs([0.05, 0.055, 0.022]), 'head', furShade, 1));
    parts.push(ellipsoid(H([0.1 * side, 1.465, 0.915]), hs([0.032, 0.035, 0.012]), 'head', dark, 1));
    parts.push(ellipsoid(H([0.075 * side, 1.37, 1.1]), hs([0.022, 0.018, 0.012]), 'head', eye, 1));
  }

  // Melena (solo machos, crece con la edad)
  if (mane > 0.02) {
    const m = 0.35 + 0.65 * mane;
    parts.push(ellipsoid([0, 1.17, 0.7], [0.29 * m + 0.05, 0.36 * m + 0.05, 0.3 * m + 0.04], 'neck', maneShade, 2, 0.5));
    parts.push(ellipsoid([0, 0.9, 0.52], [0.25 * m, 0.33 * m, 0.22 * m], 'chest', maneShade, 2));
    parts.push(ellipsoid(H([0, 1.36, 0.87]), [0.25 * m, 0.28 * m, 0.16 * m], 'head', maneShade, 2, 0.2));
  }

  // Patas (más gruesas en proporción en los cachorros)
  const legScale = 1 + 0.15 * youth;
  parts.push(
    ...standardLegs(furShade, {
      frontUpper: 0.11 * legScale,
      frontLower: 0.075 * legScale,
      hindUpper: 0.16 * legScale,
      hindLower: 0.085 * legScale,
      paw: 0.075 * legScale,
    }),
  );

  // Cola con borla oscura
  const tailR = 0.05 * (1 - 0.3 * youth);
  parts.push(...limb(JOINTS.tail1, JOINTS.tail2, tailR, tailR * 0.85, 'tail1', fur));
  parts.push(...limb(JOINTS.tail2, JOINTS.tail3, tailR * 0.85, tailR * 0.72, 'tail2', fur));
  parts.push(...limb(JOINTS.tail3, JOINTS.tail4, tailR * 0.72, tailR * 0.62, 'tail3', fur));
  parts.push(...limb(JOINTS.tail4, [0, 0.4, -1.6], tailR * 0.62, tailR * 0.55, 'tail4', fur));
  if (app.ageYears > 0.4) parts.push(ellipsoid([0, 0.37, -1.66], [0.055, 0.075, 0.1], 'tail4', tuftColor, 1, 0.7));

  return assembleSkinnedMesh(parts, material, 'lion');
}
