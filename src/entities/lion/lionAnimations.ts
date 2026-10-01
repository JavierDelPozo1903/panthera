import * as THREE from 'three';
import { fract, smoothstep } from '../../core/math';
import { JOINTS, QUAD_BONES as LION_BONES, type QuadBone as LionBone, type V3 } from '../animal/skeleton';

/**
 * Animaciones procedurales del león: se generan como AnimationClip estándar (pistas de
 * cuaternión por hueso) a partir de funciones de pose con cinemática inversa de patas.
 * Al ser clips normales, el AnimationMixer los mezcla con fundidos suaves y podrán
 * sustituirse uno a uno por animaciones capturadas cuando haya un modelo definitivo.
 */

export type LionClipName =
  | 'idle'
  | 'walk'
  | 'trot'
  | 'run'
  | 'stalkIdle'
  | 'stalkWalk'
  | 'rest'
  | 'roar'
  | 'jump'
  | 'swim'
  | 'drink'
  | 'eat'
  | 'nurse'
  | 'die'
  | 'swipe'
  | 'bite'
  | 'snarl'
  | 'mark';

/** Velocidad (m/s) a la que cada clip de locomoción reproduce su zancada sin patinar. */
export const CLIP_NOMINAL_SPEED: Partial<Record<LionClipName, number>> = {
  walk: 1.2,
  trot: 3.6,
  run: 15,
  stalkWalk: 0.9,
  swim: 1.3,
};

type Rot = [number, number, number];

interface Pose {
  rot: Partial<Record<LionBone, Rot>>;
  /** Desplazamiento de la cadera (y, z) respecto a la pose de reposo. */
  hipsDy: number;
  hipsDz: number;
}

type LegName = 'FL' | 'FR' | 'BL' | 'BR';
const LEGS: LegName[] = ['FL', 'FR', 'BL', 'BR'];

interface LegTarget {
  /** Elevación del tobillo/muñeca sobre su altura de reposo (m). */
  dy: number;
  /** Avance del tobillo/muñeca respecto a su posición de reposo (m, +Z adelante). */
  dz: number;
  /** Inclinación absoluta de la mano/pie (rad, + = dedos hacia abajo). */
  pawPitch: number;
}

// --- Cinemática en el plano sagital (y, z) --------------------------------------------------

type P2 = [number, number];
const yz = (v: V3): P2 => [v[1], v[2]];
const sub = (a: P2, b: P2): P2 => [a[0] - b[0], a[1] - b[1]];
const add = (a: P2, b: P2): P2 => [a[0] + b[0], a[1] + b[1]];
/** Rotación alrededor del eje X aplicada a un vector (y, z). */
const rotX = (t: number, v: P2): P2 => [v[0] * Math.cos(t) - v[1] * Math.sin(t), v[0] * Math.sin(t) + v[1] * Math.cos(t)];
/** Ángulo de una dirección medido desde "abajo" hacia +Z. */
const angleFromDown = (d: P2) => Math.atan2(d[1], -d[0]);

interface LegDef {
  upper: LionBone;
  lower: LionBone;
  paw: LionBone;
  parent: 'hips' | 'chest';
  H: P2;
  A: P2;
  L1: number;
  L2: number;
  a1Rest: number;
  a2Rest: number;
  /** +1 si la articulación intermedia apunta hacia delante (rodilla), −1 hacia atrás (codo). */
  bend: 1 | -1;
}

