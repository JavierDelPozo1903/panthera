import lionData from '../data/lion.json';
import { clock } from '../core/clock';
import { events } from '../core/events';
import { useGame } from '../core/store';
import { distXZ, steerTowards, clipForSpeed } from '../ai/steering';
import {
  createWildLion,
  FEMALE_NAMES,
  MALE_NAMES,
  playerCubs,
  wildLions,
  type ReproState,
  type WildLion,
} from '../entities/npc/wildLions';
import { player } from '../entities/player/playerState';
import { femalesOf, playerTerritory, residentsOf, territories } from '../world/territories';
import type { WorldData } from '../world/WorldData';
import { inherit, playerTraits, randomTraits, type Traits } from './genetics';
import { journal, recordMilestone } from './journal';

const R = lionData.reproduction;
const L = lionData.locomotion;
/** Distancia a la que se puede cortejar a la pareja (tecla Y). */
export const MATE_RANGE = 4;
/** Edad a la que un cachorro deja de depender de su madre y ella vuelve a ciclar. */
const DEPENDENT_YEARS = 1.5;
/** Edad a la que los hijos dejan la condición de cachorro. */
const CUB_UNTIL_YEARS = 2.5;

/**
 * Convierte días biológicos (data/lion.json) en días de juego. El calendario está
 * comprimido: un año dura `clock.daysPerYear` días de juego, así que la gestación de
 * 110 días reales pasa en menos de dos días de juego.
 */
export const bioDays = (days: number): number => (days * clock.daysPerYear) / 365;

/** Estado reproductivo de la jugadora (solo hembras). */
export const playerRepro = {
  state: 'none' as ReproState,
  /** Días de juego restantes del celo o la gestación. */
  timer: 0,
  /** Días de juego hasta el próximo celo. */
  nextEstrus: 0,
  /** Rasgos del padre de la camada en gestación. */
  mateTraits: null as Traits | null,
  mateName: '',
};

export function resetReproduction(data?: Partial<typeof playerRepro>): void {
  playerRepro.state = 'none';
  playerRepro.timer = 0;
  playerRepro.nextEstrus = bioDays(R.estrusIntervalDays);
  playerRepro.mateTraits = null;
  playerRepro.mateName = '';
  if (data) Object.assign(playerRepro, data);
}

const hasDependentCubs = (motherId: string): boolean =>
  wildLions.some((l) => l.alive && l.role === 'cub' && l.motherId === motherId && l.ageYears < DEPENDENT_YEARS);

/** Machos con los que puede aparearse la jugadora: el residente de su manada. */
function candidateMales(): { name: string; traits: Traits; position: { x: number; z: number } }[] {
  const list: { name: string; traits: Traits; position: { x: number; z: number } }[] = [];
  // El padre natal no cuenta: es el progenitor de la jugadora.
  for (const r of residentsOf(0)) list.push({ name: r.name, traits: r.traits, position: r.position });
  const own = playerTerritory();
  if (own) for (const r of residentsOf(own.id)) list.push({ name: r.name, traits: r.traits, position: r.position });
  return list;
}

/** Hembra en celo junto al rey jugador. */
function estrusFemaleNear(): WildLion | null {
  const t = playerTerritory();
  if (!t) return null;
  let best: WildLion | null = null;
  let bestD = MATE_RANGE;
  for (const f of femalesOf(t.id)) {
    if (f.reproState !== 'estrus') continue;
    const d = distXZ(f.position, player.position);
    if (d < bestD) {
      bestD = d;
      best = f;
    }
  }
  return best;
}

export interface MateOption {
  label: string;
  run: () => void;
}

/** ¿Hay una pareja disponible para aparearse ahora mismo? */
export function availableMate(): MateOption | null {
  if (!player.alive) return null;
  const { sex } = useGame.getState();
  if (sex === 'male') {
    if (player.ageYears < R.minBreedingYears.male) return null;
    const f = estrusFemaleNear();
    return f ? { label: `Aparearte con ${f.name}`, run: () => mateWithFemale(f) } : null;
  }
  if (playerRepro.state !== 'estrus') return null;
  const male = candidateMales().find((m) => distXZ(m.position, player.position) < MATE_RANGE);
  return male ? { label: `Aparearte con ${male.name}`, run: () => conceive(male.name, male.traits) } : null;
}

function conceive(mateName: string, traits: Traits): void {
  playerRepro.state = 'pregnant';
  playerRepro.timer = bioDays(R.gestationDays);
  playerRepro.mateTraits = { ...traits };
  playerRepro.mateName = mateName;
  events.emit('sfx', { sound: 'growl', x: player.position.x, y: player.position.y + 0.8, z: player.position.z, volume: 0.6 });
  events.emit('subtitle', { text: `Te apareas con ${mateName}. Dentro de unos 110 días nacerá tu camada`, seconds: 5 });
  recordMilestone('pregnant:first', `Primera gestación: el padre es ${mateName}`);
}

