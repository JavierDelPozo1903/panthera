import * as THREE from 'three';
import {
  ellipsoid,
  limb,
  mergeParts,
  skinnedMeshFromGeometry,
  srgb,
  standardLegs,
  torsoLoft,
  type ColorFn,
  type TorsoSection,
} from '../animal/rigBuilder';
import { JOINTS } from '../animal/skeleton';

/**
 * Cocodrilo placeholder sobre el esqueleto estándar de cuadrúpedo. Se dibuja a altura de
 * león y el actor lo aplasta en vertical: así reutiliza los mismos huesos y animaciones.
 */
const TORSO: TorsoSection[] = [
  [-0.95, 0.12, 0.1, 0.93],
  [-0.8, 0.24, 0.17, 0.94],
  [-0.5, 0.33, 0.21, 0.95],
  [-0.15, 0.36, 0.22, 0.96],
  [0.2, 0.34, 0.21, 0.97],
  [0.45, 0.27, 0.18, 1.0],
  [0.62, 0.19, 0.14, 1.05],
];

let cached: THREE.BufferGeometry | null = null;

export function crocGeometry(): THREE.BufferGeometry {
  if (cached) return cached;
  const back = srgb(0x3b4430);
  const belly = srgb(0xb9b080);
  const scute = srgb(0x262c1e);
  const tmp = new THREE.Color();
  const skin: ColorFn = (n, p) => {
    tmp.copy(back).lerp(belly, Math.min(1, Math.max(0, (-n.y - 0.15) * 1.6)));
    // Escudos dorsales en bandas.
    if (n.y > 0.4 && Math.sin(p.z * 38) > 0.5) tmp.lerp(scute, 0.6);
    return tmp;
  };
  const parts: THREE.BufferGeometry[] = [];
  parts.push(torsoLoft(TORSO, skin, 0.06));
  // Cabeza: hocico largo y plano con mandíbula.
  parts.push(...limb(JOINTS.neck, JOINTS.head, 0.2, 0.16, 'neck', skin));
  parts.push(ellipsoid([0, 1.18, 1.25], [0.17, 0.1, 0.48], 'head', skin, 2));
  parts.push(ellipsoid([0, 1.1, 1.22], [0.15, 0.06, 0.45], 'jaw', skin, 2));
  for (const s of [1, -1]) {
    parts.push(ellipsoid([0.09 * s, 1.28, 0.92], [0.05, 0.05, 0.06], 'head', srgb(0x6b6a3a), 1));
    // Dientes que asoman.
    for (let i = 0; i < 4; i++) parts.push(ellipsoid([0.13 * s, 1.12, 1.05 + i * 0.13], [0.015, 0.03, 0.015], 'head', srgb(0xe8e0c8), 0));
  }
  // Cola larga y musculosa.
  parts.push(...limb(JOINTS.hips, JOINTS.tail1, 0.24, 0.2, 'tail1', skin));
  parts.push(...limb(JOINTS.tail1, JOINTS.tail2, 0.2, 0.16, 'tail2', skin));
  parts.push(...limb(JOINTS.tail2, JOINTS.tail3, 0.16, 0.11, 'tail3', skin));
  parts.push(...limb(JOINTS.tail3, JOINTS.tail4, 0.11, 0.07, 'tail4', skin));
  parts.push(...limb(JOINTS.tail4, [0, 0.42, -1.95], 0.07, 0.02, 'tail4', skin));
  parts.push(...standardLegs(skin, { frontUpper: 0.11, frontLower: 0.09, hindUpper: 0.14, hindLower: 0.1, paw: 0.1 }));
  cached = mergeParts(parts);
  return cached;
}

export function createCrocMesh(material: THREE.Material) {
  return skinnedMeshFromGeometry(crocGeometry(), material, 'crocodile');
}
