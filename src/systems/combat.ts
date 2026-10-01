import lionData from '../data/lion.json';
import { events } from '../core/events';
import { clamp, moveTowardsAngle } from '../core/math';
import { useGame } from '../core/store';
import type { Agent } from '../entities/npc/npcState';
import { allies, type WildLion } from '../entities/npc/wildLions';
import { player, type DeathCause } from '../entities/player/playerState';
import type { WorldData } from '../world/WorldData';
import { moveForward } from '../ai/steering';
import { combatStrength, playerTraits } from './genetics';
import { defense, hitPlayer, spendStamina } from './playerDefense';
import { ABILITIES, abilityCooldown, abilityPower, derivedStats, progression, type AbilityId } from './progression';
import { addWound, BODY_PART_LABEL, playerBody, randomPart, type Body } from './wounds';

const C = lionData.combat;

export type CombatMove = 'swipe' | 'bite' | 'threat';
export type CombatReason = 'territory' | 'nomad' | 'evict' | 'challenge' | 'boss';

/** Ajustes de un luchador que no es un león corriente (jefes, hienas espectrales). */
export interface CombatProfile {
  name?: string;
  strength?: number;
  skill?: number;
  aggression?: number;
  /** Multiplicador del daño que recibe. */
  damageTaken?: number;
  /** Multiplicador de la postura que acumula. */
  postureTaken?: number;
  /** La IA del combate no lo mueve (lo controla su propio cerebro). */
  external?: boolean;
  isBoss?: boolean;
  /** Causa de muerte si mata al jugador. */
  cause?: DeathCause;
  /** Huye con esta salud (por defecto la de los leones; 0 = lucha hasta morir). */
  fleeHealth?: number;
}

export interface Fighter {
  id: string;
  name: string;
  side: 'player' | 'enemy';
  isPlayer: boolean;
  agent: Agent | null;
  body: Body;
  strength: number;
  skill: number;
  aggression: number;
  stamina: number;
  morale: number;
  /** Postura acumulada [0, 1]: al llenarse, el luchador queda expuesto. */
  posture: number;
  postureIdle: number;
  /** Segundos aturdido (expuesto). */
  stagger: number;
  /** Segundos de sangrado. */
  bleed: number;
  action: CombatMove | null;
  actionTime: number;
  /** Se incrementa en cada acción nueva (para reiniciar la animación). */
  actionId: number;
  cooldown: number;
  decide: number;
  orbit: number;
  out: boolean;
  external: boolean;
  isBoss: boolean;
  damageTaken: number;
  postureTaken: number;
  cause: DeathCause;
  fleeHealth: number;
}

export const combat = {
  active: false,
  fighters: [] as Fighter[],
  reason: 'territory' as CombatReason,
  territoryId: null as number | null,
  result: null as 'win' | 'lose' | 'fled' | null,
  lastHit: '',
  lastHitTime: 0,
  elapsed: 0,
  /** Objetivo fijado (Tab). */
  lockTarget: null as Fighter | null,
  /** Cadena de zarpazos del jugador (1–4). */
  chain: 0,
  lastSwipeEnd: -99,
  /** Últimos golpes del jugador, para detectar combos. */
  trail: [] as { move: CombatMove; t: number }[],
  /** Embestida en curso: el controlador del jugador aplica este desplazamiento. */
  dash: null as { vx: number; vz: number; time: number; target: Fighter | null } | null,
  /** Golpes pendientes del desgarro. */
  pendingTears: [] as { at: number; target: Fighter }[],
};

/** Habilidades: recargas (s), carga de la definitiva y tiempo de furia restante. */
export const abilities = {
  cooldowns: { charge: 0, roar: 0, tear: 0, fury: 0 } as Record<AbilityId, number>,
  furyGauge: 0,
  furyTime: 0,
};

type EndListener = (result: 'win' | 'lose' | 'fled', reason: CombatReason, territoryId: number | null, enemies: Fighter[]) => void;
const endListeners = new Set<EndListener>();
export function onCombatEnd(fn: EndListener): () => void {
  endListeners.add(fn);
  return () => endListeners.delete(fn);
}

const profiles = new WeakMap<Agent, CombatProfile>();
/** Asigna un perfil de combate a un agente (antes de `startCombat`). */
export function setCombatProfile(agent: Agent, profile: CombatProfile): void {
  profiles.set(agent, profile);
}

