import lionData from '../data/lion.json';
import { nearestCarcass } from '../entities/carcass/carcassState';
import { mother } from '../entities/npc/npcState';
import { player, type PlayerAction } from '../entities/player/playerState';
import type { WorldData } from '../world/WorldData';

export interface Interaction {
  action: PlayerAction;
  label: string;
}

const NURSE_STATES = new Set(['rest', 'idle', 'nurse', 'wander', 'follow', 'fetch']);

/** ¿Hay agua justo delante del hocico? */
export function waterAhead(world: WorldData): boolean {
  if (player.swimming) return false;
  // Distancias absolutas: hasta un cachorro alcanza el agua asomándose a la orilla.
  for (const d of [0.6, 1.2, 1.8, 2.6]) {
    const x = player.position.x + Math.sin(player.heading) * d;
    const z = player.position.z + Math.cos(player.heading) * d;
    const water = world.waterLevelAt(x, z);
    if (water !== null && water - world.heightAt(x, z) > 0.001) return true;
  }
  return false;
}

/**
 * Acción contextual disponible con la tecla E, por prioridad:
 * comer de una presa > mamar (cachorros sin destetar) > beber.
 */
export function availableInteraction(world: WorldData): Interaction | null {
  if (!player.alive || !player.grounded) return null;
  const c = nearestCarcass(player.position.x, player.position.z, 2.2);
  if (c) return { action: 'eat', label: 'Comer' };
  const motherClose =
    mother.active &&
    NURSE_STATES.has(mother.state) &&
    Math.hypot(mother.position.x - player.position.x, mother.position.z - player.position.z) < 2.6;
  if (motherClose && player.ageYears < lionData.needs.weaningYears) return { action: 'nurse', label: 'Mamar' };
  if (waterAhead(world)) return { action: 'drink', label: 'Beber' };
  return null;
}