const LEG_DEFS: Record<LegName, LegDef> = Object.fromEntries(
  LEGS.map((leg) => {
    const upper = `${leg}_upper` as LionBone;
    const lower = `${leg}_lower` as LionBone;
    const paw = `${leg}_paw` as LionBone;
    const H = yz(JOINTS[upper]);
    const K = yz(JOINTS[lower]);
    const A = yz(JOINTS[paw]);
    const d1 = sub(K, H);
    const d2 = sub(A, K);
    const hA = sub(A, H);
    // Signo de la rodilla respecto a la recta cadera→tobillo.
    const cross = hA[0] * d1[1] - hA[1] * d1[0];
    const def: LegDef = {
      upper,
      lower,
      paw,
      parent: leg.startsWith('F') ? 'chest' : 'hips',
      H,
      A,
      L1: Math.hypot(d1[0], d1[1]),
      L2: Math.hypot(d2[0], d2[1]),
      a1Rest: angleFromDown(d1),
      a2Rest: angleFromDown(d2),
      bend: cross < 0 ? 1 : -1,
    };
    return [leg, def];
  }),
) as Record<LegName, LegDef>;

const rx = (pose: Pose, bone: LionBone) => pose.rot[bone]?.[0] ?? 0;

/** Resuelve la IK de dos segmentos de cada pata para situar su tobillo en el objetivo. */
function solveLegs(pose: Pose, targets: Record<LegName, LegTarget>): void {
  const rh = rx(pose, 'hips');
  const rs = rh + rx(pose, 'spine');
  const rc = rs + rx(pose, 'chest');
  const hipsP: P2 = [JOINTS.hips[1] + pose.hipsDy, JOINTS.hips[2] + pose.hipsDz];
  const spineP = add(hipsP, rotX(rh, sub(yz(JOINTS.spine), yz(JOINTS.hips))));
  const chestP = add(spineP, rotX(rs, sub(yz(JOINTS.chest), yz(JOINTS.spine))));

  for (const leg of LEGS) {
    const def = LEG_DEFS[leg];
    const t = targets[leg];
    const [parentP, parentR] = def.parent === 'hips' ? [hipsP, rh] : [chestP, rc];
    const H = add(parentP, rotX(parentR, sub(def.H, yz(JOINTS[def.parent]))));
    const T: P2 = [def.A[0] + t.dy, def.A[1] + t.dz];
    const ht = sub(T, H);
    const d = Math.min(Math.max(Math.hypot(ht[0], ht[1]), Math.abs(def.L1 - def.L2) + 1e-3), def.L1 + def.L2 - 1e-3);
    const base = angleFromDown(ht);
    const cosB = (def.L1 * def.L1 + d * d - def.L2 * def.L2) / (2 * def.L1 * d);
    const beta = Math.acos(Math.min(1, Math.max(-1, cosB)));
    const a1 = base + def.bend * beta;
    const K: P2 = [H[0] - def.L1 * Math.cos(a1), H[1] + def.L1 * Math.sin(a1)];
    const a2 = angleFromDown(sub(T, K));

    const upperAbs = -(a1 - def.a1Rest);
    const lowerAbs = -(a2 - def.a2Rest);
    pose.rot[def.upper] = [upperAbs - parentR, 0, 0];
    pose.rot[def.lower] = [lowerAbs - upperAbs, 0, 0];
    pose.rot[def.paw] = [t.pawPitch - lowerAbs, 0, 0];
  }
}

const planted = (): Record<LegName, LegTarget> => ({
  FL: { dy: 0, dz: 0, pawPitch: 0 },
  FR: { dy: 0, dz: 0, pawPitch: 0 },
  BL: { dy: 0, dz: 0, pawPitch: 0 },
  BR: { dy: 0, dz: 0, pawPitch: 0 },
});

function tail(pose: Pose, base: number, sway: number, phase: number, curl = 0.12): void {
  const bones: LionBone[] = ['tail1', 'tail2', 'tail3', 'tail4'];
  bones.forEach((b, i) => {
    pose.rot[b] = [i === 0 ? base : curl * (i === 3 ? 1.6 : 1), Math.sin(phase - i * 0.7) * sway * (1 + i * 0.25), 0];
  });
}

// --- Marchas ----------------------------------------------------------------------------

