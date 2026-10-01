import { regions } from '../world/regions';
import type { WorldData } from '../world/WorldData';
import { MATRIARCH, REGION_BOSSES } from './bossDefs';
import { bosses, clearBosses, createBoss, placeBoss, resetBoss, resetBossesAfterDeath, updateBosses } from './bossEngine';

/**
 * La Matriarca (primer jefe, en la sabana) y la colocación del resto de jefes en el claro de
 * su región. La lógica de pelea vive en `bossEngine`; aquí solo se colocan.
 */
export const BOSS_ID = MATRIARCH.id;
export const matriarch = createBoss(MATRIARCH);

/** Coloca a La Matriarca junto a un kopje a ~650 m de la madriguera y a los jefes regionales. */
export function initMatriarch(world: WorldData, denX: number, denZ: number): void {
  clearBosses();
  const kopjes = [...world.features.kopjes].sort(
    (a, b) => Math.abs(Math.hypot(a.x - denX, a.z - denZ) - 650) - Math.abs(Math.hypot(b.x - denX, b.z - denZ) - 650),
  );
  const k = kopjes.find((c) => Math.hypot(c.x - denX, c.z - denZ) > 300) ?? { x: denX + 600, z: denZ + 200 };
  // El claro de la pelea: en llano, a unos 80 m del kopje en dirección a la madriguera
  // (las rocas no deben tapar la pelea).
  const dx = denX - k.x;
  const dz = denZ - k.z;
  let ax = k.x + (dx / (Math.hypot(dx, dz) || 1)) * 80;
  let az = k.z + (dz / (Math.hypot(dx, dz) || 1)) * 80;
  let best = Infinity;
  for (let i = 0; i < 24; i++) {
    const r = 80 + (i % 3) * 25;
    const ang = Math.atan2(dz, dx) + ((i / 3) | 0) * 0.35 - 1.2;
    const x = k.x + Math.cos(ang) * r;
    const z = k.z + Math.sin(ang) * r;
    if (world.waterLevelAt(x, z) !== null) continue;
    let slope = 0;
    for (const [ox, oz] of [[20, 0], [-20, 0], [0, 20], [0, -20]]) slope += Math.abs(world.heightAt(x + ox, z + oz) - world.heightAt(x, z));
    if (slope < best) {
      best = slope;
      ax = x;
      az = z;
    }
  }
  placeBoss(matriarch, world, ax, az);
  for (const r of regions) {
    const def = REGION_BOSSES[r.id];
    if (def) placeBoss(createBoss(def), world, r.arena.x, r.arena.z);
  }
}

export function updateMatriarch(world: WorldData, dt: number): void {
  updateBosses(world, dt);
}

export function resetMatriarch(world: WorldData | null, defeated = false): void {
  resetBoss(matriarch, world, defeated);
}

export function resetBossAfterDeath(world: WorldData | null): void {
  resetBossesAfterDeath(world);
}

export { bosses };
