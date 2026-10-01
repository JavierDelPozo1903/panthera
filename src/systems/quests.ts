import { events } from '../core/events';
import { useGame } from '../core/store';
import { allies } from '../entities/npc/wildLions';
import { aliveSiblings } from '../entities/npc/npcState';
import { player } from '../entities/player/playerState';
import { scentMarks } from '../world/territories';
import { hasMilestone, journal, recordMilestone } from './journal';
import { gainEssence, grantRelic, progression } from './progression';
import type { RelicId } from './relics';

/**
 * Misiones: principales (la historia de cachorro a rey), de manada, cacerías y pruebas.
 * Cada paso se comprueba contra el estado real del juego, así que se completan jugando.
 */
export type QuestKind = 'main' | 'pride' | 'hunt' | 'trial';

export const QUEST_KIND_LABEL: Record<QuestKind, string> = {
  main: 'Principales',
  pride: 'Manada',
  hunt: 'Cacerías',
  trial: 'Pruebas',
};

export interface QuestStep {
  text: string;
  done: () => boolean;
}

export interface QuestDef {
  id: string;
  kind: QuestKind;
  title: string;
  summary: string;
  steps: QuestStep[];
  /** Cuándo aparece en el cuaderno. */
  available: () => boolean;
  reward: { essence: number; relic?: RelicId };
}

const age = () => player.ageYears;
const male = () => useGame.getState().sex === 'male';
const beat = (id: string) => () => progression.bossesDefeated.includes(id);
const playerMarks = () => scentMarks.filter((m) => m.byPlayer).length;

/** Distancias recorridas por las regiones: se rellena desde el mundo (regiones visitadas). */
export const visited = new Set<string>();