interface GaitConfig {
  duty: number;
  stride: number;
  lift: number;
  phase: Record<LegName, number>;
  bodyDy: number;
  bob: number;
  bobCycles: number;
  pitchAmp: number;
  spineFlex: number;
  sway: number;
  neckPitch: number;
  headPitch: number;
  tailBase: number;
  tailSway: number;
}

function gaitPose(p: number, c: GaitConfig): Pose {
  const TAU = Math.PI * 2;
  const pose: Pose = { rot: {}, hipsDy: 0, hipsDz: 0 };
  pose.hipsDy = c.bodyDy + c.bob * Math.sin(p * TAU * c.bobCycles);

  const pitch = c.pitchAmp * Math.sin(p * TAU + 0.6);
  const flex = c.spineFlex * Math.sin(p * TAU);
  pose.rot.hips = [pitch - flex * 0.5, c.sway * Math.sin(p * TAU), c.sway * 0.5 * Math.sin(p * TAU)];
  pose.rot.spine = [flex, -c.sway * 0.6 * Math.sin(p * TAU), 0];
  pose.rot.chest = [flex * 0.5, -c.sway * 0.6 * Math.sin(p * TAU), -c.sway * 0.5 * Math.sin(p * TAU)];
  // El cuello compensa el cabeceo del cuerpo para estabilizar la mirada.
  const bodyPitch = pitch + flex;
  pose.rot.neck = [c.neckPitch - bodyPitch * 0.6, c.sway * 0.8 * Math.sin(p * TAU), 0];
  pose.rot.head = [c.headPitch - bodyPitch * 0.3 + c.bob * 1.5 * Math.sin(p * TAU * c.bobCycles + 1), 0, 0];
  pose.rot.jaw = [0, 0, 0];

  const targets = planted();
  for (const leg of LEGS) {
    const lp = fract(p + c.phase[leg]);
    const t = targets[leg];
    if (lp < c.duty) {
      const u = lp / c.duty;
      t.dz = c.stride * (0.5 - u);
      t.dy = 0;
      t.pawPitch = 0;
    } else {
      const u = (lp - c.duty) / (1 - c.duty);
      const e = u * u * (3 - 2 * u);
      t.dz = c.stride * (e - 0.5);
      t.dy = c.lift * Math.sin(Math.PI * u) * (leg.startsWith('F') ? 1 : 0.85);
      t.pawPitch = 0.9 * Math.sin(Math.PI * Math.min(1, u * 1.3));
    }
  }
  solveLegs(pose, targets);
  tail(pose, c.tailBase, c.tailSway, p * TAU);
  return pose;
}

const WALK: GaitConfig = {
  duty: 0.62,
  stride: 0.8,
  lift: 0.11,
  phase: { BL: 0, FL: 0.25, BR: 0.5, FR: 0.75 },
  bodyDy: -0.02,
  bob: 0.012,
  bobCycles: 2,
  pitchAmp: 0.015,
  spineFlex: 0,
  sway: 0.05,
  neckPitch: 0.14,
  headPitch: -0.1,
  tailBase: -0.05,
  tailSway: 0.18,
};

const TROT: GaitConfig = {
  duty: 0.48,
  stride: 0.95,
  lift: 0.17,
  phase: { BL: 0, FR: 0, BR: 0.5, FL: 0.5 },
  bodyDy: -0.03,
  bob: 0.025,
  bobCycles: 2,
  pitchAmp: 0.02,
  spineFlex: 0.02,
  sway: 0.03,
  neckPitch: 0.1,
  headPitch: -0.06,
  tailBase: 0.05,
  tailSway: 0.12,
};

const RUN: GaitConfig = {
  duty: 0.34,
  stride: 1.05,
  lift: 0.3,
  phase: { BL: 0, BR: 0.1, FR: 0.5, FL: 0.6 },
  bodyDy: -0.07,
  bob: 0.06,
  bobCycles: 1,
  pitchAmp: 0.1,
  spineFlex: 0.16,
  sway: 0.0,
  neckPitch: 0.28,
  headPitch: -0.22,
  tailBase: 0.32,
  tailSway: 0.08,
};