const npcBodies = new WeakMap<Agent, Body>();
function bodyOf(agent: Agent): Body {
  const wild = agent as Partial<WildLion>;
  if (wild.body) return wild.body;
  let b = npcBodies.get(agent);
  if (!b) {
    b = { wounds: [], scars: [] };
    npcBodies.set(agent, b);
  }
  return b;
}

function baseFighter(): Omit<Fighter, 'id' | 'name' | 'side' | 'isPlayer' | 'agent' | 'body' | 'strength' | 'skill' | 'aggression'> {
  return {
    stamina: 1,
    morale: 1,
    posture: 0,
    postureIdle: 0,
    stagger: 0,
    bleed: 0,
    action: null,
    actionTime: 0,
    actionId: 0,
    cooldown: 0.5 + Math.random() * 0.5,
    decide: 0,
    orbit: Math.random() * Math.PI * 2,
    out: false,
    external: false,
    isBoss: false,
    damageTaken: 1,
    postureTaken: 1,
    cause: 'lions',
    fleeHealth: C.fleeHealth,
  };
}

function npcFighter(agent: Agent, side: 'player' | 'enemy'): Fighter {
  const wild = agent as Partial<WildLion>;
  const traits = wild.traits ?? { maneDarkness: 0.6, size: 1, aggression: 0.6, furTint: 0 };
  const p = profiles.get(agent) ?? {};
  return {
    ...baseFighter(),
    id: agent.id,
    name: p.name ?? agent.name,
    side,
    isPlayer: false,
    agent,
    body: bodyOf(agent),
    strength: p.strength ?? combatStrength(agent.sex, agent.ageYears, traits.size, agent.health, traits.maneDarkness),
    skill: p.skill ?? clamp(0.3 + agent.ageYears / 12, 0.3, 0.9),
    aggression: p.aggression ?? traits.aggression,
    external: p.external ?? false,
    isBoss: p.isBoss ?? false,
    damageTaken: p.damageTaken ?? 1,
    postureTaken: p.postureTaken ?? 1,
    cause: p.cause ?? 'lions',
    fleeHealth: p.fleeHealth ?? C.fleeHealth,
  };
}

function playerFighter(): Fighter {
  const sex = useGame.getState().sex;
  return {
    ...baseFighter(),
    id: 'player',
    name: 'Tú',
    side: 'player',
    isPlayer: true,
    agent: null,
    body: playerBody,
    strength: combatStrength(sex, player.ageYears, playerTraits.size, player.needs.health, playerTraits.maneDarkness),
    skill: 0.6,
    aggression: playerTraits.aggression,
    cooldown: 0,
  };
}

export const posOf = (f: Fighter) => (f.isPlayer ? player.position : f.agent!.position);
export const healthOf = (f: Fighter) => (f.isPlayer ? player.needs.health : f.agent!.health);
const distance = (a: Fighter, b: Fighter) => {
  const pa = posOf(a);
  const pb = posOf(b);
  return Math.hypot(pa.x - pb.x, pa.z - pb.z);
};
const me = () => combat.fighters.find((f) => f.isPlayer) ?? null;
export const foesOf = (f: Fighter) => combat.fighters.filter((o) => o.side !== f.side && !o.out);

export function startCombat(enemies: Agent[], reason: CombatReason, territoryId: number | null): void {
  if (combat.active || enemies.length === 0) return;
  combat.active = true;
  combat.reason = reason;
  combat.territoryId = territoryId;
  combat.result = null;
  combat.elapsed = 0;
  combat.lastHit = '';
  combat.chain = 0;
  combat.trail = [];
  combat.dash = null;
  combat.pendingTears = [];
  combat.fighters = [playerFighter(), ...allies().map((a) => npcFighter(a, 'player')), ...enemies.map((e) => npcFighter(e, 'enemy'))];
  for (const f of combat.fighters) if (f.agent && !f.external) f.agent.state = 'fight';
  const foes = combat.fighters.filter((f) => f.side === 'enemy');
  // Fijado automático cuando hay un único rival o un jefe.
  combat.lockTarget = foes.find((f) => f.isBoss) ?? (foes.length === 1 ? foes[0] : null);
  player.resting = false;
  player.action = null;
  defense.stamina = Math.max(defense.stamina, derivedStats().maxStamina * 0.6);
  if (reason !== 'boss') {
    events.emit('sfx', { sound: 'roar', x: player.position.x, y: player.position.y + 1, z: player.position.z, volume: 0.8 });
    events.emit('subtitle', { text: `¡Pelea! ${enemies.map((e) => e.name).join(' y ')} te ${enemies.length > 1 ? 'atacan' : 'ataca'}`, seconds: 3 });
  }
}

