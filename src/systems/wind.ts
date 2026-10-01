import { sharedUniforms } from '../world/atmosphereState';

/**
 * Viento: rola lentamente a lo largo del día. `dir` indica hacia dónde sopla (x, z).
 * Las presas huelen a los depredadores que tienen a barlovento.
 */
export const wind = {
  dir: sharedUniforms.uWindDir.value,
  strength: 1,
};

export function updateWind(totalDays: number): void {
  const angle = 0.6 + 0.9 * Math.sin(totalDays * 2.3) + 0.4 * Math.sin(totalDays * 7.1 + 1.3);
  wind.dir.set(Math.cos(angle), Math.sin(angle));
  wind.strength = 0.7 + 0.5 * (0.5 + 0.5 * Math.sin(totalDays * 11.7));
  sharedUniforms.uWindStrength.value = wind.strength;
}

/** ¿Llega el olor de `from` hasta `to`? (to está a sotavento de from). */
export function downwindOf(fromX: number, fromZ: number, toX: number, toZ: number): number {
  const dx = toX - fromX;
  const dz = toZ - fromZ;
  const len = Math.hypot(dx, dz) || 1;
  return (dx / len) * wind.dir.x + (dz / len) * wind.dir.y;
}