const STALK: GaitConfig = {
  duty: 0.72,
  stride: 0.52,
  lift: 0.07,
  phase: { BL: 0, FL: 0.25, BR: 0.5, FR: 0.75 },
  bodyDy: -0.3,
  bob: 0.004,
  bobCycles: 2,
  pitchAmp: 0,
  spineFlex: 0,
  sway: 0.035,
  neckPitch: 0.5,
  headPitch: -0.42,
  tailBase: -0.2,
  tailSway: 0.05,
};

const SWIM: GaitConfig = {
  duty: 0.5,
  stride: 0.55,
  lift: 0.18,
  phase: { BL: 0, FR: 0, BR: 0.5, FL: 0.5 },
  bodyDy: 0,
  bob: 0.02,
  bobCycles: 2,
  pitchAmp: 0,
  spineFlex: 0,
  sway: 0.02,
  neckPitch: -0.25,
  headPitch: 0.2,
  tailBase: 0.12,
  tailSway: 0.25,
};

// --- Poses estáticas / acciones ---------------------------------------------------------

function idlePose(p: number): Pose {
  const TAU = Math.PI * 2;
  const pose: Pose = { rot: {}, hipsDy: -0.01 + 0.006 * Math.sin(p * TAU * 2), hipsDz: 0 };
  pose.rot.hips = [0, 0, 0];
  pose.rot.spine = [0.01 * Math.sin(p * TAU * 2), 0, 0];
  pose.rot.chest = [-0.01 * Math.sin(p * TAU * 2), 0, 0];
  pose.rot.neck = [0.05 + 0.04 * Math.sin(p * TAU), 0.2 * Math.sin(p * TAU), 0];
  pose.rot.head = [-0.05 + 0.05 * Math.sin(p * TAU * 2 + 0.5), 0.14 * Math.sin(p * TAU + 0.8), 0.04 * Math.sin(p * TAU)];
  pose.rot.jaw = [0, 0, 0];
  solveLegs(pose, planted());
  tail(pose, -0.12, 0.3, p * TAU * 2);
  return pose;
}

function stalkIdlePose(p: number): Pose {
  const TAU = Math.PI * 2;
  const pose: Pose = { rot: {}, hipsDy: -0.32 + 0.004 * Math.sin(p * TAU * 2), hipsDz: 0 };
  pose.rot.hips = [0, 0, 0];
  pose.rot.spine = [0, 0, 0];
  pose.rot.chest = [0.04, 0, 0];
  pose.rot.neck = [0.55, 0.05 * Math.sin(p * TAU), 0];
  pose.rot.head = [-0.5, 0, 0];
  pose.rot.jaw = [0, 0, 0];
  const t = planted();
  t.FL.dz = t.FR.dz = 0.06;
  solveLegs(pose, t);
  // Punta de la cola nerviosa.
  tail(pose, -0.22, 0.04, p * TAU * 3, 0.2);
  pose.rot.tail4 = [0.3, 0.35 * Math.sin(p * TAU * 3), 0];
  return pose;
}

/** Tumbado en esfinge: patas delanteras extendidas, cabeza alta. */
function restPose(p: number): Pose {
  const TAU = Math.PI * 2;
  const pose: Pose = { rot: {}, hipsDy: -0.62 + 0.008 * Math.sin(p * TAU * 2), hipsDz: 0 };
  pose.rot.hips = [0.04, 0, 0.05];
  pose.rot.spine = [-0.02, 0, 0];
  pose.rot.chest = [-0.06, 0, 0];
  pose.rot.neck = [-0.25, 0.12 * Math.sin(p * TAU), 0];
  pose.rot.head = [0.18, 0.1 * Math.sin(p * TAU + 1), 0];
  pose.rot.jaw = [0, 0, 0];
  solveLegs(pose, {
    FL: { dy: -0.07, dz: 0.34, pawPitch: -1.0 },
    FR: { dy: -0.07, dz: 0.3, pawPitch: -1.0 },
    BL: { dy: -0.22, dz: 0.02, pawPitch: -1.25 },
    BR: { dy: -0.22, dz: 0.02, pawPitch: -1.25 },
  });
  tail(pose, -0.55, 0.15, p * TAU, 0.05);
  return pose;
}

