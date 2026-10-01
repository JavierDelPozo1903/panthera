import lionData from '../data/lion.json';
import { events } from '../core/events';
import { clamp, lerp } from '../core/math';
import { useGame, type LifeRole } from '../core/store';
import { mother, prideFather, siblings } from '../entities/npc/npcState';
import { allies, createWildLion, wildLions, type WildLion, MALE_NAMES } from '../entities/npc/wildLions';
import { player } from '../entities/player/playerState';
import { distXZ } from '../ai/steering';
import { femalesOf, residentsOf, territories, type Territory } from '../world/territories';
import type { WorldData } from '../world/WorldData';
import { combat, onCombatEnd, startCombat } from './combat';
import { combatStrength, playerTraits, randomTraits } from './genetics';
import { journal, recordMilestone } from './journal';

const M = lionData.maturity;
/** Edad mínima para quedarse con una manada conquistada. */
const CONQUEST_AGE = 3.5;
const MAX_ALLIES = 3;

export const lifeRoleState = {
  /** Edad a la que el residente expulsa al joven macho (2–4 años). */
  dispersalAge: 2.6,
  evicting: false,
  evictTimer: 0,
  takeoverDone: false,
  /** Segundos hasta el próximo desafío al rey. */
  nextChallenge: 900,
  kingSinceYears: 0,
};

export function setLifeRole(role: LifeRole): void {
  useGame.setState({ lifeRole: role });
}

export function resetLifeRole(rng: () => number, role: LifeRole = 'pride'): void {
  lifeRoleState.dispersalAge = lerp(M.maleDispersalYears.min + 0.3, M.maleDispersalYears.min + 1.2, rng());
  lifeRoleState.evicting = false;
  lifeRoleState.evictTimer = 0;
  lifeRoleState.takeoverDone = false;
  lifeRoleState.nextChallenge = 900;
  setLifeRole(role);
}

const natal = (): Territory | undefined => territories.find((t) => t.id === 0);

export function playerStrength(): number {
  return combatStrength(useGame.getState().sex, player.ageYears, playerTraits.size, player.needs.health, playerTraits.maneDarkness);
}

function lionStrength(l: WildLion): number {
  return combatStrength(l.sex, l.ageYears, l.traits.size, l.health, l.traits.maneDarkness);
}

/** Los hermanos varones vivos se marchan con el jugador: la coalición natural. */
function brothersJoin(): void {
  for (let i = siblings.length - 1; i >= 0; i--) {
    const s = siblings[i];
    if (!s.alive || s.sex !== 'male') continue;
    const ally = createWildLion('ally', s.name, 'male', player.ageYears, randomTraits(Math.random), s.position.x, s.position.y, s.position.z);
    ally.kin = true;
    ally.relation = 1;
    ally.state = 'follow';
    wildLions.push(ally);
    siblings.splice(i, 1);
    events.emit('subtitle', { text: `Tu hermano ${s.name} se marcha contigo`, seconds: 4 });
    recordMilestone('coalition', `Coalición con tu hermano ${s.name}`);
  }
  useGame.setState((st) => ({ familyVersion: st.familyVersion + 1 }));
}

function becomeNomad(): void {
  lifeRoleState.evicting = false;
  setLifeRole('nomad');
  mother.active = false;
  const father = prideFather();
  if (father) father.state = 'rest';
  recordMilestone('expelled', 'Expulsado de la manada natal: ahora eres un nómada');
  events.emit('subtitle', { text: 'Has dejado atrás tu manada. Empieza tu vida de nómada', seconds: 5 });
  brothersJoin();
}

function conquer(t: Territory): void {
  t.owner = 'player';
  lifeRoleState.kingSinceYears = player.ageYears;
  lifeRoleState.nextChallenge = 900;
  setLifeRole('king');
  for (const f of femalesOf(t.id)) f.relation = 1;
  journal.stats.territories++;
  recordMilestone('king', `♛ Te has convertido en el rey de la ${t.name.toLowerCase()}`);
  events.emit('subtitle', { text: `♛ Eres el nuevo rey de la ${t.name.toLowerCase()}`, seconds: 6 });
  events.emit('player:roar', { x: player.position.x, z: player.position.z });
}