function mateWithFemale(f: WildLion): void {
  f.reproState = 'pregnant';
  f.reproTimer = bioDays(R.gestationDays);
  f.state = 'rest';
  f.timer = 30;
  f.mateTraits = { ...playerTraits };
  f.relation = 1;
  events.emit('sfx', { sound: 'growl', x: player.position.x, y: player.position.y + 0.8, z: player.position.z, volume: 0.6 });
  events.emit('subtitle', { text: `Te apareas con ${f.name}. Si todo va bien, tendrá tus cachorros`, seconds: 4 });
  recordMilestone('mated', `Te apareas por primera vez: con ${f.name}`);
}

function litterSize(rng: () => number): number {
  // Lo más habitual son 2–3 cachorros.
  const r = rng();
  const { min, max } = R.litterSize;
  if (r < 0.15) return min;
  if (r < 0.55) return Math.min(max, min + 1);
  if (r < 0.9) return Math.min(max, min + 2);
  return max;
}

function giveBirth(
  world: WorldData,
  motherId: string,
  motherTraits: Traits,
  fatherTraits: Traits,
  x: number,
  z: number,
  territoryId: number | null,
  rng: () => number,
): WildLion[] {
  const n = litterSize(rng);
  const cubs: WildLion[] = [];
  const used = new Set(wildLions.map((l) => l.name));
  for (let i = 0; i < n; i++) {
    const sex = rng() < 0.5 ? 'male' : 'female';
    const names = sex === 'male' ? MALE_NAMES : FEMALE_NAMES;
    let name = names[Math.floor(rng() * names.length)];
    for (let k = 0; k < 20 && used.has(name); k++) name = names[Math.floor(rng() * names.length)];
    used.add(name);
    const cx = x + Math.cos(i * 1.7) * 1.2;
    const cz = z + Math.sin(i * 1.7) * 1.2;
    const cub = createWildLion('cub', name, sex, 0.02, inherit(motherTraits, fatherTraits, rng), cx, world.heightAt(cx, cz), cz);
    cub.motherId = motherId;
    cub.playerChild = true;
    cub.territoryId = territoryId;
    cub.groupId = 500 + journal.stats.cubsBorn;
    wildLions.push(cub);
    cubs.push(cub);
  }
  journal.stats.cubsBorn += n;
  const names = cubs.map((c) => c.name).join(', ');
  recordMilestone('first-litter', `Nace tu primera camada: ${names}`);
  recordMilestone(`litter:${journal.stats.cubsBorn}`, `Nacen ${n} cachorro${n > 1 ? 's' : ''}: ${names}`, true);
  events.emit('subtitle', { text: `Han nacido ${n} cachorro${n > 1 ? 's' : ''}: ${names}`, seconds: 6 });
  events.emit('sfx', { sound: 'cubCall', x, y: world.heightAt(x, z) + 0.4, z, volume: 0.7 });
  return cubs;
}

/**
 * Ciclo reproductivo: celo, cortejo, gestación (~110 días biológicos), parto de camadas
 * de 1–4 cachorros con rasgos heredados y crecimiento de los hijos hasta independizarse.
 */
export function updateReproduction(world: WorldData, gameDays: number, dt: number, rng: () => number): void {
  if (!player.alive) return;
  const { sex, lifeRole } = useGame.getState();

  // --- La jugadora ---
  if (sex === 'female' && gameDays > 0) {
    if (playerRepro.state === 'pregnant') {
      playerRepro.timer -= gameDays;
      if (playerRepro.timer <= 0) {
        playerRepro.state = 'none';
        playerRepro.nextEstrus = bioDays(R.estrusIntervalDays) + DEPENDENT_YEARS * clock.daysPerYear;
        giveBirth(world, 'player', playerTraits, playerRepro.mateTraits ?? randomTraits(rng), player.position.x, player.position.z, 0, rng);
        playerRepro.mateTraits = null;
      }
    } else if (playerRepro.state === 'estrus') {
      playerRepro.timer -= gameDays;
      if (playerRepro.timer <= 0) {
        playerRepro.state = 'none';
        playerRepro.nextEstrus = bioDays(R.estrusIntervalDays);
        events.emit('subtitle', { text: 'El celo ha pasado', seconds: 3 });
      }
    } else if (player.ageYears >= R.minBreedingYears.female && !hasDependentCubs('player')) {
      playerRepro.nextEstrus -= gameDays;
      if (playerRepro.nextEstrus <= 0) {
        playerRepro.state = 'estrus';
        playerRepro.timer = bioDays(R.estrusDays);
        const male = candidateMales()[0];
        events.emit('subtitle', {
          text: male ? `Estás en celo: busca a ${male.name}, el macho de tu manada (Y)` : 'Estás en celo, pero no hay ningún macho en la manada',
          seconds: 5,
        });
        recordMilestone('first-estrus', 'Primer celo: ya eres una leona adulta');
      }
    }
  }

  // --- Los machos residentes cortejan a la jugadora en celo ---
  const courting = sex === 'female' && playerRepro.state === 'estrus';
  for (const r of residentsOf(0)) {
    if (r.state === 'fight' || r.state === 'flee' || r.state === 'leave') continue;
    if (courting && distXZ(r.position, player.position) < 300) {
      r.state = 'court';
      steerTowards(r, world, player.position.x + 1.5, player.position.z + 1.5, L.walkSpeedMs * 1.4, dt, { stopDistance: 2 });
      r.clip = clipForSpeed(r.speed, 1, 'idle');
    } else if (r.state === 'court') {
      r.state = 'rest';
      r.timer = 30;
    }
  }

  // --- Las leonas del rey ---
  const own = lifeRole === 'king' ? playerTerritory() : null;
  for (const t of territories) {
    for (const f of femalesOf(t.id)) updateFemaleCycle(world, f, gameDays, dt, own?.id === t.id, rng);
  }

  // --- Crecimiento de los hijos ---
  if (gameDays > 0) {
    const years = gameDays / clock.daysPerYear;
    for (const l of wildLions) {
      if (!l.alive) continue;
      l.ageYears += years;
      if (l.role === 'cub' && l.ageYears >= CUB_UNTIL_YEARS) {
        if (l.sex === 'female') {
          l.role = 'female';
          l.territoryId = l.territoryId ?? playerTerritory()?.id ?? 0;
          l.state = 'rest';
        } else {
          // Los hijos machos se marchan a vivir como nómadas.
          l.role = 'nomad';
          l.groupId = 700 + (l.groupId % 100);
          l.state = 'wander';
          l.territoryId = null;
          if (l.playerChild) events.emit('subtitle', { text: `Tu hijo ${l.name} deja la manada para buscar su propio camino`, seconds: 4 });
        }
      }
    }
  }
}