/** Rugido: cabeza adelantada, mandíbula abierta en series de gruñidos, pecho que bombea. */
function roarPose(p: number): Pose {
  const env = smoothstep(0, 0.14, p) * (1 - smoothstep(0.84, 1, p));
  const pulse = 0.72 + 0.28 * Math.sin(p * Math.PI * 2 * 7);
  const pose: Pose = { rot: {}, hipsDy: -0.03 * env, hipsDz: 0 };
  pose.rot.hips = [0, 0, 0];
  pose.rot.spine = [0.03 * env * pulse, 0, 0];
  pose.rot.chest = [0.05 * env, 0, 0];
  pose.rot.neck = [0.22 * env, 0, 0];
  pose.rot.head = [-0.42 * env, 0, 0];
  pose.rot.jaw = [0.6 * env * pulse, 0, 0];
  solveLegs(pose, planted());
  tail(pose, -0.1 + 0.2 * env, 0.05, p * 6, 0.1);
  return pose;
}

/** Salto: delanteras recogidas, traseras extendidas. */
function jumpPose(): Pose {
  const pose: Pose = { rot: {}, hipsDy: 0.02, hipsDz: 0 };
  pose.rot.hips = [-0.12, 0, 0];
  pose.rot.spine = [0.05, 0, 0];
  pose.rot.chest = [0.02, 0, 0];
  pose.rot.neck = [0.2, 0, 0];
  pose.rot.head = [-0.1, 0, 0];
  pose.rot.jaw = [0, 0, 0];
  solveLegs(pose, {
    FL: { dy: 0.3, dz: 0.3, pawPitch: 1.0 },
    FR: { dy: 0.26, dz: 0.24, pawPitch: 1.0 },
    BL: { dy: 0.12, dz: -0.4, pawPitch: 0.8 },
    BR: { dy: 0.1, dz: -0.36, pawPitch: 0.8 },
  });
  tail(pose, 0.35, 0, 0, 0.05);
  return pose;
}

/** Bebiendo: patas delanteras abiertas, cabeza al agua y lengüetazos rápidos. */
function drinkPose(p: number): Pose {
  const TAU = Math.PI * 2;
  const pose: Pose = { rot: {}, hipsDy: -0.08, hipsDz: 0 };
  pose.rot.hips = [0.05, 0, 0];
  pose.rot.spine = [0.08, 0, 0];
  pose.rot.chest = [0.16, 0, 0];
  pose.rot.neck = [0.85, 0.03 * Math.sin(p * TAU), 0];
  pose.rot.head = [-0.15 + 0.05 * Math.sin(p * TAU * 6), 0, 0];
  pose.rot.jaw = [0.12 + 0.12 * Math.max(0, Math.sin(p * TAU * 6)), 0, 0];
  const t = planted();
  t.FL.dz = 0.14;
  t.FR.dz = 0.1;
  solveLegs(pose, t);
  tail(pose, -0.15, 0.15, p * TAU);
  return pose;
}