onCombatEnd((result, reason, territoryId, enemies) => {
  const { sex } = useGame.getState();
  if (result === 'win') {
    journal.stats.fightsWon++;
    recordMilestone('first-fight-won', `Primera pelea ganada contra ${enemies.map((e) => e.name).join(' y ')}`);
  }
  if (reason === 'territory' && territoryId !== null) {
    const t = territories.find((x) => x.id === territoryId);
    if (t && result === 'win' && residentsOf(t.id).every((r) => r.state === 'flee' || r.state === 'leave')) {
      if (sex === 'male' && player.ageYears >= CONQUEST_AGE) conquer(t);
      else events.emit('subtitle', { text: 'Has expulsado a los residentes, pero aún eres demasiado joven para quedarte la manada', seconds: 4 });
    }
  }
  if (reason === 'evict' && result === 'win') {
    events.emit('subtitle', { text: 'Has vencido a tu padre, pero las leonas no te aceptan: debes marcharte', seconds: 4 });
  }
  if (reason === 'challenge' && result !== 'win') {
    const t = territories.find((x) => x.owner === 'player');
    if (t) {
      t.owner = 'rival';
      for (const e of enemies) {
        const lion = e.agent as WildLion;
        if (lion.alive) {
          lion.role = 'resident';
          lion.territoryId = t.id;
          lion.state = 'rest';
        }
      }
      setLifeRole('nomad');
      recordMilestone('deposed', `Destronado: los nómadas te arrebatan la ${t.name.toLowerCase()}`);
    }
  }
});

/**
 * Transiciones del papel del jugador: expulsión del macho joven, reclamo de manadas
 * vacías, desafíos al rey y relevo de machos en la manada de una hembra.
 */
export function updateLifeRole(world: WorldData, dt: number, rng: () => number): void {
  if (!player.alive) return;
  const { sex, lifeRole } = useGame.getState();
  const home = natal();

  // --- Dispersión del macho joven ---
  if (sex === 'male' && lifeRole === 'pride' && home) {
    if (!lifeRoleState.evicting && player.ageYears >= lifeRoleState.dispersalAge) {
      lifeRoleState.evicting = true;
      lifeRoleState.evictTimer = 0;
      const father = prideFather();
      events.emit('subtitle', {
        text: `${father?.name ?? 'El macho residente'} ya no te tolera: debes abandonar el territorio de la manada`,
        seconds: 5,
      });
      if (father) events.emit('npc:roar', { x: father.position.x, z: father.position.z, name: father.name });
    }
    if (lifeRoleState.evicting) {
      lifeRoleState.evictTimer += dt;
      const father = prideFather();
      if (father && father.alive && !combat.active) {
        // El padre persigue al joven macho hasta echarlo.
        father.state = 'evict';
        father.target.set(player.position.x, 0, player.position.z);
        if (lifeRoleState.evictTimer > 45 && distXZ(father.position, player.position) < 4) {
          startCombat([father], 'evict', 0);
          lifeRoleState.evictTimer = 20;
        }
      }
      if (distXZ(player.position, home.center) > home.radius) becomeNomad();
    }
  }

  // --- Reclamar una manada sin residentes ---
  if (sex === 'male' && lifeRole === 'nomad' && player.ageYears >= CONQUEST_AGE && !combat.active) {
    for (const t of territories) {
      if (t.owner !== 'rival' || residentsOf(t.id).length > 0) continue;
      if (distXZ(player.position, t.center) < t.radius * 0.5) conquer(t);
    }
  }

  // --- Desafíos al rey ---
  if (lifeRole === 'king' && !combat.active) {
    lifeRoleState.nextChallenge -= dt;
    if (lifeRoleState.nextChallenge <= 0) {
      lifeRoleState.nextChallenge = 1100 + rng() * 600;
      sendChallengers(world, rng);
    }
    const challengers = wildLions.filter((l) => l.alive && l.role === 'nomad' && l.state === 'confront');
    if (challengers.some((c) => distXZ(c.position, player.position) < 8)) startCombat(challengers, 'challenge', null);
  }

  // --- Relevo de machos en la manada natal (camino de la hembra) ---
  if (sex === 'female' && lifeRole === 'pride' && home && !lifeRoleState.takeoverDone && player.ageYears >= 3) {
    lifeRoleState.takeoverDone = true;
    const father = prideFather();
    if (father) {
      father.state = 'leave';
      father.timer = 40;
    }
    for (let i = 0; i < 2; i++) {
      const x = home.center.x + 60 + i * 4;
      const z = home.center.z + 40;
      const male = createWildLion('resident', MALE_NAMES[Math.floor(rng() * MALE_NAMES.length)], 'male', 5.5 + rng(), randomTraits(rng), x, world.heightAt(x, z), z);
      male.territoryId = 0;
      male.traits.maneDarkness = Math.max(0.55, male.traits.maneDarkness);
      male.relation = 0.6;
      wildLions.push(male);
    }
    recordMilestone('takeover', 'Una nueva coalición de machos se ha hecho con tu manada');
    events.emit('subtitle', { text: 'Dos machos jóvenes expulsan al viejo residente: la manada tiene nuevos reyes', seconds: 5 });
  }
}

