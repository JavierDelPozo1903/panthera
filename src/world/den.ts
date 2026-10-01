import type { WorldData } from './WorldData';

export interface DenSite {
  x: number;
  z: number;
  /** Rumbo mirando hacia fuera de las rocas. */
  heading: number;
  /** Lugar de descanso de la madre, junto a la madriguera. */
  motherX: number;
  motherZ: number;
}

/**
 * Siguiente madriguera en un traslado: hacia la poza más cercana (las leonas buscan agua
 * cerca), a un máximo de ~230 m para que el cachorro pueda seguir el paso.
 */
export function relocationSite(world: WorldData, fromX: number, fromZ: number, rng: () => number): { x: number; z: number } {
  let targetX = fromX;
  let targetZ = fromZ;
  let best = Infinity;
  for (const w of world.features.waterholes) {
    const d = Math.hypot(w.x - fromX, w.z - fromZ);
    if (d < best) {
      best = d;
      // Fuera del cuenco de la poza, del lado de donde venimos.
      const back = (w.radius * 2.6 + 18) / Math.max(d, 1);
      targetX = w.x + (fromX - w.x) * back;
      targetZ = w.z + (fromZ - w.z) * back;
    }
  }
  if (best === Infinity) {
    const a = rng() * Math.PI * 2;
    targetX = fromX + Math.cos(a) * 180;
    targetZ = fromZ + Math.sin(a) * 180;
  }
  // Limita la distancia del traslado.
  const dx = targetX - fromX;
  const dz = targetZ - fromZ;
  const len = Math.hypot(dx, dz);
  const maxLen = 230;
  if (len > maxLen) {
    targetX = fromX + (dx / len) * maxLen;
    targetZ = fromZ + (dz / len) * maxLen;
  }
  // Evita el agua y los bordes.
  for (let i = 0; i < 12 && (!world.inBounds(targetX, targetZ, 60) || world.waterLevelAt(targetX, targetZ) !== null); i++) {
    targetX = fromX + (targetX - fromX) * 0.85 + (rng() - 0.5) * 20;
    targetZ = fromZ + (targetZ - fromZ) * 0.85 + (rng() - 0.5) * 20;
  }
  return { x: targetX, z: targetZ };
}

/**
 * Madriguera natal: al pie del kopje más cercano al centro del mapa. Las leonas paren
 * entre rocas y matorral para ocultar a los cachorros de hienas y leopardos.
 */
export function denSite(world: WorldData): DenSite {
  const kopjes = world.features.kopjes;
  if (kopjes.length === 0) {
    const { x, z } = world.features.spawn;
    return { x, z, heading: 0, motherX: x + 3, motherZ: z };
  }
  const k = kopjes.reduce((best, c) => (Math.hypot(c.x, c.z) < Math.hypot(best.x, best.z) ? c : best));
  const len = Math.hypot(k.x, k.z) || 1;
  const dx = -k.x / len;
  const dz = -k.z / len;
  const r = k.radius * 1.12;
  const x = k.x + dx * r;
  const z = k.z + dz * r;
  return {
    x,
    z,
    heading: Math.atan2(dx, dz),
    motherX: x + dz * 3.2 + dx * 1.5,
    motherZ: z - dx * 3.2 + dz * 1.5,
  };
}