/** Comiendo tumbado sobre la presa: tirones de cabeza y mandíbula. */
function eatPose(p: number): Pose {
  const TAU = Math.PI * 2;
  const tug = Math.max(0, Math.sin(p * TAU * 2));
  const pose: Pose = { rot: {}, hipsDy: -0.45, hipsDz: 0 };
  pose.rot.hips = [0.02, 0, 0];
  pose.rot.spine = [0.02, 0, 0];
  pose.rot.chest = [0.1, 0, 0];
  pose.rot.neck = [0.62 - 0.2 * tug, 0.12 * Math.sin(p * TAU * 2), 0];
  pose.rot.head = [0.15 - 0.15 * tug, 0.15 * Math.sin(p * TAU * 2 + 1), 0.1 * Math.sin(p * TAU * 2)];
  pose.rot.jaw = [0.35 * Math.abs(Math.sin(p * TAU * 3)), 0, 0];
  solveLegs(pose, {
    FL: { dy: -0.05, dz: 0.28, pawPitch: -0.8 },
    FR: { dy: -0.05, dz: 0.24, pawPitch: -0.8 },
    BL: { dy: -0.12, dz: 0.02, pawPitch: -0.9 },
    BR: { dy: -0.12, dz: 0.02, pawPitch: -0.9 },
  });
  tail(pose, -0.4, 0.2, p * TAU);
  return pose;
}

/** Cachorro mamando: agachado, hocico hacia arriba y amasando con las patas delanteras. */
function nursePose(p: number): Pose {
  const TAU = Math.PI * 2;
  const pose: Pose = { rot: {}, hipsDy: -0.2, hipsDz: 0 };
  pose.rot.hips = [0, 0, 0];
  pose.rot.spine = [0, 0, 0];
  pose.rot.chest = [-0.05, 0, 0];
  pose.rot.neck = [-0.35, 0, 0];
  pose.rot.head = [-0.25 + 0.04 * Math.sin(p * TAU * 4), 0, 0];
  pose.rot.jaw = [0.08 + 0.06 * Math.sin(p * TAU * 4), 0, 0];
  const t = planted();
  t.FL.dy = 0.04 * Math.max(0, Math.sin(p * TAU * 2));
  t.FR.dy = 0.04 * Math.max(0, Math.sin(p * TAU * 2 + Math.PI));
  t.FL.dz = t.FR.dz = 0.08;
  solveLegs(pose, t);
  tail(pose, -0.1, 0.25, p * TAU * 2);
  return pose;
}

/** Muerte: se desploma de costado. */
function diePose(p: number): Pose {
  const fall = smoothstep(0, 0.6, p);
  const pose: Pose = { rot: {}, hipsDy: -0.68 * fall, hipsDz: 0 };
  pose.rot.hips = [0, 0, 1.4 * fall];
  pose.rot.spine = [0, 0, 0.08 * fall];
  pose.rot.chest = [0, 0, 0.05 * fall];
  pose.rot.neck = [0.2 * fall, 0.3 * fall, 0];
  pose.rot.head = [0.1 * fall, 0, 0.3 * fall];
  pose.rot.jaw = [0.15 * fall, 0, 0];
  solveLegs(pose, {
    FL: { dy: 0.05 * fall, dz: 0.25 * fall, pawPitch: 0.3 * fall },
    FR: { dy: 0, dz: 0.2 * fall, pawPitch: 0.3 * fall },
    BL: { dy: 0.05 * fall, dz: -0.25 * fall, pawPitch: 0.3 * fall },
    BR: { dy: 0, dz: -0.2 * fall, pawPitch: 0.3 * fall },
  });
  tail(pose, -0.3 * fall, 0, 0, 0.02);
  return pose;
}

/** Zarpazo: se alza sobre los cuartos traseros y golpea con la mano izquierda. */
function swipePose(p: number): Pose {
  const env = Math.sin(Math.PI * Math.min(1, p * 1.2));
  const strike = smoothstep(0.35, 0.6, p) * (1 - smoothstep(0.75, 1, p));
  const pose: Pose = { rot: {}, hipsDy: 0.03 * env, hipsDz: 0.05 * env };
  pose.rot.hips = [-0.18 * env, 0, 0];
  pose.rot.spine = [-0.08 * env, 0, 0];
  pose.rot.chest = [-0.06 * env, 0.1 * strike, 0];
  pose.rot.neck = [0.15 * env, 0, 0];
  pose.rot.head = [-0.3 * env, 0, 0];
  pose.rot.jaw = [0.45 * env, 0, 0];
  solveLegs(pose, {
    FL: { dy: 0.15 * env + 0.3 * strike, dz: 0.1 + 0.35 * strike, pawPitch: -0.4 * strike },
    FR: { dy: 0.08 * env, dz: 0.05, pawPitch: 0 },
    BL: { dy: 0, dz: -0.05, pawPitch: 0 },
    BR: { dy: 0, dz: -0.05, pawPitch: 0 },
  });
  tail(pose, 0.3 * env, 0.3, p * 12, 0.1);
  return pose;
}

