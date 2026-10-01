import * as THREE from 'three';
import { clock } from '../core/clock';
import { events } from '../core/events';
import { carcasses } from '../entities/carcass/carcassState';
import { useGame } from '../core/store';
import { mother, pride, type MotherState } from '../entities/npc/npcState';
import { herds, type Herd } from '../entities/prey/preyState';
import { player } from '../entities/player/playerState';
import { hasMilestone, journal, recordMilestone } from '../systems/journal';
import { relocationSite } from '../world/den';
import type { WorldData } from '../world/WorldData';
import { clanActive, hyenaDanger, spawnClan } from './hyenaBrain';
import { groupHunt, startGroupHunt, updateGroupHunt } from './huntBrain';
import { motherHearsCall, motherIsAway, startHunt, startRelocation } from './motherBrain';
import { distXZ } from './steering';

/**
 * Director de la primera hora de vida: decide cuándo sale la madre a cazar, cuándo
 * aparecen las hienas y cuándo se traslada la camada, para que la experiencia tenga ritmo
 * (tensión → alivio) sin dejar de ser una simulación.
 */
export const director = {
  /** Segundos reales de partida. */
  elapsed: 0,
  danger: 0,
  /** Texto de objetivo que sustituye al de la cadena durante un evento. */
  override: null as string | null,
  lastHuntEnd: -1e9,
  lastRelocation: -1e9,
  firstMealAt: -1,
  hyenaSpawnAt: -1,
  hyenaCooldown: 240,
  huntHadHyenas: false,
  stageStart: 0,
};

let prevMotherState: MotherState = 'rest';
const tmp = new THREE.Vector3();

export function resetDirector(): void {
  director.elapsed = 0;
  director.danger = 0;
  director.override = null;
  director.lastHuntEnd = -1e9;
  director.lastRelocation = -1e9;
  director.firstMealAt = -1;
  director.hyenaSpawnAt = -1;
  director.hyenaCooldown = 240;
  director.huntHadHyenas = false;
  prevMotherState = mother.state;
}

// El maullido del cachorro es una llamada de auxilio.
events.on('player:call', () => motherHearsCall());

const CALM: ReadonlySet<MotherState> = new Set(['rest', 'idle', 'wander', 'follow']);
const eveningOrNight = () => clock.timeOfDay > 16.5 || clock.timeOfDay < 7;

/** Juveniles y mayores: primera cacería visible al minuto y luego cada ~10 min. */
function juvenileHuntDue(t: number, meatAround: boolean): boolean {
  if (useGame.getState().lifeStage === 'cub' || meatAround || groupHunt.active) return false;
  if (!hasMilestone('watched-hunt')) return t - director.lastHuntEnd > 60 && t - director.stageStart > 45;
  return t - director.lastHuntEnd > 600;
}

function nearestHerd(maxDist: number): Herd | null {
  let best: Herd | null = null;
  let bestD = maxDist;
  for (const h of herds) {
    if (h.size <= 0) continue;
    const d = distXZ(h.center, mother.position);
    if (d < bestD) {
      bestD = d;
      best = h;
    }
  }
  return best;
}

/** ¿Hay adultos comiendo una presa que aún está casi entera? (los juveniles esperan). */
export function adultsFeasting(): boolean {
  if (player.ageYears < 0.5 || player.ageYears >= 2) return false;
  const lions = [mother, ...pride];
  return carcasses.some(
    (c) =>
      c.meatKg > c.maxKg * 0.55 &&
      lions.some((l) => l.alive && l.clip === 'eat' && distXZ(l.position, c.position) < 3) &&
      distXZ(player.position, c.position) < 30,
  );
}

let prevStage = '';

