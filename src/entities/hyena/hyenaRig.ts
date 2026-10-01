import * as THREE from 'three';
import { smoothstep } from '../../core/math';
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
import { JOINTS } from '../animal/skeleton';

/** Escala respecto al león adulto: la hiena manchada mide ~0,8 m a la cruz. */
export const HYENA_SCALE = 0.66;

/** Lomo inclinado: cruz alta y grupa baja, rasgo inconfundible de la hiena manchada. */
const TORSO_PROFILE: TorsoSection[] = [
  [-0.95, 0.07, 0.07, 0.86],
  [-0.88, 0.15, 0.17, 0.86],
  [-0.74, 0.19, 0.22, 0.87],
  [-0.55, 0.19, 0.23, 0.88],
  [-0.3, 0.19, 0.24, 0.9],
  [-0.05, 0.21, 0.27, 0.94],
  [0.18, 0.23, 0.31, 0.99],
  [0.38, 0.22, 0.31, 1.03],
  [0.54, 0.18, 0.25, 1.08],
  [0.64, 0.14, 0.19, 1.12],
];

/** Hiena manchada (Crocuta crocuta) placeholder con el esqueleto estándar de cuadrúpedo. */
export function createHyenaMesh(material: THREE.Material, seed: number) {
  const base = srgb(0xb39a72).offsetHSL(((seed * 37) % 10) * 0.002 - 0.01, 0, ((seed * 13) % 10) * 0.01 - 0.05);
  const belly = srgb(0xcdb994);
  const spot = srgb(0x4a3526);
  const muzzle = srgb(0x33251c);
  const tmp = new THREE.Color();
  const phase = seed * 1.7;

  const coat: ColorFn = (n, p) => {
    tmp.copy(base).lerp(belly, smoothstep(-0.2, -0.8, n.y));
    const s = Math.sin(p.x * 31 + phase) * Math.sin(p.z * 27 - p.y * 19 + phase);
    if (s > 0.45 && p.y > 0.2) tmp.lerp(spot, 0.75);
    return tmp;
  };
  const dark: ColorFn = () => muzzle;

  const parts: THREE.BufferGeometry[] = [];
  parts.push(torsoLoft(TORSO_PROFILE, coat));
  for (const side of [1, -1]) {
    parts.push(ellipsoid([0.14 * side, 0.95, 0.38], [0.1, 0.2, 0.15], 'chest', coat, 1));
    parts.push(ellipsoid([0.13 * side, 0.84, -0.66], [0.09, 0.17, 0.16], 'hips', coat, 1));
  }
  // Cuello grueso con crin corta y oscura.
  parts.push(...limb([0, 1.06, 0.5], [0, 1.24, 0.86], 0.18, 0.15, 'neck', coat));
  parts.push(ellipsoid([0, 1.28, 0.62], [0.05, 0.1, 0.22], 'neck', dark, 1, -0.6));

  // Cabeza ancha, hocico romo y oscuro, orejas redondeadas.
  parts.push(ellipsoid([0, 1.31, 0.98], [0.15, 0.15, 0.17], 'head', coat));
  parts.push(ellipsoid([0, 1.25, 1.13], [0.085, 0.085, 0.13], 'head', dark, 2, -0.15));
  parts.push(ellipsoid([0, 1.28, 1.25], [0.04, 0.03, 0.025], 'head', srgb(0x111111), 1));
  parts.push(ellipsoid([0, 1.18, 1.08], [0.07, 0.04, 0.11], 'jaw', dark, 1));
  for (const side of [1, -1]) {
    parts.push(ellipsoid([0.11 * side, 1.47, 0.92], [0.065, 0.075, 0.025], 'head', coat, 1));
    parts.push(ellipsoid([0.07 * side, 1.36, 1.08], [0.02, 0.018, 0.012], 'head', srgb(0x1a120c), 1));
  }

  parts.push(
    ...standardLegs(coat, { frontUpper: 0.1, frontLower: 0.066, hindUpper: 0.13, hindLower: 0.07, paw: 0.065 }),
  );

  // Cola corta y peluda, casi negra en la punta.
  parts.push(...limb(JOINTS.tail1, JOINTS.tail2, 0.045, 0.04, 'tail1', coat));
  parts.push(ellipsoid([0, 0.72, -1.24], [0.07, 0.07, 0.16], 'tail2', dark, 1, 0.9));

  return assembleSkinnedMesh(parts, material, 'hyena');
}