/** Añade enemigos a una pelea en curso (invocaciones de un jefe). */
export function addEnemies(agents: Agent[]): void {
  if (!combat.active) return;
  for (const a of agents) {
    const f = npcFighter(a, 'enemy');
    if (!f.external && f.agent) f.agent.state = 'fight';
    combat.fighters.push(f);
  }
}

/** Fija o suelta el objetivo; si ya hay uno, pasa al siguiente enemigo. */
export function toggleLock(cycle = false): void {
  const m = me();
  if (!combat.active || !m) {
    combat.lockTarget = null;
    return;
  }
  const foes = foesOf(m).sort((a, b) => distance(m, a) - distance(m, b));
  if (combat.lockTarget && !cycle) {
    combat.lockTarget = null;
    return;
  }
  if (foes.length === 0) return;
  const i = combat.lockTarget ? foes.indexOf(combat.lockTarget) : -1;
  combat.lockTarget = foes[(i + 1) % foes.length];
}

/** Posición del objetivo fijado (para la cámara y el controlador). */
export function lockedPosition(): { x: number; y: number; z: number } | null {
  const t = combat.lockTarget;
  if (!combat.active || !t || t.out) return null;
  return posOf(t);
}

// ---------------------------------------------------------------------------------------
// Acciones del jugador
// ---------------------------------------------------------------------------------------

const SWIPE_WINDUP = [0.3, 0.24, 0.2, 0.2];
const CHAIN_DAMAGE = [1, 1.1, 1.2, 1.5];

/** Orden del jugador: zarpazo (clic) o mordisco (clic derecho). */
export function playerCombatMove(move: CombatMove): void {
  const m = me();
  if (!combat.active || !m || m.out || m.action || m.cooldown > 0 || defense.stagger > 0 || defense.dodge > 0) return;
  if (!spendStamina(C[move].stamina * 1.3)) return;
  if (move === 'swipe') {
    combat.chain = combat.elapsed - combat.lastSwipeEnd < 0.75 ? Math.min(4, combat.chain + 1) : 1;
  }
  faceTarget(m);
  m.action = move;
  m.actionTime = 0;
  m.actionId++;
}

function faceTarget(m: Fighter): void {
  const target = playerTarget(m, 12);
  if (!target) return;
  const pt = posOf(target);
  player.heading = Math.atan2(pt.x - player.position.x, pt.z - player.position.z);
}

/** Objetivo de los golpes del jugador: el fijado o el enemigo más cercano por delante. */
function playerTarget(m: Fighter, maxDist: number): Fighter | null {
  const locked = combat.lockTarget;
  if (locked && !locked.out && distance(m, locked) < maxDist) return locked;
  let best: Fighter | null = null;
  let bestScore = Infinity;
  for (const o of foesOf(m)) {
    const d = distance(m, o);
    if (d > maxDist) continue;
    const p = posOf(o);
    const ang = Math.abs(Math.atan2(Math.sin(Math.atan2(p.x - player.position.x, p.z - player.position.z) - player.heading), Math.cos(Math.atan2(p.x - player.position.x, p.z - player.position.z) - player.heading)));
    const score = d + ang * 3;
    if (score < bestScore) {
      bestScore = score;
      best = o;
    }
  }
  return best;
}

export function playerCombatAction(): CombatMove | null {
  return me()?.action ?? null;
}

/** Identificador de la acción en curso del jugador (cambia en cada golpe). */
export function playerActionId(): number {
  return me()?.actionId ?? 0;
}