function sendChallengers(world: WorldData, rng: () => number): void {
  const t = territories.find((x) => x.owner === 'player');
  if (!t) return;
  // Una coalición nómada (o una recién llegada) va a por el trono.
  let group = wildLions.filter((l) => l.alive && l.role === 'nomad' && l.ageYears >= 4);
  if (group.length === 0) {
    const a = rng() * Math.PI * 2;
    const x = t.center.x + Math.cos(a) * 400;
    const z = t.center.z + Math.sin(a) * 400;
    const n = 1 + (rng() < 0.6 ? 1 : 0);
    for (let i = 0; i < n; i++) {
      const lion = createWildLion('nomad', MALE_NAMES[Math.floor(rng() * MALE_NAMES.length)], 'male', 5 + rng() * 2, randomTraits(rng), x + i * 4, world.heightAt(x, z), z);
      lion.groupId = 900;
      wildLions.push(lion);
    }
    group = wildLions.filter((l) => l.groupId === 900 && l.alive);
  } else {
    group = group.filter((l) => l.groupId === group[0].groupId);
  }
  for (const c of group) {
    c.state = 'confront';
    c.target.set(t.center.x, 0, t.center.z);
    c.timer = 300;
  }
  events.emit('subtitle', { text: `[Rugidos desconocidos: ${group.map((g) => g.name).join(' y ')} vienen a desafiarte]`, seconds: 5 });
  events.emit('npc:roar', { x: group[0].position.x, z: group[0].position.z, name: group[0].name });
}

/** Nómada más cercano con el que se puede intentar una alianza. */
export function recruitableNomad(): WildLion | null {
  const { sex } = useGame.getState();
  if (sex !== 'male' || player.ageYears < 2 || allies().length >= MAX_ALLIES) return null;
  let best: WildLion | null = null;
  let bestD = 4;
  for (const l of wildLions) {
    if (!l.alive || l.role !== 'nomad' || l.state === 'confront' || l.state === 'flee') continue;
    const d = distXZ(l.position, player.position);
    if (d < bestD) {
      bestD = d;
      best = l;
    }
  }
  return best;
}

/** Proponer una alianza a un nómada: acepta según la fuerza relativa y su actitud. */
export function tryRecruit(nomad: WildLion): void {
  const chance = clamp(0.3 + (playerStrength() - lionStrength(nomad)) * 0.8 + nomad.relation * 0.5 + (allies().length === 0 ? 0.1 : 0), 0.05, 0.9);
  if (Math.random() < chance) {
    // Si iba en pareja, el compañero se une también.
    const group = wildLions.filter((l) => l.alive && l.role === 'nomad' && l.groupId === nomad.groupId);
    for (const g of group.slice(0, MAX_ALLIES - allies().length)) {
      g.role = 'ally';
      g.relation = 1;
      g.state = 'follow';
      g.groupId = 0;
    }
    recordMilestone('coalition', `Coalición con ${group.map((g) => g.name).join(' y ')}`);
    events.emit('subtitle', { text: `${group.map((g) => g.name).join(' y ')} se ${group.length > 1 ? 'unen' : 'une'} a tu coalición`, seconds: 4 });
  } else {
    nomad.relation -= 0.35;
    if (nomad.relation < -0.4 && nomad.traits.aggression > 0.55 && player.ageYears >= 2) {
      events.emit('subtitle', { text: `${nomad.name} se lo toma como un desafío`, seconds: 3 });
      startCombat([nomad], 'nomad', null);
    } else {
      events.emit('subtitle', { text: `${nomad.name} te rechaza con un gruñido`, seconds: 3 });
      events.emit('sfx', { sound: 'growl', x: nomad.position.x, y: nomad.position.y + 0.8, z: nomad.position.z });
    }
  }
}
