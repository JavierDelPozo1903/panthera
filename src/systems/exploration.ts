import type { PreySpecies } from '../entities/prey/preyRig';
import { herds } from '../entities/prey/preyState';
import { hyenas } from '../entities/npc/npcState';
import { player } from '../entities/player/playerState';

/** Resolución de la niebla de guerra: 128 × 128 celdas de 32 m sobre el mapa de 4 km. */
export const FOG_CELLS = 128;
const REVEAL_RADIUS = 230;

export interface Sighting {
  kind: 'herd' | 'hyenas';
  species?: PreySpecies;
  x: number;
  z: number;
  /** Día de juego (con fracción) del avistamiento. */
  when: number;
  count: number;
}

/**
 * Exploración: zonas descubiertas (niebla de guerra del mapa) y avistamientos recientes
 * de presas y clanes de hienas, como las anotaciones de un investigador de campo.
 */
export const exploration = {
  revealed: new Uint8Array(FOG_CELLS * FOG_CELLS),
  sightings: new Map<string, Sighting>(),
  /** Se incrementa cuando cambia algo (para redibujar el mapa). */
  version: 0,
};

export function resetExploration(revealed?: Uint8Array): void {
  exploration.revealed = revealed ? new Uint8Array(revealed) : new Uint8Array(FOG_CELLS * FOG_CELLS);
  exploration.sightings.clear();
  exploration.version++;
}

export function updateExploration(worldSize: number, totalDays: number): void {
  const half = worldSize / 2;
  const cell = worldSize / FOG_CELLS;
  const cx = (player.position.x + half) / cell;
  const cz = (player.position.z + half) / cell;
  const r = REVEAL_RADIUS / cell;
  let changed = false;
  for (let z = Math.floor(cz - r); z <= Math.ceil(cz + r); z++) {
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      if (x < 0 || z < 0 || x >= FOG_CELLS || z >= FOG_CELLS) continue;
      if ((x - cx) ** 2 + (z - cz) ** 2 > r * r) continue;
      const i = z * FOG_CELLS + x;
      if (!exploration.revealed[i]) {
        exploration.revealed[i] = 1;
        changed = true;
      }
    }
  }
  for (const h of herds) {
    if (h.size <= 0) continue;
    if (Math.hypot(h.center.x - player.position.x, h.center.z - player.position.z) < 200) {
      exploration.sightings.set(`herd-${h.id}`, { kind: 'herd', species: h.species, x: h.center.x, z: h.center.z, when: totalDays, count: h.size });
      changed = true;
    }
  }
  if (hyenas.length > 0) {
    const h = hyenas[0];
    if (Math.hypot(h.position.x - player.position.x, h.position.z - player.position.z) < 150) {
      exploration.sightings.set('hyenas', { kind: 'hyenas', x: h.position.x, z: h.position.z, when: totalDays, count: hyenas.length });
      changed = true;
    }
  }
  if (changed) exploration.version++;
}

export function isRevealed(worldSize: number, x: number, z: number): boolean {
  const cell = worldSize / FOG_CELLS;
  const ix = Math.floor((x + worldSize / 2) / cell);
  const iz = Math.floor((z + worldSize / 2) / cell);
  if (ix < 0 || iz < 0 || ix >= FOG_CELLS || iz >= FOG_CELLS) return false;
  return exploration.revealed[iz * FOG_CELLS + ix] === 1;
}