export function updateDirector(world: WorldData, dt: number, rng: () => number): void {
  director.elapsed += dt;
  const stage = useGame.getState().lifeStage;
  if (stage !== prevStage) {
    prevStage = stage;
    director.stageStart = director.elapsed;
  }
  director.hyenaCooldown -= dt;
  const t = director.elapsed;
  const caring = mother.active && mother.alive;
  const meatAround = carcasses.some((c) => c.meatKg > 0.5);

  if (caring && CALM.has(mother.state) && player.alive) {
    // Salida de caza: la primera tras la siesta en familia (o a los 8 min); después, al caer la tarde.
    // No se caza si aún queda carne de la última presa.
    const firstHunt =
      !meatAround && !hasMilestone('mother-returned') && t > 150 && (hasMilestone('family-rest') || t > 480);
    const laterHunt = !meatAround && hasMilestone('mother-returned') && t - director.lastHuntEnd > 900 && eveningOrNight();
    const relocationDue =
      hasMilestone('first-meat') &&
      ((!hasMilestone('den-move') && t - director.firstMealAt > 60) || t - director.lastRelocation > 1500);

    if (relocationDue) {
      const site = relocationSite(world, mother.home.x, mother.home.z, rng);
      tmp.set(site.x, world.heightAt(site.x, site.z), site.z);
      startRelocation(tmp);
      director.lastRelocation = t;
    } else if (juvenileHuntDue(t, meatAround)) {
      // Juveniles: la cacería es visible y se puede acompañar.
      const herd = nearestHerd(900);
      if (herd) {
        startGroupHunt(herd);
        director.lastHuntEnd = t;
      } else {
        startHunt(world, rng);
      }
    } else if ((firstHunt || laterHunt) && useGame.getState().lifeStage === 'cub') {
      startHunt(world, rng);
      director.huntHadHyenas = false;
      director.hyenaSpawnAt = firstHunt ? t + 30 : rng() < 0.6 ? t + 30 + rng() * 40 : -1;
    }
  }
  if (groupHunt.active) updateGroupHunt(world, dt);
  else if (groupHunt.lastResult) {
    // Fin de una cacería en grupo.
    director.lastHuntEnd = t;
    groupHunt.lastResult = null;
  }

  // Hienas mientras la madre caza (el primer encuentro está garantizado).
  if (motherIsAway() && director.hyenaSpawnAt > 0 && t >= director.hyenaSpawnAt && !clanActive()) {
    spawnClan(world, mother.home.x, mother.home.z, director.huntHadHyenas ? 2 : 3, rng);
    director.huntHadHyenas = true;
    director.hyenaSpawnAt = -1;
  }

  // Clanes errantes de noche (cuando la madre está presente son menos peligrosos).
  if (!clanActive() && clock.isNight && director.hyenaCooldown <= 0 && rng() < dt / 240) {
    spawnClan(world, player.position.x, player.position.z, 2 + Math.floor(rng() * 3), rng);
    director.hyenaCooldown = 360;
  }

  // Transiciones de la madre → hitos del diario.
  if (prevMotherState !== mother.state) {
    if (prevMotherState === 'huntReturn') {
      director.lastHuntEnd = t;
      recordMilestone('mother-returned', `${mother.name} volvió de su cacería`);
      if (director.huntHadHyenas && player.alive) {
        recordMilestone('survived-hyenas', 'Sobreviviste a tu primer encuentro con las hienas');
      }
    }
    if (prevMotherState === 'relocate' && mother.state === 'rest') {
      if (distXZ(player.position, mother.home) < 25) {
        journal.stats.denMoves++;
        recordMilestone('den-move', 'La camada se ha trasladado a una nueva madriguera');
      }
    }
    prevMotherState = mother.state;
  }
  if (hasMilestone('first-meat') && director.firstMealAt < 0) director.firstMealAt = t;

  director.danger = hyenaDanger();
  director.override = eventText();
}

function eventText(): string | null {
  if (!player.alive) return null;
  if (groupHunt.active) {
    switch (groupHunt.phase) {
      case 'approach':
        return `Acompaña a ${mother.name} de caza: síguela de lejos y agachado (C)`;
      case 'stalk':
        return 'Las leonas acechan: quédate quieto y agachado o espantarás a las presas';
      case 'charge':
        return '¡Carrera! Las leonas cargan contra la presa';
      case 'struggle':
        return '¡La han alcanzado! Acércate a ayudar a sujetarla';
      default:
        return null;
    }
  }
  if (adultsFeasting()) return 'Los adultos comen primero: espera tu turno junto a la presa';
  if (director.danger >= 1) return '¡Te persiguen las hienas! Agáchate en la hierba alta (C) o llama a tu madre (R)';
  if (director.danger > 0.4 && motherIsAway()) return 'Hay hienas cerca y tu madre no está: escóndete y no te muevas';
  if (motherIsAway()) return `${mother.name} está cazando: quédate escondido cerca de la madriguera hasta que vuelva`;
  if (mother.state === 'huntReturn') return `${mother.name} regresa de la cacería`;
  if (mother.state === 'relocate') return `Sigue a ${mother.name} hasta la nueva madriguera`;
  if (mother.state === 'fetch') return `Vuelve con ${mother.name}: te has alejado demasiado`;
  return null;
}
