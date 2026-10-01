import lionData from '../data/lion.json';
import { events } from '../core/events';
import { clamp } from '../core/math';
import { player } from '../entities/player/playerState';
import { hasSpecies } from './species';

const N = lionData.needs;

export type Activity = 'rest' | 'idle' | 'walk' | 'trot' | 'run' | 'swim';

interface NeedsContext {
  /** Horas de juego transcurridas en este frame (incluye el avance rápido). */
  gameHours: number;
  /** Segundos reales del frame (para las acciones). */
  dt: number;
  activity: Activity;
  isCub: boolean;
  nearFamily: boolean;
}

/** Umbrales que disparan avisos (una vez por cruce). */
const warned = { hungry: false, thirsty: false, tired: false, lonely: false };

/**
 * Metabolismo del jugador: hambre, sed, energía, salud y vínculo social, con tasas
 * reales escaladas al calendario del juego (data/lion.json → needs).
 */
export function updateNeeds(ctx: NeedsContext): void {
  const n = player.needs;
  const h = ctx.gameHours;
  const age = ctx.isCub ? 'cub' : 'adult';

  n.satiety -= N.satietyLossPerHour[age] * h;
  n.hydration -= N.hydrationLossPerHour[age] * h * (hasSpecies('kalahari') ? 0.65 : 1);
  n.energy += N.energyPerHour[ctx.activity] * h * (ctx.activity === 'rest' && n.bond < 0.2 ? 0.5 : 1);

  // Acciones sostenidas (por segundo real).
  if (player.action === 'nurse') {
    n.satiety += N.nursePerSecond.satiety * ctx.dt;
    n.hydration += N.nursePerSecond.hydration * ctx.dt;
    n.bond += 0.02 * ctx.dt;
  } else if (player.action === 'drink') {
    n.hydration += N.drinkPerSecond * ctx.dt;
  } else if (player.action === 'eat') {
    n.satiety += N.eatPerSecond * ctx.dt;
    n.hydration += N.eatPerSecond * 0.3 * ctx.dt; // parte del agua sale de la presa
  }

  n.bond += (ctx.nearFamily ? N.bondGainPerHourWithFamily : -N.bondLossPerHourAlone) * h;

  // Salud: se pierde con hambre o sed extremas, se recupera si todo va bien.
  const starving = n.satiety <= 0.001;
  const parched = n.hydration <= 0.001;
  if (starving || parched) {
    n.health -= N.healthLossPerHourStarving * h * (starving && parched ? 1.6 : 1);
    player.lastDamage = parched ? 'thirst' : 'starvation';
  } else if (n.health > 0.001 && n.satiety > 0.3 && n.hydration > 0.3 && n.energy > 0.15) {
    n.health += N.healthRegenPerHour * h;
  }

  n.satiety = clamp(n.satiety, 0, 1);
  n.hydration = clamp(n.hydration, 0, 1);
  n.energy = clamp(n.energy, 0, 1);
  n.health = clamp(n.health, 0, 1);
  n.bond = clamp(n.bond, 0, 1);

  warnOnce('hungry', n.satiety < 0.25, ctx.isCub ? 'Tienes hambre: busca a tu madre para mamar (E)' : 'Tienes hambre');
  warnOnce('thirsty', n.hydration < 0.25, 'Tienes sed: busca agua');
  warnOnce('tired', n.energy < 0.15, 'Estás agotado: túmbate a descansar (Z)');
  warnOnce('lonely', n.bond < 0.2, 'Te sientes solo y vulnerable lejos de tu familia');
}

function warnOnce(key: keyof typeof warned, condition: boolean, text: string): void {
  if (condition && !warned[key]) {
    warned[key] = true;
    events.emit('subtitle', { text, seconds: 4 });
  } else if (!condition) {
    warned[key] = false;
  }
}

/** Penalización de velocidad por agotamiento y heridas. */
export function needsSpeedFactor(): number {
  const n = player.needs;
  let f = 1;
  if (n.energy < 0.12) f *= 0.6;
  if (n.health < 0.3) f *= 0.75;
  return f;
}
