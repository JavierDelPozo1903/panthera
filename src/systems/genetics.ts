import lionData from '../data/lion.json';
import { clamp, lerp } from '../core/math';
import { physicalMaturity } from './lifeStage';

/**
 * Rasgos heredables. Los cachorros reciben la media de sus padres con una pequeña mutación:
 * así el linaje del jugador evoluciona generación a generación (modo legado).
 */
export interface Traits {
  /** Tendencia de la melena a oscurecerse [0, 1]. */
  maneDarkness: number;
  /** Multiplicador de tamaño corporal [0.88, 1.12]. */
  size: number;
  /** Agresividad [0, 1]: los más agresivos atacan antes en un combate. */
  aggression: number;
  /** Tono del pelaje [-1, 1]: negativo más gris, positivo más rojizo. */
  furTint: number;
}

export const DEFAULT_TRAITS: Traits = { maneDarkness: 0.5, size: 1, aggression: 0.5, furTint: 0 };

export function randomTraits(rng: () => number): Traits {
  return {
    maneDarkness: clamp(0.25 + rng() * 0.6, 0, 1),
    size: 0.92 + rng() * 0.16,
    aggression: rng(),
    furTint: rng() * 2 - 1,
  };
}

export function inherit(a: Traits, b: Traits, rng: () => number): Traits {
  const mix = (x: number, y: number, spread: number) => lerp(x, y, rng()) + (rng() - 0.5) * spread;
  return {
    maneDarkness: clamp(mix(a.maneDarkness, b.maneDarkness, 0.2), 0, 1),
    size: clamp(mix(a.size, b.size, 0.06), 0.88, 1.12),
    aggression: clamp(mix(a.aggression, b.aggression, 0.25), 0, 1),
    furTint: clamp(mix(a.furTint, b.furTint, 0.3), -1, 1),
  };
}

/** Rasgos del jugador (los hereda de sus padres en el modo legado). */
export const playerTraits: Traits = { ...DEFAULT_TRAITS };

export function setPlayerTraits(t: Traits): void {
  Object.assign(playerTraits, t);
}

/** Peso estimado en kg según sexo, edad y tamaño. */
export function weightKg(sex: 'male' | 'female', ageYears: number, size: number): number {
  const adult = lionData.weightKg[sex].mean;
  return adult * size * lerp(0.08, 1, physicalMaturity(ageYears));
}

/**
 * Fuerza de combate relativa (1 ≈ macho adulto medio sano). Depende del peso, la salud y,
 * en los machos, de la melena oscura (indicador de testosterona y estado físico).
 */
export function combatStrength(sex: 'male' | 'female', ageYears: number, size: number, health: number, maneDarkness: number): number {
  const w = weightKg(sex, ageYears, size) / lionData.weightKg.male.mean;
  const mane = sex === 'male' ? 0.9 + 0.2 * maneDarkness : 1;
  // La vejez resta fuerza y desgasta los dientes.
  const old = ageYears > 10 ? lerp(1, 0.6, clamp((ageYears - 10) / 6, 0, 1)) : 1;
  return w * mane * old * (0.55 + 0.45 * health);
}

/** Oscuridad visible de la melena: rasgo heredado modulado por la salud. */
export function visibleManeDarkness(traits: Traits, health: number): number {
  return clamp(traits.maneDarkness * (0.7 + 0.3 * health), 0, 1);
}
