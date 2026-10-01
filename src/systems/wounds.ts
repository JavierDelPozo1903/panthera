import lionData from '../data/lion.json';

const W = lionData.wounds;

export type BodyPart = 'face' | 'neck' | 'back' | 'foreleg' | 'hindleg';

export const BODY_PART_LABEL: Record<BodyPart, string> = {
  face: 'cara',
  neck: 'cuello',
  back: 'lomo',
  foreleg: 'pata delantera',
  hindleg: 'pata trasera',
};

export interface Wound {
  part: BodyPart;
  /** Gravedad actual [0, 1]. */
  severity: number;
  /** Gravedad máxima que llegó a tener (decide si deja cicatriz). */
  peak: number;
  infected: boolean;
  ageHours: number;
}

/** Heridas abiertas y cicatrices permanentes de un león. */
export interface Body {
  wounds: Wound[];
  scars: BodyPart[];
}

export const playerBody: Body = { wounds: [], scars: [] };

/** Probabilidad de que un golpe alcance cada zona (los combates de leones son de frente). */
const HIT_TABLE: [BodyPart, number][] = [
  ['face', 0.3],
  ['neck', 0.25],
  ['back', 0.2],
  ['foreleg', 0.15],
  ['hindleg', 0.1],
];

export function randomPart(rng: () => number): BodyPart {
  let r = rng();
  for (const [part, p] of HIT_TABLE) {
    r -= p;
    if (r <= 0) return part;
  }
  return 'face';
}

export function addWound(body: Body, part: BodyPart, severity: number): Wound {
  // Golpes en la misma zona agravan la herida existente.
  const existing = body.wounds.find((w) => w.part === part);
  if (existing) {
    existing.severity = Math.min(1, existing.severity + severity);
    existing.peak = Math.max(existing.peak, existing.severity);
    existing.ageHours = 0;
    return existing;
  }
  const w: Wound = { part, severity: Math.min(1, severity), peak: Math.min(1, severity), infected: false, ageHours: 0 };
  body.wounds.push(w);
  return w;
}

export interface WoundTick {
  /** Variación de salud provocada por las heridas (negativa). */
  healthDelta: number;
  newlyInfected: Wound[];
  newScars: BodyPart[];
}

/**
 * Evolución de las heridas por horas de juego: sangran al principio, se curan (más rápido
 * en reposo) y pueden infectarse si son profundas y el león no descansa. Las graves
 * dejan cicatriz permanente.
 */
export function updateWounds(body: Body, gameHours: number, resting: boolean, rng: () => number): WoundTick {
  const tick: WoundTick = { healthDelta: 0, newlyInfected: [], newScars: [] };
  if (gameHours <= 0 || body.wounds.length === 0) return tick;
  for (let i = body.wounds.length - 1; i >= 0; i--) {
    const w = body.wounds[i];
    w.ageHours += gameHours;
    if (w.ageHours < W.bleedHours) tick.healthDelta -= W.bleedPerHour * w.severity * gameHours;
    if (w.infected) {
      tick.healthDelta -= W.infectedDrainPerHour * gameHours;
      // Lamerse y descansar acaba venciendo la infección.
      if (resting && rng() < 0.05 * gameHours) w.infected = false;
    } else {
      const heal = W.healPerHour * (resting ? 2 : 1) * gameHours;
      w.severity -= heal;
      if (w.severity > 0.3 && !resting && rng() < W.infectionChancePerHour * gameHours) {
        w.infected = true;
        tick.newlyInfected.push(w);
      }
    }
    if (w.severity <= 0.03) {
      body.wounds.splice(i, 1);
      if (w.peak >= W.scarThreshold && !body.scars.includes(w.part)) {
        body.scars.push(w.part);
        tick.newScars.push(w.part);
      }
    }
  }
  return tick;
}

/** Penalización de velocidad por heridas en las patas o infección. */
export function woundSpeedFactor(body: Body): number {
  let f = 1;
  for (const w of body.wounds) {
    if (w.part === 'foreleg' || w.part === 'hindleg') f *= 1 - 0.35 * w.severity;
    if (w.infected) f *= 0.85;
  }
  return Math.max(0.4, f);
}

export function resetBody(body: Body, data?: Body): void {
  body.wounds = data ? data.wounds.map((w) => ({ ...w })) : [];
  body.scars = data ? [...data.scars] : [];
}
