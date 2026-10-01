import * as THREE from 'three';

export type CarcassSpecies = 'impala' | 'zebra' | 'wildebeest' | 'warthog';

export interface Carcass {
  id: number;
  species: CarcassSpecies;
  position: THREE.Vector3;
  heading: number;
  meatKg: number;
  maxKg: number;
  /** Segundos desde que se agotó la carne (se retira al cabo de un rato). */
  bonesAge: number;
}

/** Presas abatidas presentes en el mundo (Fase 2: las que trae la madre). */
export const carcasses: Carcass[] = [];
let nextId = 1;

/** Un impala adulto rinde unos 25 kg de carne aprovechable. */
export function spawnCarcass(
  x: number,
  y: number,
  z: number,
  heading: number,
  meatKg = 25,
  species: CarcassSpecies = 'impala',
): Carcass {
  const c: Carcass = {
    id: nextId++,
    species,
    position: new THREE.Vector3(x, y, z),
    heading,
    meatKg,
    maxKg: meatKg,
    bonesAge: 0,
  };
  carcasses.push(c);
  return c;
}

export function nearestCarcass(x: number, z: number, maxDist: number, withMeat = true): Carcass | null {
  let best: Carcass | null = null;
  let bestD = maxDist;
  for (const c of carcasses) {
    if (withMeat && c.meatKg <= 0.3) continue;
    const d = Math.hypot(c.position.x - x, c.position.z - z);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

/** Consume carne; devuelve los kg realmente comidos. */
export function eatFrom(c: Carcass, kg: number): number {
  const eaten = Math.min(kg, c.meatKg);
  c.meatKg -= eaten;
  return eaten;
}

export function updateCarcasses(dt: number): void {
  for (let i = carcasses.length - 1; i >= 0; i--) {
    const c = carcasses[i];
    if (c.meatKg <= 0.3) {
      c.bonesAge += dt;
      if (c.bonesAge > 180) carcasses.splice(i, 1);
    }
  }
}

export function clearCarcasses(): void {
  carcasses.length = 0;
}