/** Mordisco: embestida hacia delante con las fauces abiertas. */
function bitePose(p: number): Pose {
  const lunge = smoothstep(0.3, 0.55, p) * (1 - smoothstep(0.7, 1, p));
  const wind = smoothstep(0, 0.3, p) * (1 - lunge);
  const pose: Pose = { rot: {}, hipsDy: -0.12 * wind - 0.04 * lunge, hipsDz: -0.08 * wind + 0.3 * lunge };
  pose.rot.hips = [0.05 * wind, 0, 0];
  pose.rot.spine = [0.08 * wind, 0, 0];
  pose.rot.chest = [0.1 * wind - 0.05 * lunge, 0, 0];
  pose.rot.neck = [0.3 * wind + 0.05 * lunge, 0, 0];
  pose.rot.head = [-0.35 * wind - 0.25 * lunge, 0.1 * lunge, 0];
  pose.rot.jaw = [0.2 * wind + 0.75 * lunge, 0, 0];
  solveLegs(pose, {
    FL: { dy: 0.1 * lunge, dz: 0.3 * lunge, pawPitch: 0 },
    FR: { dy: 0.06 * lunge, dz: 0.25 * lunge, pawPitch: 0 },
    BL: { dy: 0, dz: -0.1 * wind, pawPitch: 0 },
    BR: { dy: 0, dz: -0.1 * wind, pawPitch: 0 },
  });
  tail(pose, 0.2, 0.15, p * 10, 0.1);
  return pose;
}

/** Postura de amenaza: agazapado delante, cabeza baja, fauces abiertas y cola azotando. */
function snarlPose(p: number): Pose {
  const TAU = Math.PI * 2;
  const tremble = 0.03 * Math.sin(p * TAU * 6);
  const pose: Pose = { rot: {}, hipsDy: -0.06, hipsDz: -0.04 };
  pose.rot.hips = [-0.04, 0, 0];
  pose.rot.spine = [0.06, 0, 0];
  pose.rot.chest = [0.14, 0, 0];
  pose.rot.neck = [0.32, 0.05 * Math.sin(p * TAU), 0];
  pose.rot.head = [-0.42 + tremble, 0, 0];
  pose.rot.jaw = [0.45 + tremble, 0, 0];
  const t = planted();
  t.FL.dz = t.FR.dz = 0.1;
  solveLegs(pose, t);
  tail(pose, 0.1, 0.6, p * TAU * 2, 0.05);
  return pose;
}

/** Marcaje territorial: cola alzada y rociada hacia atrás. */
function markPose(p: number): Pose {
  const env = smoothstep(0, 0.2, p) * (1 - smoothstep(0.8, 1, p));
  const pose: Pose = { rot: {}, hipsDy: 0.03 * env, hipsDz: 0 };
  pose.rot.hips = [-0.08 * env, 0, 0];
  pose.rot.spine = [0, 0, 0];
  pose.rot.chest = [0.04 * env, 0, 0];
  pose.rot.neck = [0.05, 0, 0];
  pose.rot.head = [-0.1, 0, 0];
  pose.rot.jaw = [0, 0, 0];
  solveLegs(pose, {
    FL: { dy: 0, dz: 0.05, pawPitch: 0 },
    FR: { dy: 0, dz: 0.05, pawPitch: 0 },
    BL: { dy: 0, dz: -0.08 * env, pawPitch: 0 },
    BR: { dy: 0.03 * env, dz: -0.04 * env, pawPitch: 0 },
  });
  const bones: LionBone[] = ['tail1', 'tail2', 'tail3', 'tail4'];
  bones.forEach((b, i) => {
    pose.rot[b] = [i === 0 ? 0.9 * env : 0.1, 0.05 * Math.sin(p * 20 + i), 0];
  });
  return pose;
}