/** Usa una habilidad (Q, R, F, G). Devuelve true si se ha lanzado. */
export function castAbility(id: AbilityId): boolean {
  const m = me();
  const def = ABILITIES[id];
  if (!combat.active || !m || m.out || defense.stagger > 0) return false;
  if (progression.ranks[id] <= 0) {
    events.emit('subtitle', { text: `${def.name}: aún no la has aprendido (nivel ${def.unlockLevel})`, seconds: 2 });
    return false;
  }
  if (id === 'fury') {
    if (abilities.furyGauge < 1) {
      events.emit('subtitle', { text: 'La furia aún no está cargada', seconds: 1.5 });
      return false;
    }
    abilities.furyGauge = 0;
    abilities.furyTime = 12 * (1 + 0.15 * (progression.ranks.fury - 1));
    events.emit('combat:feat', { text: 'Furia del rey', kind: 'combo' });
    events.emit('sfx', { sound: 'roar', x: player.position.x, y: player.position.y + 1, z: player.position.z, volume: 1 });
    return true;
  }
  if (abilities.cooldowns[id] > 0) return false;
  const power = abilityPower(id);
  if (id === 'charge') {
    if (!spendStamina(0.15)) return false;
    const target = playerTarget(m, 14);
    let dx = Math.sin(player.heading);
    let dz = Math.cos(player.heading);
    if (target) {
      const p = posOf(target);
      const d = Math.max(0.1, Math.hypot(p.x - player.position.x, p.z - player.position.z));
      dx = (p.x - player.position.x) / d;
      dz = (p.z - player.position.z) / d;
      player.heading = Math.atan2(dx, dz);
    }
    combat.dash = { vx: dx * 20, vz: dz * 20, time: 0.34, target };
    defense.iframes = Math.max(defense.iframes, 0.3);
  } else if (id === 'roar') {
    for (const o of foesOf(m)) {
      if (distance(m, o) > 9) continue;
      o.action = null;
      o.stagger = Math.max(o.stagger, (o.isBoss ? 0.6 : 1.1) * power * derivedStats().roarStun);
      addPosture(o, 0.22 * power);
      o.morale -= 0.15;
    }
    events.emit('sfx', { sound: 'roar', x: player.position.x, y: player.position.y + 1, z: player.position.z, volume: 1 });
    events.emit('combat:feat', { text: 'Rugido aturdidor', kind: 'combo' });
  } else if (id === 'tear') {
    const target = playerTarget(m, 3.2);
    if (!target) {
      events.emit('subtitle', { text: 'Demasiado lejos para desgarrar', seconds: 1.2 });
      return false;
    }
    if (!spendStamina(0.2)) return false;
    faceTarget(m);
    m.actionId++;
    for (let i = 0; i < 3; i++) combat.pendingTears.push({ at: combat.elapsed + 0.12 + i * 0.16, target });
  }
  abilities.cooldowns[id] = abilityCooldown(id);
  return true;
}

/** Avanza recargas y furia (también fuera de combate). */
export function tickAbilities(dt: number): void {
  for (const id of Object.keys(abilities.cooldowns) as AbilityId[]) abilities.cooldowns[id] = Math.max(0, abilities.cooldowns[id] - dt);
  abilities.furyTime = Math.max(0, abilities.furyTime - dt);
}

export const furyActive = () => abilities.furyTime > 0;

// ---------------------------------------------------------------------------------------
// Daño
// ---------------------------------------------------------------------------------------

function addPosture(target: Fighter, amount: number): void {
  if (target.out || target.stagger > 0) return;
  target.posture = Math.min(1, target.posture + amount * target.postureTaken);
  target.postureIdle = 0;
  if (target.posture >= 1) {
    target.stagger = target.isBoss ? 3 : 2.4;
    target.action = null;
    events.emit('combat:feat', { text: `${target.name}: postura rota`, kind: 'break' });
  }
}

/** Daño de un luchador del bando del jugador (o del propio jugador) a un enemigo. */
export function damageFighter(target: Fighter, amount: number, posture: number, rng: () => number, label: string, fromPlayer = false): void {
  if (target.out || !target.agent) return;
  const amt = amount * target.damageTaken;
  const part = randomPart(rng);
  addWound(target.body, part, amt * 2.2);
  target.agent.health = Math.max(0, target.agent.health - amt);
  target.morale -= amt * 1.3;
  addPosture(target, posture);
  if (fromPlayer) abilities.furyGauge = Math.min(1, abilities.furyGauge + amt * 2.2 * derivedStats().furyGain);
  const where = posOf(target);
  events.emit('sfx', { sound: label.includes('mordisco') || label.includes('gracia') ? 'bite' : 'pounce', x: where.x, y: where.y + 0.6, z: where.z, volume: 0.8 });
  const article = part === 'neck' || part === 'back' ? 'el' : 'la';
  combat.lastHit = `${label} a ${target.name} en ${article} ${BODY_PART_LABEL[part]}`;
  combat.lastHitTime = combat.elapsed;
}