function updateFemaleCycle(world: WorldData, f: WildLion, gameDays: number, dt: number, kingIsPlayer: boolean, rng: () => number): void {
  if (gameDays > 0) {
    if (f.reproState === 'pregnant') {
      f.reproTimer -= gameDays;
      if (f.reproTimer <= 0) {
        f.reproState = 'none';
        f.nextEstrus = R.estrusIntervalDays + DEPENDENT_YEARS * 365;
        const fatherTraits = f.mateTraits ?? randomTraits(rng);
        f.mateTraits = null;
        if (kingIsPlayer) giveBirth(world, f.id, f.traits, fatherTraits, f.position.x, f.position.z, f.territoryId, rng);
      }
    } else if (f.reproState === 'estrus') {
      f.reproTimer -= gameDays;
      if (f.reproTimer <= 0) {
        f.reproState = 'none';
        f.nextEstrus = R.estrusIntervalDays;
        if (f.state === 'court') f.state = 'rest';
      }
    } else if (kingIsPlayer && f.ageYears >= R.minBreedingYears.female && !hasDependentCubs(f.id)) {
      // `nextEstrus` se guarda en días biológicos.
      f.nextEstrus -= (gameDays * 365) / clock.daysPerYear;
      if (f.nextEstrus <= 0) {
        f.reproState = 'estrus';
        f.reproTimer = bioDays(R.estrusDays);
        f.state = 'court';
        events.emit('subtitle', { text: `${f.name} está en celo y te busca (Y para aparearte)`, seconds: 5 });
      }
    }
  }
  // En celo, la leona busca al rey dentro del territorio.
  if (f.state === 'court' && f.reproState === 'estrus') {
    const d = distXZ(f.position, player.position);
    if (d < 400) {
      steerTowards(f, world, player.position.x - 1.5, player.position.z + 1.2, d > 30 ? L.trotSpeedMs : L.walkSpeedMs, dt, { stopDistance: 1.5 });
      f.clip = clipForSpeed(f.speed, 0.86, 'idle');
    } else {
      f.speed = 0;
      f.clip = 'idle';
    }
  } else if (f.state === 'court') {
    f.state = 'rest';
  }
}

/** Texto de estado reproductivo para el HUD (o null si no aplica). */
export function reproStatus(): string | null {
  const { sex } = useGame.getState();
  const toBioDays = (gameDays: number) => Math.max(1, Math.round((gameDays * 365) / clock.daysPerYear));
  if (sex === 'female') {
    if (playerRepro.state === 'estrus') return 'En celo';
    if (playerRepro.state === 'pregnant') return `Gestación · faltan ${toBioDays(playerRepro.timer)} días`;
    return null;
  }
  const t = playerTerritory();
  if (!t) return null;
  const pregnant = femalesOf(t.id).filter((f) => f.reproState === 'pregnant').length;
  const estrus = femalesOf(t.id).filter((f) => f.reproState === 'estrus').length;
  const parts: string[] = [];
  if (estrus) parts.push(`${estrus} en celo`);
  if (pregnant) parts.push(`${pregnant} preñada${pregnant > 1 ? 's' : ''}`);
  return parts.length ? `Leonas: ${parts.join(' · ')}` : null;
}

/** Hijos vivos del jugador. */
export const livingOffspring = playerCubs;
