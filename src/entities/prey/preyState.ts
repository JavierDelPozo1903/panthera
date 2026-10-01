import * as THREE from 'three';
import type { LionClipName } from '../lion/lionAnimations';
import type { PreySpecies } from './preyRig';

export type PreyState = 'graze' | 'alert' | 'flee' | 'struggle' | 'dead';
export type HerdMode = 'graze' | 'alert' | 'flee';

export interface PreyAnimal {
  id: string;
  species: PreySpecies;
  seed: number;
  herd: Herd;
  position: THREE.Vector3;
  heading: number;
  speed: number;
  state: PreyState;
  timer: number;
  /** Nivel de alerta [0, 1]: a partir de 0,45 levanta la cabeza; a 1 huye. */
  awareness: number;
  /** Retraso de reacción antes de arrancar a huir (s). */
  reaction: number;
  /** Desplazamiento preferido respecto al centro de la manada al pastar. */
  offset: THREE.Vector2;
  /** Cabeza levantada vigilando (turnos de vigilancia). */
  vigilant: boolean;
  alive: boolean;
  clip: LionClipName;
}

export interface Herd {
  id: number;
  species: PreySpecies;
  size: number;
  /** Centro de la manada (se simula aunque no haya individuos instanciados). */
  center: THREE.Vector3;
  target: THREE.Vector3;
  mode: HerdMode;
  modeTimer: number;
  /** Punto del que huyen. */
  threat: THREE.Vector3;
  members: PreyAnimal[];
  spawned: boolean;
  /** Último momento (s de partida) en que el jugador la vio. */
  lastSeen: number;
}

export const herds: Herd[] = [];

export function allPrey(): PreyAnimal[] {
  const list: PreyAnimal[] = [];
  for (const h of herds) for (const m of h.members) list.push(m);
  return list;
}

export function nearestPrey(x: number, z: number, maxDist: number, filter?: (p: PreyAnimal) => boolean): PreyAnimal | null {
  let best: PreyAnimal | null = null;
  let bestD = maxDist;
  for (const h of herds) {
    if (!h.spawned) continue;
    for (const p of h.members) {
      if (!p.alive || (filter && !filter(p))) continue;
      const d = Math.hypot(p.position.x - x, p.position.z - z);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
  }
  return best;
}