function strengthRatio(a: Fighter, b: Fighter): number {
  return clamp(Math.pow(a.strength / Math.max(0.05, b.strength), 0.8), 0.3, 2.5);
}

function resolvePlayer(m: Fighter, rng: () => number): void {
  const move = m.action!;
  m.action = null;
  m.cooldown = move === 'swipe' ? 0.08 : C.bite.cooldown * 0.5;
  const t = combat.elapsed;
  combat.trail.push({ move, t });
  if (combat.trail.length > 4) combat.trail.shift();
  if (move === 'swipe') combat.lastSwipeEnd = t;
  const target = playerTarget(m, C[move === 'threat' ? 'swipe' : move].range + 0.9 + 0.5 * player.scale);
  if (move === 'threat') return;
  if (!target) return;
  const spec = C[move];
  const s = derivedStats();
  let amount = spec.damage * strengthRatio(m, target) * s.damageDealt * (0.85 + 0.3 * rng());
  if (move === 'bite') amount *= s.biteBonus;
  let posture = (move === 'bite' ? 0.22 : 0.09) * s.postureDealt;
  let label = move === 'bite' ? 'Mordisco' : 'Zarpazo';
  if (move === 'swipe') {
    amount *= CHAIN_DAMAGE[combat.chain - 1] ?? 1;
    if (combat.chain === 4) label = 'Remate de la cadena';
  }
  // Combo: zarpazo, zarpazo, mordisco en menos de 2 s → desgarro del cuello.
  const tr = combat.trail;
  if (move === 'bite' && tr.length >= 3 && tr[tr.length - 2].move === 'swipe' && tr[tr.length - 3].move === 'swipe' && t - tr[tr.length - 3].t < 2) {
    amount *= 1.6;
    target.bleed = Math.max(target.bleed, 5);
    label = 'Desgarro del cuello';
    events.emit('combat:feat', { text: 'Combo: desgarro del cuello', kind: 'combo' });
    combat.trail = [];
  }
  // Golpe de gracia: mordisco a un rival con la postura rota.
  if (move === 'bite' && target.stagger > 0 && target.posture >= 1) {
    amount *= 3;
    posture = 0;
    target.posture = 0.4;
    target.stagger = Math.min(target.stagger, 0.6);
    label = 'Golpe de gracia';
    events.emit('combat:feat', { text: 'Golpe de gracia', kind: 'critical' });
  }
  if (furyActive()) amount *= 1.5;
  damageFighter(target, amount, posture, rng, label, true);
}

function resolveNpc(f: Fighter, rng: () => number): void {
  const move = f.action!;
  const target = nearestFoe(f);
  f.action = null;
  f.cooldown = C[move].cooldown;
  if (!target) return;
  const d = distance(f, target);
  const ratio = strengthRatio(f, target);
  if (move === 'threat') {
    target.morale -= C.threat.morale * ratio;
    f.morale = Math.min(1, f.morale + 0.05);
    events.emit('sfx', { sound: 'growl', x: posOf(f).x, y: posOf(f).y + 0.8, z: posOf(f).z, volume: 0.7 });
    return;
  }
  const spec = C[move];
  if (d > spec.range + 0.4) return;
  const amount = spec.damage * ratio * (0.8 + 0.4 * rng()) * (0.6 + 0.4 * f.stamina);
  if (target.isPlayer) {
    const res = hitPlayer(amount, f.cause, { guardCost: move === 'bite' ? 0.35 : 0.18 });
    if (res === 'parried') {
      f.stagger = 1.2;
      addPosture(f, 0.45 * derivedStats().postureDealt);
    }
    if (res === 'hit') {
      combat.lastHit = `${f.name} te ${move === 'bite' ? 'muerde' : 'alcanza con un zarpazo'}`;
      combat.lastHitTime = combat.elapsed;
    }
    return;
  }
  // Contra aliados del jugador: duelo de posturas clásico.
  let amt = amount;
  if (move === 'swipe' && target.action === 'bite' && target.actionTime < C.bite.windup) {
    amt *= C.counterMultiplier;
    target.action = null;
    target.cooldown = 0.9;
  }
  if (target.agent) {
    target.agent.health = Math.max(0, target.agent.health - amt);
    target.morale -= amt * 1.3;
    addWound(target.body, randomPart(rng), amt * 2.2);
  }
}