export const QUESTS: QuestDef[] = [
  // --- Principales ---
  {
    id: 'first-steps',
    kind: 'main',
    title: 'Los primeros pasos',
    summary: 'Diez semanas de vida. El mundo empieza en la madriguera y termina donde alcanza la vista.',
    available: () => true,
    reward: { essence: 150 },
    steps: [
      { text: 'Mama de tu madre', done: () => journal.stats.nursed > 0 },
      { text: 'Bebe en la poza', done: () => journal.stats.drinks > 0 },
      { text: 'Embosca a un hermano jugando', done: () => journal.stats.pounces > 0 },
    ],
  },
  {
    id: 'first-hunt',
    kind: 'main',
    title: 'La primera caza',
    summary: 'Las leonas no esperan a nadie. Aprende mirando, come cuando te toque y caza por tu cuenta.',
    available: () => age() >= 0.45,
    reward: { essence: 300 },
    steps: [
      { text: 'Acompaña una cacería de la manada', done: () => journal.stats.huntsWatched > 0 },
      { text: 'Come de una presa', done: () => journal.stats.meals > 0 },
      { text: 'Abate tu primera presa', done: () => journal.stats.kills > 0 },
    ],
  },
  {
    id: 'broken-moon',
    kind: 'main',
    title: 'La reina de la Luna Rota',
    summary: 'Las hienas hablan de una matriarca que no muere. Su claro está sembrado de huesos de leones.',
    available: () => age() >= 1.5,
    reward: { essence: 400 },
    steps: [
      { text: 'Cumple dos años', done: () => age() >= 2 },
      { text: 'Encuentra el Cementerio de Huesos', done: () => hasMilestone('found:matriarch') || beat('matriarch')() },
      { text: 'Vence a La Matriarca', done: beat('matriarch') },
    ],
  },
  {
    id: 'delta',
    kind: 'main',
    title: 'Aguas que muerden',
    summary: 'Más allá de la sabana, el delta. Algo muy viejo duerme bajo sus aguas.',
    available: beat('matriarch'),
    reward: { essence: 900 },
    steps: [
      { text: 'Entra en el Delta del Okavango', done: () => visited.has('delta') },
      { text: 'Reclama la guarida del delta', done: () => hasMilestone('den:delta') },
      { text: 'Vence al Señor del Delta', done: beat('crocodile') },
    ],
  },
  {
    id: 'kalahari',
    kind: 'main',
    title: 'La sombra en las dunas',
    summary: 'Un león de melena negra reina en el desierto. Dicen que pelea igual que tú.',
    available: beat('crocodile'),
    reward: { essence: 1400 },
    steps: [
      { text: 'Cruza al Kalahari', done: () => visited.has('kalahari') },
      { text: 'Vence a La Sombra del Kalahari', done: beat('shadowLion') },
    ],
  },
  {
    id: 'congo',
    kind: 'main',
    title: 'El que nadie ha visto',
    summary: 'En la selva hay huellas sin dueño. Solo sale cuando cae la noche.',
    available: beat('shadowLion'),
    reward: { essence: 1900 },
    steps: [
      { text: 'Adéntrate en la selva del Congo', done: () => visited.has('congo') },
      { text: 'Vence a El Fantasma (de noche)', done: beat('leopard') },
    ],
  },
  {
    id: 'mountains',
    kind: 'main',
    title: 'El guardián de la niebla',
    summary: 'En los montes, la niebla tiene cuernos.',
    available: beat('leopard'),
    reward: { essence: 2500 },
    steps: [
      { text: 'Sube a los montes Rwenzori', done: () => visited.has('mountains') },
      { text: 'Vence al Guardián de la Niebla', done: beat('buffalo') },
    ],
  },
  {
    id: 'throne',
    kind: 'main',
    title: 'El rey de reyes',
    summary: 'Tres reliquias abren el cráter. Dentro, una coalición que nunca ha perdido.',
    available: beat('buffalo'),
    reward: { essence: 5000 },
    steps: [
      { text: 'Entra en el cráter del Ngorongoro', done: () => visited.has('crater') },
      { text: 'Derrota al Rey de Reyes', done: beat('kings') },
    ],
  },
  {
    id: 'own-throne',
    kind: 'main',
    title: 'El trono vacío',
    summary: 'Ningún macho hereda una manada: se conquista.',
    available: () => male() && age() >= 2,
    reward: { essence: 1500 },
    steps: [
      { text: 'Deja la manada natal', done: () => useGame.getState().lifeRole !== 'pride' },
      { text: 'Forma una coalición', done: () => allies().length > 0 || hasMilestone('coalition') },
      { text: 'Conquista una manada', done: () => useGame.getState().lifeRole === 'king' },
    ],
  },
  {
    id: 'matriarch-path',
    kind: 'main',
    title: 'La que guía',
    summary: 'Una leona no conquista: sostiene la manada entera sobre los hombros.',
    available: () => !male() && age() >= 3,
    reward: { essence: 1500 },
    steps: [
      { text: 'Primer celo', done: () => hasMilestone('first-estrus') },
      { text: 'Da a luz a tu primera camada', done: () => journal.stats.cubsBorn > 0 },
    ],
  },
  // --- Manada ---
  {
    id: 'blood-brothers',
    kind: 'pride',
    title: 'Hermanos de sangre',
    summary: 'Más de la mitad de los cachorros no llega al año. Que los tuyos sí.',
    available: () => true,
    reward: { essence: 250, relic: 'rainStone' },
    steps: [{ text: 'Llega al año con al menos un hermano vivo', done: () => age() >= 1 && aliveSiblings().length > 0 }],
  },
  {
    id: 'litter-guard',
    kind: 'pride',
    title: 'Guardián de la camada',
    summary: 'Ahora te toca a ti proteger a los pequeños.',
    available: () => journal.stats.cubsBorn > 0,
    reward: { essence: 600 },
    steps: [{ text: 'Que tus hijos cumplan medio año', done: () => hasMilestone('cubs:half-year') }],
  },
  // --- Cacerías ---
  {
    id: 'three-preys',
    kind: 'hunt',
    title: 'Cazador',
    summary: 'Una presa es suerte. Tres son oficio.',
    available: () => age() >= 0.8,
    reward: { essence: 400 },
    steps: [{ text: 'Abate tres presas', done: () => journal.stats.kills >= 3 }],
  },
  {
    id: 'ten-preys',
    kind: 'hunt',
    title: 'El terror de las manadas',
    summary: 'Los vigías de las cebras ya conocen tu olor.',
    available: () => journal.stats.kills >= 3,
    reward: { essence: 1000 },
    steps: [{ text: 'Abate diez presas', done: () => journal.stats.kills >= 10 }],
  },
  // --- Pruebas ---
  {
    id: 'trial-roar',
    kind: 'trial',
    title: 'Prueba del rugido',
    summary: 'Un rugido se oye a ocho kilómetros. Que lo oigan.',
    available: () => age() >= 1,
    reward: { essence: 150 },
    steps: [{ text: 'Ruge diez veces', done: () => journal.stats.roars >= 10 }],
  },
  {
    id: 'trial-marks',
    kind: 'trial',
    title: 'Prueba del territorio',
    summary: 'Un territorio sin marcas no es de nadie.',
    available: () => male() && age() >= 2,
    reward: { essence: 250 },
    steps: [{ text: 'Deja cinco marcas de olor', done: () => playerMarks() >= 5 || hasMilestone('trial:marks') }],
  },
  {
    id: 'trial-distance',
    kind: 'trial',
    title: 'Prueba de la resistencia',
    summary: 'El que sabe dónde está el agua es el que ha caminado.',
    available: () => age() >= 0.5,
    reward: { essence: 300, relic: 'secretaryFeather' },
    steps: [{ text: 'Recorre 10 km', done: () => journal.stats.distance >= 10000 }],
  },
  {
    id: 'trial-warrior',
    kind: 'trial',
    title: 'Prueba del guerrero',
    summary: 'La primera cicatriz duele. Las demás enseñan.',
    available: () => age() >= 2,
    reward: { essence: 500, relic: 'duelScar' },
    steps: [{ text: 'Gana tres peleas contra leones', done: () => journal.stats.fightsWon >= 3 }],
  },
];

