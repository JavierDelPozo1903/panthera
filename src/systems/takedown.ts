import preyData from '../data/prey.json';
import { events } from '../core/events';
import { lerp } from '../core/math';
import { grabPrey, killPrey, releasePrey } from '../ai/preyBrain';
import { mother, pride } from '../entities/npc/npcState';
import { nearestPrey, type PreyAnimal } from '../entities/prey/preyState';
import { damagePlayer, player } from '../entities/player/playerState';
import { journal, recordMilestone } from './journal';
import { physicalMaturity } from './lifeStage';

/**
 * Derribo de una presa: al alcanzarla en carrera (o caer sobre ella de un salto) empieza
 * una lucha. El jugador sujeta pulsando E repetidamente mientras la presa forcejea; otras
 * leonas cerca ayudan a sujetarla. Si el agarre llega a 1, la presa muere; si llega a 0,
 * se zafa.
 */
export const takedown = {
  active: false,
  prey: null as PreyAnimal | null,
  grip: 0,
  /** Ayuda de otras leonas en este momento. */
  helpers: 0,
  /** Bloqueo breve tras un intento fallido. */
  cooldown: 0,
};

const START_GRIP = 0.35;
const GRIP_PER_PRESS = 0.11;

function strength(): number {
  return 0.5 + physicalMaturity(player.ageYears);
}

function helpersNear(prey: PreyAnimal): number {
  let n = 0;
  const lions = [mother, ...pride];
  for (const l of lions) {
    if (!l.alive || l.state === 'away') continue;
    if (Math.hypot(l.position.x - prey.position.x, l.position.z - prey.position.z) < 4) n++;
  }
  return n;
}

/** Peso máximo que el jugador puede derribar con la ayuda disponible. */
export function maxPreyKg(helpers: number): number {
  const m = preyData.maxSoloPreyKg;
  return lerp(m.atMaturity0, m.atMaturity1, physicalMaturity(player.ageYears)) * (1 + helpers * 1.2);
}

/** Intenta empezar un derribo si hay una presa al alcance. */
export function tryStartTakedown(): boolean {
  if (takedown.active || takedown.cooldown > 0 || !player.alive) return false;
  const reach = 0.9 + 0.8 * player.scale;
  const prey = nearestPrey(player.position.x, player.position.z, reach, (p) => p.state !== 'struggle');
  if (!prey) return false;

  const spec = preyData.species[prey.species];
  const helpers = helpersNear(prey);
  if (spec.weightKg > maxPreyKg(helpers)) {
    // Demasiado grande: la coz y la presa escapa.
    events.emit('subtitle', { text: `${spec.label}: demasiado grande para ti. Te aparta de una coz`, seconds: 3 });
    events.emit('sfx', { sound: 'bite', x: prey.position.x, y: prey.position.y, z: prey.position.z, volume: 0.5 });
    damagePlayer(0.06, 'prey');
    releasePrey(prey, player.position.x, player.position.z);
    takedown.cooldown = 2;
    player.speed *= 0.3;
    return false;
  }

  takedown.active = true;
  takedown.prey = prey;
  takedown.grip = START_GRIP;
  grabPrey(prey);
  player.speed = 0;
  player.action = null;
  events.emit('sfx', { sound: 'pounce', x: prey.position.x, y: prey.position.y, z: prey.position.z });
  events.emit('subtitle', { text: `¡Has alcanzado a un ${spec.label.toLowerCase()}! Pulsa E repetidamente para sujetarlo`, seconds: 3 });
  return true;
}

/** Avanza la lucha. `presses` = pulsaciones de E en este frame. */
export function updateTakedown(dt: number, presses: number): void {
  takedown.cooldown = Math.max(0, takedown.cooldown - dt);
  const prey = takedown.prey;
  if (!takedown.active || !prey) return;
  if (!player.alive || !prey.alive) {
    endTakedown();
    return;
  }
  const spec = preyData.species[prey.species];
  takedown.helpers = helpersNear(prey);
  const s = strength();
  takedown.grip -= ((spec.struggle * 0.8) / s) * dt;
  // Unas 5 pulsaciones por segundo bastan contra una presa a tu medida.
  takedown.grip += presses * GRIP_PER_PRESS * (0.6 + 0.4 * s);
  takedown.grip += takedown.helpers * 0.22 * dt;
  player.needs.energy = Math.max(0, player.needs.energy - 0.02 * dt);

  if (takedown.grip >= 1) {
    killPrey(prey);
    journal.stats.kills++;
    events.emit('subtitle', { text: `Has abatido un ${spec.label.toLowerCase()}`, seconds: 3 });
    recordMilestone('first-kill', `Primera presa: un ${spec.label.toLowerCase()}`);
    recordMilestone(`kill:${prey.species}`, `Primera caza de ${spec.label.toLowerCase()}`, true);
    endTakedown();
  } else if (takedown.grip <= 0) {
    releasePrey(prey, player.position.x, player.position.z);
    events.emit('subtitle', { text: `El ${spec.label.toLowerCase()} se ha zafado`, seconds: 2.5 });
    takedown.cooldown = 2.5;
    endTakedown();
  }
}

function endTakedown(): void {
  takedown.active = false;
  takedown.prey = null;
  takedown.grip = 0;
  takedown.helpers = 0;
}

export function resetTakedown(): void {
  endTakedown();
  takedown.cooldown = 0;
}