function nearestFoe(f: Fighter): Fighter | null {
  let best: Fighter | null = null;
  let bestD = Infinity;
  for (const o of foesOf(f)) {
    const d = distance(f, o);
    if (d < bestD) {
      bestD = d;
      best = o;
    }
  }
  return best;
}

function decide(f: Fighter, rng: () => number): void {
  const target = nearestFoe(f);
  if (!target) return;
  const d = distance(f, target);
  if (d > C.swipe.range + 0.5) return;
  if (target.action === 'bite' && target.actionTime < 0.4 && rng() < 0.35 + 0.4 * f.skill && f.stamina > C.swipe.stamina) {
    f.action = 'swipe';
  } else {
    const r = rng();
    const pThreat = 0.12 + 0.25 * (1 - f.aggression);
    const pBite = 0.15 + 0.3 * f.aggression;
    if (r < pThreat) f.action = 'threat';
    else if (r < pThreat + pBite && d < C.bite.range + 0.3 && f.stamina > C.bite.stamina) f.action = 'bite';
    else if (f.stamina > C.swipe.stamina) f.action = 'swipe';
    else f.action = 'threat';
  }
  f.actionTime = 0;
  f.actionId++;
  if (f.agent) f.agent.clipNonce = (f.agent.clipNonce ?? 0) + 1;
  f.stamina -= C[f.action].stamina;
}

// ---------------------------------------------------------------------------------------
// Bucle
// ---------------------------------------------------------------------------------------