// --- Muestreo a AnimationClip ------------------------------------------------------------

function bakeClip(name: string, duration: number, samples: number, poseAt: (p: number) => Pose): THREE.AnimationClip {
  const times = new Float32Array(samples + 1);
  const quats: Record<string, Float32Array> = {};
  const hipsPos = new Float32Array((samples + 1) * 3);
  for (const bone of LION_BONES) quats[bone] = new Float32Array((samples + 1) * 4);

  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const restHips = JOINTS.hips;
  for (let s = 0; s <= samples; s++) {
    const p = s / samples;
    times[s] = p * duration;
    const pose = poseAt(p);
    for (const bone of LION_BONES) {
      const r = pose.rot[bone] ?? [0, 0, 0];
      q.setFromEuler(e.set(r[0], r[1], r[2], 'XYZ'));
      quats[bone].set([q.x, q.y, q.z, q.w], s * 4);
    }
    hipsPos.set([restHips[0], restHips[1] + pose.hipsDy, restHips[2] + pose.hipsDz], s * 3);
  }

  const tracks: THREE.KeyframeTrack[] = LION_BONES.filter((b) => b !== 'root').map(
    (bone) => new THREE.QuaternionKeyframeTrack(`${bone}.quaternion`, times, quats[bone]),
  );
  tracks.push(new THREE.VectorKeyframeTrack('hips.position', times, hipsPos));
  return new THREE.AnimationClip(name, duration, tracks);
}

/** Genera (una sola vez) todos los clips; son compartidos por todos los leones. */
let clipCache: Record<LionClipName, THREE.AnimationClip> | null = null;

export function getLionClips(): Record<LionClipName, THREE.AnimationClip> {
  if (clipCache) return clipCache;
  const loopEnd = (f: (p: number) => Pose) => (p: number) => f(p >= 1 ? 0 : p);
  clipCache = {
    idle: bakeClip('idle', 5, 40, loopEnd(idlePose)),
    walk: bakeClip('walk', 1.1, 32, loopEnd((p) => gaitPose(p, WALK))),
    trot: bakeClip('trot', 0.6, 24, loopEnd((p) => gaitPose(p, TROT))),
    run: bakeClip('run', 0.42, 24, loopEnd((p) => gaitPose(p, RUN))),
    stalkIdle: bakeClip('stalkIdle', 3, 24, loopEnd(stalkIdlePose)),
    stalkWalk: bakeClip('stalkWalk', 1.6, 32, loopEnd((p) => gaitPose(p, STALK))),
    rest: bakeClip('rest', 6, 24, loopEnd(restPose)),
    roar: bakeClip('roar', 3.4, 68, roarPose),
    jump: bakeClip('jump', 1, 2, () => jumpPose()),
    swim: bakeClip('swim', 0.9, 24, loopEnd((p) => gaitPose(p, SWIM))),
    drink: bakeClip('drink', 2, 48, loopEnd(drinkPose)),
    eat: bakeClip('eat', 2.4, 48, loopEnd(eatPose)),
    nurse: bakeClip('nurse', 1.6, 32, loopEnd(nursePose)),
    die: bakeClip('die', 1.6, 24, diePose),
    swipe: bakeClip('swipe', 0.55, 22, swipePose),
    bite: bakeClip('bite', 0.75, 24, bitePose),
    snarl: bakeClip('snarl', 1.2, 24, loopEnd(snarlPose)),
    mark: bakeClip('mark', 2, 24, markPose),
  };
  return clipCache;
}