export type QuestStatus = 'hidden' | 'active' | 'done';

export const questState = {
  status: {} as Record<string, QuestStatus>,
  step: {} as Record<string, number>,
  tracked: 'first-steps' as string | null,
};

export const questById = (id: string): QuestDef | undefined => QUESTS.find((q) => q.id === id);

export function resetQuests(data?: { status: Record<string, QuestStatus>; step: Record<string, number>; tracked: string | null; visited?: string[] }): void {
  questState.status = {};
  questState.step = {};
  questState.tracked = 'first-steps';
  visited.clear();
  for (const q of QUESTS) {
    questState.status[q.id] = 'hidden';
    questState.step[q.id] = 0;
  }
  if (data) {
    Object.assign(questState.status, data.status);
    Object.assign(questState.step, data.step);
    questState.tracked = data.tracked;
    for (const v of data.visited ?? []) visited.add(v);
  }
}

export function snapshotQuests() {
  return { status: { ...questState.status }, step: { ...questState.step }, tracked: questState.tracked, visited: [...visited] };
}

export function trackQuest(id: string | null): void {
  questState.tracked = id;
}

/** Comprueba las misiones (llamar unas pocas veces por segundo). */
export function updateQuests(): void {
  for (const q of QUESTS) {
    const st = questState.status[q.id] ?? 'hidden';
    if (st === 'done') continue;
    if (st === 'hidden') {
      if (!q.available()) continue;
      questState.status[q.id] = 'active';
      questState.step[q.id] = 0;
      if (q.kind === 'main' || !questState.tracked || questState.status[questState.tracked] === 'done') questState.tracked = q.id;
      if (q.id !== 'first-steps') events.emit('subtitle', { text: `Nueva misión: ${q.title}`, seconds: 3 });
    }
    let step = questState.step[q.id] ?? 0;
    while (step < q.steps.length && q.steps[step].done()) step++;
    questState.step[q.id] = step;
    if (step >= q.steps.length) completeQuest(q);
  }
}

function completeQuest(q: QuestDef): void {
  questState.status[q.id] = 'done';
  gainEssence(q.reward.essence, q.title);
  if (q.reward.relic && grantRelic(q.reward.relic)) {
    events.emit('subtitle', { text: `Recompensa: una reliquia nueva (míralas en la guarida)`, seconds: 4 });
  }
  recordMilestone(`quest:${q.id}`, `Misión cumplida: ${q.title}`);
  if (questState.tracked === q.id) {
    const next = QUESTS.find((o) => questState.status[o.id] === 'active' && o.kind === 'main') ?? QUESTS.find((o) => questState.status[o.id] === 'active');
    questState.tracked = next?.id ?? null;
  }
}

/** Texto del paso actual de la misión seguida (para el HUD). */
export function trackedObjective(): { title: string; step: string; index: number; total: number } | null {
  const q = questState.tracked ? questById(questState.tracked) : null;
  if (!q || questState.status[q.id] !== 'active') return null;
  const i = Math.min(questState.step[q.id] ?? 0, q.steps.length - 1);
  return { title: q.title, step: q.steps[i].text, index: i, total: q.steps.length };
}