export function updateCombat(world: WorldData, dt: number, rng: () => number): void {
  if (!combat.active) return;
  combat.elapsed += dt;
  const m = me()!;

  // Golpes programados del desgarro.
  for (let i = combat.pendingTears.length - 1; i >= 0; i--) {
    const p = combat.pendingTears[i];
    if (combat.elapsed < p.at) continue;
    combat.pendingTears.splice(i, 1);
    if (p.target.out || distance(m, p.target) > 3.6) continue;
    const amount = 0.035 * derivedStats().damageDealt * abilityPower('tear') * (furyActive() ? 1.5 : 1);
    p.target.bleed = Math.max(p.target.bleed, 5 * abilityPower('tear'));
    damageFighter(p.target, amount, 0.08, rng, 'Desgarro', true);
  }
  // Final de la embestida.
  if (combat.dash) {
    combat.dash.time -= dt;
    if (combat.dash.time <= 0) {
      const t = combat.dash.target ?? playerTarget(m, 3);
      if (t && !t.out && distance(m, t) < 3.2) {
        damageFighter(t, 0.09 * derivedStats().damageDealt * abilityPower('charge'), 0.38 * abilityPower('charge'), rng, 'Embestida', true);
      }
      combat.dash = null;
    }
  }

  for (const f of combat.fighters) {
    if (f.out) continue;
    f.cooldown = Math.max(0, f.cooldown - dt);
    f.stagger = Math.max(0, f.stagger - dt);
    if (!f.isPlayer) f.stamina = Math.min(1, f.stamina + C.staminaRegen * dt);
    f.morale = Math.min(1, f.morale + 0.015 * dt);
    // La postura se recupera si el luchador no recibe golpes durante un rato.
    f.postureIdle += dt;
    if (f.stagger <= 0 && f.postureIdle > 1.5) f.posture = Math.max(0, f.posture - (f.isBoss ? 0.05 : 0.09) * dt);
    if (f.stagger > 0 && f.posture >= 1 && f.stagger < 0.05) f.posture = 0.5;
    if (f.bleed > 0) {
      f.bleed = Math.max(0, f.bleed - dt);
      if (f.agent) f.agent.health = Math.max(0, f.agent.health - 0.012 * dt * f.damageTaken);
    }
    if (f.action) {
      f.actionTime += dt;
      const windup = f.isPlayer && f.action === 'swipe' ? SWIPE_WINDUP[combat.chain - 1] ?? C.swipe.windup : C[f.action].windup;
      if (f.stagger > 0) f.action = null;
      else if (f.actionTime >= windup) (f.isPlayer ? resolvePlayer(f, rng) : resolveNpc(f, rng));
    }

    if (f.isPlayer) continue;
    const agent = f.agent!;
    const health = healthOf(f);
    if (health <= 0 || (!f.isBoss && f.fleeHealth > 0 && (health < f.fleeHealth || f.morale <= 0))) {
      f.out = true;
      if (combat.lockTarget === f) combat.lockTarget = null;
      if (health <= 0) {
        agent.alive = false;
        agent.state = 'dead';
        agent.clip = 'die';
        if (!f.isBoss) events.emit('subtitle', { text: `${f.name} ha muerto`, seconds: 2.5 });
      } else {
        agent.state = 'flee';
        agent.timer = 12;
        events.emit('subtitle', { text: `${f.name} huye derrotado`, seconds: 3 });
      }
      continue;
    }
    if (f.external) continue;

    // IA de los leones y las hienas: rodean al rival a distancia de golpe.
    const target = nearestFoe(f);
    if (!target) continue;
    const tp = posOf(target);
    const d = distance(f, target);
    if (f.stagger > 0) {
      agent.speed = 0;
      agent.clip = 'snarl';
      continue;
    }
    f.orbit += dt * 0.6 * (f.id.length % 2 === 0 ? 1 : -1);
    const want = f.action ? 0 : d > 2.2 ? Math.min(6, d) : 0.6;
    const dirToTarget = Math.atan2(tp.x - agent.position.x, tp.z - agent.position.z);
    agent.heading = moveTowardsAngle(agent.heading, d > 2.2 ? dirToTarget : dirToTarget + Math.sin(f.orbit) * 0.9, 5 * dt);
    agent.speed = want;
    moveForward(agent, world, dt);
    if (f.action) agent.heading = moveTowardsAngle(agent.heading, dirToTarget, 8 * dt);
    agent.clip = f.action === 'swipe' ? 'swipe' : f.action === 'bite' ? 'bite' : d > 3 ? 'trot' : 'snarl';
    f.decide -= dt;
    if (!f.action && f.cooldown <= 0 && f.decide <= 0) {
      f.decide = 0.15 + rng() * 0.25;
      decide(f, rng);
    }
  }

  const foes = combat.fighters.filter((f) => f.side === 'enemy' && !f.out);
  const farFromAll = foes.every((f) => distance(m, f) > C.escapeDistance);
  if (!player.alive) end('lose');
  else if (foes.length === 0) end('win');
  else if (farFromAll && combat.reason !== 'boss') end('fled');
}

function end(result: 'win' | 'lose' | 'fled'): void {
  combat.active = false;
  combat.result = result;
  combat.lockTarget = null;
  combat.dash = null;
  combat.pendingTears = [];
  const enemies = combat.fighters.filter((f) => f.side === 'enemy');
  for (const f of combat.fighters) {
    if (f.agent && f.agent.alive && f.agent.state === 'fight') {
      f.agent.state = f.side === 'player' ? 'follow' : 'idle';
      f.agent.timer = 5;
    }
  }
  if (combat.reason !== 'boss') {
    if (result === 'win') events.emit('subtitle', { text: 'Has ganado la pelea', seconds: 3 });
    if (result === 'fled') events.emit('subtitle', { text: 'Te retiras de la pelea', seconds: 3 });
  }
  for (const fn of endListeners) fn(result, combat.reason, combat.territoryId, enemies);
}

/** Termina la pelea en curso sin vencedor (reinicio de un jefe, reaparición). */
export function abortCombat(): void {
  if (!combat.active) return;
  for (const f of combat.fighters) if (f.agent && f.agent.alive && f.agent.state === 'fight') f.agent.state = 'idle';
  combat.active = false;
  combat.lockTarget = null;
  combat.dash = null;
  combat.pendingTears = [];
  combat.fighters = [];
}

export function resetCombat(): void {
  combat.active = false;
  combat.fighters = [];
  combat.result = null;
  combat.lockTarget = null;
  combat.dash = null;
  combat.pendingTears = [];
  for (const id of Object.keys(abilities.cooldowns) as AbilityId[]) abilities.cooldowns[id] = 0;
  abilities.furyGauge = 0;
  abilities.furyTime = 0;
}
