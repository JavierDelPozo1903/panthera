import { events } from '../core/events';
import { useGame } from '../core/store';
import { player } from '../entities/player/playerState';
import { maxHealingCharges, progression } from './progression';
import { playerBody } from './wounds';

/**
 * Guaridas: las hogueras del juego. Descansar en una reclamada rellena las hojas
 * medicinales, cura y abre el panel de nivel; al morir en combate se reaparece en la
 * última guarida donde se descansó.
 */
export interface Den {
  id: string;
  name: string;
  x: number;
  z: number;
  claimed: boolean;
}

export const dens: Den[] = [];
export const denState = { lastDenId: 'natal' };

/** Distancia para poder descansar en una guarida. */
export const DEN_RADIUS = 9;

type RestListener = () => void;
const restListeners = new Set<RestListener>();
/** Se avisa al descansar (los jefes no vencidos se reinician, los enemigos reaparecen). */
export function onRest(fn: RestListener): () => void {
  restListeners.add(fn);
  return () => restListeners.delete(fn);
}

export function resetDens(list: Den[], lastDenId = 'natal'): void {
  dens.length = 0;
  for (const d of list) dens.push({ ...d });
  denState.lastDenId = lastDenId;
}

export function addDen(den: Den): void {
  const existing = dens.find((d) => d.id === den.id);
  if (existing) Object.assign(existing, { ...den, claimed: existing.claimed || den.claimed });
  else dens.push({ ...den });
}

export function claimDen(id: string): void {
  const d = dens.find((x) => x.id === id);
  if (!d || d.claimed) return;
  d.claimed = true;
  events.emit('subtitle', { text: `Has reclamado la ${d.name.toLowerCase()}: podrás descansar y reaparecer aquí`, seconds: 4 });
}

export function denNear(x: number, z: number, radius = DEN_RADIUS): Den | null {
  let best: Den | null = null;
  let bestD = radius;
  for (const d of dens) {
    if (!d.claimed) continue;
    const dist = Math.hypot(d.x - x, d.z - z);
    if (dist < bestD) {
      bestD = dist;
      best = d;
    }
  }
  return best;
}

export const lastDen = (): Den | null => dens.find((d) => d.id === denState.lastDenId) ?? dens.find((d) => d.claimed) ?? null;

/** Descansa en una guarida: cura, rellena consumibles y abre el panel de nivel. */
export function restAtDen(den: Den): void {
  denState.lastDenId = den.id;
  progression.healingCharges = maxHealingCharges();
  player.needs.health = 1;
  player.needs.energy = Math.max(player.needs.energy, 0.8);
  for (const w of playerBody.wounds) {
    w.severity *= 0.4;
    w.infected = false;
  }
  player.resting = true;
  for (const fn of restListeners) fn();
  useGame.setState({ denOpen: true });
  events.emit('subtitle', { text: `Descansas en la ${den.name.toLowerCase()}`, seconds: 2.5 });
}
