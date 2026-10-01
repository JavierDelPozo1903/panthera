/**
 * Esqueleto estándar de PANTHERA para cuadrúpedos (león, hiena y, más adelante, leopardo).
 *
 * CONTRATO DE SUSTITUCIÓN: un modelo .glb real (CC0/CC-BY) puede reemplazar los placeholders
 * procedurales si su rig usa estos nombres de hueso (o se remapean) y el modelo mira hacia +Z
 * con Y arriba. Las animaciones se referencian por nombre de hueso, así que los clips de
 * lionAnimations.ts funcionan con cualquier malla que respete el contrato.
 */
export const QUAD_BONES = [
  'root',
  'hips',
  'spine',
  'chest',
  'neck',
  'head',
  'jaw',
  'tail1',
  'tail2',
  'tail3',
  'tail4',
  'FL_upper',
  'FL_lower',
  'FL_paw',
  'FR_upper',
  'FR_lower',
  'FR_paw',
  'BL_upper',
  'BL_lower',
  'BL_paw',
  'BR_upper',
  'BR_lower',
  'BR_paw',
] as const;

export type QuadBone = (typeof QUAD_BONES)[number];
export type V3 = readonly [number, number, number];

/** Posición de cada articulación en pose de reposo (espacio del modelo, león adulto, metros). */
export const JOINTS: Record<QuadBone, V3> = {
  root: [0, 0, 0],
  hips: [0, 0.98, -0.62],
  spine: [0, 1.0, -0.15],
  chest: [0, 1.0, 0.32],
  neck: [0, 1.08, 0.6],
  head: [0, 1.3, 0.9],
  jaw: [0, 1.24, 0.98],
  tail1: [0, 1.0, -0.9],
  tail2: [0, 0.84, -1.14],
  tail3: [0, 0.64, -1.32],
  tail4: [0, 0.48, -1.5],
  FL_upper: [0.19, 0.92, 0.42],
  FL_lower: [0.19, 0.56, 0.34],
  FL_paw: [0.19, 0.14, 0.4],
  FR_upper: [-0.19, 0.92, 0.42],
  FR_lower: [-0.19, 0.56, 0.34],
  FR_paw: [-0.19, 0.14, 0.4],
  BL_upper: [0.18, 0.92, -0.66],
  BL_lower: [0.18, 0.58, -0.5],
  BL_paw: [0.18, 0.3, -0.8],
  BR_upper: [-0.18, 0.92, -0.66],
  BR_lower: [-0.18, 0.58, -0.5],
  BR_paw: [-0.18, 0.3, -0.8],
};

export const PARENTS: Record<QuadBone, QuadBone | null> = {
  root: null,
  hips: 'root',
  spine: 'hips',
  chest: 'spine',
  neck: 'chest',
  head: 'neck',
  jaw: 'head',
  tail1: 'hips',
  tail2: 'tail1',
  tail3: 'tail2',
  tail4: 'tail3',
  FL_upper: 'chest',
  FL_lower: 'FL_upper',
  FL_paw: 'FL_lower',
  FR_upper: 'chest',
  FR_lower: 'FR_upper',
  FR_paw: 'FR_lower',
  BL_upper: 'hips',
  BL_lower: 'BL_upper',
  BL_paw: 'BL_lower',
  BR_upper: 'hips',
  BR_lower: 'BR_upper',
  BR_paw: 'BR_lower',
};

export const boneIndex = (bone: QuadBone): number => QUAD_BONES.indexOf(bone);
