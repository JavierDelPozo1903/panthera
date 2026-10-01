import { clamp } from '../core/math';

/**
 * Visibilidad de un animal para un depredador u observador [0.08, 1].
 * Depende de la cobertura de la hierba, la postura y el movimiento. Los cachorros son
 * pequeños y se ocultan mejor.
 */
export function visibility(opts: { cover: number; lowPosture: boolean; speed: number; small: boolean }): number {
  const postureHide = opts.lowPosture ? 0.92 : 0.5;
  let v = 1 - opts.cover * postureHide;
  if (opts.speed > 2) v += 0.35;
  else if (opts.speed > 0.3) v += 0.12 + Math.max(0, opts.speed - 1) * 0.2; // acechar deprisa delata
  if (opts.small) v *= 0.8;
  return clamp(v, 0.08, 1);
}

/** Radio (m) al que un depredador detecta a un objetivo con la visibilidad dada. */
export function detectionRadius(visibilityValue: number, night: boolean): number {
  return (night ? 55 : 40) * visibilityValue;
}
