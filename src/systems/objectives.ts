import lionData from '../data/lion.json';
import preyData from '../data/prey.json';
import { events } from '../core/events';
import { useGame } from '../core/store';
import { herds, nearestPrey } from '../entities/prey/preyState';
import { mother } from '../entities/npc/npcState';
import { player } from '../entities/player/playerState';
import { hasMilestone, recordMilestone } from './journal';
import { stageObjective } from './lifeStage';

interface Objective {
  milestone: string;
  text: string;
}

/**
 * Primera hora de vida: una cadena de objetivos que enseña las mecánicas mientras cuenta
 * la historia del cachorro. Cada objetivo se completa al registrarse su hito.
 */
const CUB_CHAIN: Objective[] = [
  { milestone: 'first-steps', text: 'Explora: da tus primeros pasos fuera de la madriguera' },
  { milestone: 'first-nurse', text: 'Tienes hambre: acércate a tu madre y pulsa E para mamar' },
  {
    milestone: 'first-pounce',
    text: 'Juega con tus hermanos: agáchate (C), acércate sin que te vean y salta (Espacio) sobre uno',
  },
  { milestone: 'family-rest', text: 'Túmbate junto a tu familia (Z): los leones descansan hasta 20 horas al día' },
  { milestone: 'mother-returned', text: 'Descansa cerca de la madriguera: cuando caiga la tarde tu madre saldrá a cazar' },
  { milestone: 'first-meat', text: 'Tu madre ha traído un impala: acércate y pulsa E para comer' },
  { milestone: 'den-move', text: 'Quédate cerca de tu madre: pronto trasladará la camada' },
  { milestone: 'first-drink', text: 'Tienes sed: acércate a la orilla de la poza y pulsa E para beber' },
];

/**
 * Etapa juvenil (6–24 meses): aprender a cazar observando a los adultos, respetar la
 * jerarquía en la presa y conseguir la primera captura propia.
 */
const JUVENILE_CHAIN: Objective[] = [
  { milestone: 'watched-hunt', text: 'Acompaña a tu madre cuando salga de caza y observa cómo acechan las leonas' },
  { milestone: 'waited-turn', text: 'Espera tu turno en la presa y come cuando los adultos se aparten (E)' },
  { milestone: 'spotted-herd', text: 'Explora y localiza una manada de presas por tu cuenta (mapa: M)' },
  {
    milestone: 'stalk-close',
    text: 'Acecha a una presa: agachado (C), con el viento en la cara, hasta menos de 20 m sin que te detecte',
  },
  { milestone: 'first-kill', text: 'Consigue tu primera presa: un facóquero o un impala. Carga desde muy cerca (Shift)' },
];

function activeChain(): Objective[] | null {
  const stage = useGame.getState().lifeStage;
  if (stage === 'cub') return CUB_CHAIN;
  if (stage === 'juvenile') return JUVENILE_CHAIN;
  return null;
}

export function currentObjective(override: string | null): string {
  if (override) return override;
  const chain = activeChain();
  const next = chain?.find((o) => !hasMilestone(o.milestone));
  if (next) return next.text;
  const { lifeStage, sex, lifeRole } = useGame.getState();
  // El papel social manda sobre la edad una vez fuera de la manada natal.
  if (lifeRole === 'king') return 'Defiende tu reino de los nómadas, marca el territorio (Y) y engendra cachorros con tus leonas.';
  if (lifeRole === 'nomad' && sex === 'male') {
    return lifeStage === 'subadult'
      ? 'Sobrevive como nómada: caza solo y propón alianzas (Y) a otros machos jóvenes.'
      : 'Busca una manada con un residente débil o sin machos y desafíalo: conquista tu reino.';
  }
  return stageObjective(lifeStage, sex);
}

/** Número de objetivos de la etapa completados (para el HUD). */
export function chainProgress(): { done: number; total: number } {
  const chain = activeChain() ?? [];
  return { done: chain.filter((o) => hasMilestone(o.milestone)).length, total: chain.length };
}

const timers = { nurse: 0, eat: 0, drink: 0, familyRest: 0 };

/** Comprueba cada frame las condiciones de los hitos que dependen del estado del jugador. */
export function updateObjectiveTriggers(dt: number): void {
  if (!player.alive) return;
  if (Math.hypot(player.position.x - mother.home.x, player.position.z - mother.home.z) > 12) {
    recordMilestone('first-steps', 'Primeros pasos fuera de la madriguera');
  }
  timers.nurse = player.action === 'nurse' ? timers.nurse + dt : 0;
  timers.eat = player.action === 'eat' ? timers.eat + dt : 0;
  timers.drink = player.action === 'drink' ? timers.drink + dt : 0;
  if (timers.nurse > 2) recordMilestone('first-nurse', `Primera toma de leche de ${mother.name}`);
  if (timers.eat > 2) recordMilestone('first-meat', 'Primer bocado de carne');
  if (timers.drink > 2) recordMilestone('first-drink', 'Primer trago de agua en una poza');

  const nearMother =
    mother.active && Math.hypot(player.position.x - mother.position.x, player.position.z - mother.position.z) < 10;
  timers.familyRest = player.resting && nearMother ? timers.familyRest + dt : 0;
  if (timers.familyRest > 10) recordMilestone('family-rest', 'Siesta junto a la familia');

  // --- Etapa juvenil ---
  if (player.ageYears >= lionData.needs.weaningYears) {
    if (recordMilestone('weaned', 'Destete: ya no mamas, ahora dependes de la carne')) {
      events.emit('subtitle', { text: `${mother.name} ya no te deja mamar: ahora comerás carne de las cacerías`, seconds: 5 });
    }
  }
  if (player.ageYears >= 0.5 && timers.eat > 2) recordMilestone('waited-turn', 'Comiste tras los adultos, como manda la jerarquía');
  for (const h of herds) {
    if (!h.spawned || h.size <= 0) continue;
    const d = Math.hypot(h.center.x - player.position.x, h.center.z - player.position.z);
    if (d < 130 && Math.hypot(h.center.x - mother.position.x, h.center.z - mother.position.z) > 100) {
      recordMilestone('spotted-herd', `Localizaste por tu cuenta una manada de ${preyData.species[h.species].label.toLowerCase()}s`);
    }
  }
  if (player.crouching && player.ageYears >= 0.5) {
    const prey = nearestPrey(player.position.x, player.position.z, 20, (p) => p.awareness < 0.45 && p.state !== 'flee');
    if (prey) recordMilestone('stalk-close', `Acechaste a un ${preyData.species[prey.species].label.toLowerCase()} a menos de 20 m sin ser visto`);
  }
}
