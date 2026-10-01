import { damp, moveTowardsAngle } from '../core/math';
import type { LionClipName } from '../entities/lion/lionAnimations';
import type { WorldData } from '../world/WorldData';

interface Mobile {
  position: { x: number; y: number; z: number };
  heading: number;
  speed: number;
}

interface SteerOptions {
  turnRate?: number;
  accel?: number;
  /** Distancia a la que se detiene al llegar. */
  stopDistance?: number;
  /** Profundidad de agua (m) que evita cruzar. */
  maxWaterDepth?: number;
}

const WORLD_MARGIN = 20;

function blocked(world: WorldData, x: number, z: number, maxDepth: number): boolean {
  if (!world.inBounds(x, z, WORLD_MARGIN)) return true;
  const water = world.waterLevelAt(x, z);
  return water !== null && water - world.heightAt(x, z) > maxDepth;
}

/**
 * Locomoción de un agente hacia un punto: giro limitado, aceleración suave, esquiva del agua
 * profunda probando desvíos laterales y ajuste de la altura al terreno.
 * Devuelve la distancia restante al objetivo.
 */
export function steerTowards(
  agent: Mobile,
  world: WorldData,
  tx: number,
  tz: number,
  desiredSpeed: number,
  dt: number,
  opts: SteerOptions = {},
): number {
  const { turnRate = 2.8, accel = 3, stopDistance = 0.5, maxWaterDepth = 0.5 } = opts;
  const dx = tx - agent.position.x;
  const dz = tz - agent.position.z;
  const dist = Math.hypot(dx, dz);
  let speedTarget = dist < stopDistance ? 0 : desiredSpeed;
  if (speedTarget > 0) agent.heading = moveTowardsAngle(agent.heading, Math.atan2(dx, dz), turnRate * dt);
  // Frena al llegar para no pasarse.
  if (dist < stopDistance + 2) speedTarget = Math.min(speedTarget, Math.max(0.4, dist));
  agent.speed = damp(agent.speed, speedTarget, accel, dt);
  moveForward(agent, world, dt, maxWaterDepth);
  return dist;
}

/** Avanza según rumbo y velocidad, desviándose si el camino está bloqueado por agua. */
export function moveForward(agent: Mobile, world: WorldData, dt: number, maxWaterDepth = 0.5): void {
  if (agent.speed > 0.01) {
    const step = agent.speed * dt;
    for (const offset of [0, 0.7, -0.7, 1.4, -1.4]) {
      const h = agent.heading + offset;
      const nx = agent.position.x + Math.sin(h) * step;
      const nz = agent.position.z + Math.cos(h) * step;
      if (!blocked(world, nx, nz, maxWaterDepth)) {
        agent.position.x = nx;
        agent.position.z = nz;
        if (offset !== 0) agent.heading = moveTowardsAngle(agent.heading, h, 2 * dt);
        break;
      }
      if (offset === -1.4) agent.speed = 0;
    }
  }
  agent.position.y = world.heightAt(agent.position.x, agent.position.z);
}

/** Clip de locomoción adecuado a la velocidad y al tamaño del animal. */
export function clipForSpeed(speed: number, scale: number, still: LionClipName = 'idle'): LionClipName {
  if (speed < 0.15) return still;
  if (speed < 2.4 * scale) return 'walk';
  if (speed < 5.6 * scale) return 'trot';
  return 'run';
}

export const distXZ = (a: { x: number; z: number }, b: { x: number; z: number }): number =>
  Math.hypot(a.x - b.x, a.z - b.z);
