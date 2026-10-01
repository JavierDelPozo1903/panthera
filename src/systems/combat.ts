import lionData from '../data/lion.json';
import { events } from '../core/events';
import { clamp, moveTowardsAngle } from '../core/math';
import { useGame } from '../core/store';
import type { Agent } from '../entities/npc/npcState';
import { allies, type WildLion } from '../entities/npc/wildLions';
import { damagePlayer, player } from '../entities/player/playerState';
import type { WorldData } from '../world/WorldData';
import { moveForward } from '../ai/steering';
import { combatStrength, playerTraits } from './genetics';
import { addWound, BODY_PART_LABEL, playerBody, randomPart, type Body } from './wounds';

const C = lionData.combat;

export type CombatMove = 'swipe' | 'bite' | 'threat';
export type CombatReason = 'territory' | 'nomad' | 'evict' | 'challenge';

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
  action: CombatMove | null;
  actionTime: number;
  cooldown: number;
  decide: number;
  /** Ángulo de rodeo alrededor del rival. */
  orbit: number;
  out: boolean;
}

/**
 * Combate por posturas entre leones. Cada luchador encadena amenazas (bajan la moral del
 * rival), zarpazos (rápidos) y mordiscos (lentos y potentes, pero un zarpazo bien medido
 * durante la preparación los interrumpe). Pierde quien huye: por heridas, por moral o
 * porque se aleja. Las heridas quedan en el cuerpo y pueden infectarse.
 */
export const combat = {
  active: false,
  fighters: [] as Fighter[],
  reason: 'territory' as CombatReason,
  territoryId: null as number | null,
  result: null as 'win' | 'lose' | 'fled' | null,
  /** Texto del último golpe (para el HUD). */
  lastHit: '',
  lastHitTime: 0,
  elapsed: 0,
};

type EndListener = (result: 'win' | 'lose' | 'fled', reason: CombatReason, territoryId: number | null, enemies: Fighter[]) => void;
const endListeners = new Set<EndListener>();
export function onCombatEnd(fn: EndListener): () => void {
  endListeners.add(fn);
  return () => endListeners.delete(fn);
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

function npcFighter(agent: Agent, side: 'player' | 'enemy'): Fighter {
  const wild = agent as Partial<WildLion>;
  const traits = wild.traits ?? { maneDarkness: 0.6, size: 1, aggression: 0.6, furTint: 0 };
  return {
    id: agent.id,
    name: agent.name,
    side,
    isPlayer: false,
    agent,
    body: bodyOf(agent),
    strength: combatStrength(agent.sex, agent.ageYears, traits.size, agent.health, traits.maneDarkness),
    skill: clamp(0.3 + agent.ageYears / 12, 0.3, 0.9),
    aggression: traits.aggression,
    stamina: 1,
    morale: 1,
    action: null,
    actionTime: 0,
    cooldown: 0.5 + Math.random() * 0.5,
    decide: 0,
    orbit: Math.random() * Math.PI * 2,
    out: false,
  };
}

function playerFighter(): Fighter {
  const sex = useGame.getState().sex;
  return {
    id: 'player',
    name: 'Tú',
    side: 'player',
    isPlayer: true,
    agent: null,
    body: playerBody,
    strength: combatStrength(sex, player.ageYears, playerTraits.size, player.needs.health, playerTraits.maneDarkness),
    skill: 0.6,
    aggression: playerTraits.aggression,
    stamina: 1,
    morale: 1,
    action: null,
    actionTime: 0,
    cooldown: 0,
    decide: 0,
    orbit: 0,
    out: false,
  };
}

const posOf = (f: Fighter) => (f.isPlayer ? player.position : f.agent!.position);
const healthOf = (f: Fighter) => (f.isPlayer ? player.needs.health : f.agent!.health);
const distance = (a: Fighter, b: Fighter) => {
  const pa = posOf(a);
  const pb = posOf(b);
  return Math.hypot(pa.x - pb.x, pa.z - pb.z);
};

export function startCombat(enemies: Agent[], reason: CombatReason, territoryId: number | null): void {
  if (combat.active || enemies.length === 0) return;
  combat.active = true;
  combat.reason = reason;
  combat.territoryId = territoryId;
  combat.result = null;
  combat.elapsed = 0;
  combat.lastHit = '';
  combat.fighters = [playerFighter(), ...allies().map((a) => npcFighter(a, 'player')), ...enemies.map((e) => npcFighter(e, 'enemy'))];
  for (const f of combat.fighters) if (f.agent) f.agent.state = 'fight';
  player.resting = false;
  player.action = null;
  events.emit('sfx', { sound: 'roar', x: player.position.x, y: player.position.y + 1, z: player.position.z, volume: 0.8 });
  events.emit('subtitle', { text: `¡Pelea! ${enemies.map((e) => e.name).join(' y ')} te ${enemies.length > 1 ? 'atacan' : 'ataca'}`, seconds: 3 });
}

/** Orden del jugador (tecla o clic). */
export function playerCombatMove(move: CombatMove): void {
  const me = combat.fighters.find((f) => f.isPlayer);
  if (!combat.active || !me || me.out || me.action || me.cooldown > 0) return;
  const cost = C[move].stamina;
  if (me.stamina < cost) {
    events.emit('subtitle', { text: 'Estás sin aliento', seconds: 1.2 });
    return;
  }
  const target = nearestFoe(me);
  if (target) {
    const pt = posOf(target);
    player.heading = Math.atan2(pt.x - player.position.x, pt.z - player.position.z);
  }
  me.action = move;
  me.actionTime = 0;
  me.stamina -= cost;
}

function nearestFoe(f: Fighter): Fighter | null {
  let best: Fighter | null = null;
  let bestD = Infinity;
  for (const o of combat.fighters) {
    if (o.side === f.side || o.out) continue;
    const d = distance(f, o);
    if (d < bestD) {
      bestD = d;
      best = o;
    }
  }
  return best;
}

/** Acción en curso del jugador (para animar su león). */
export function playerCombatAction(): CombatMove | null {
  return combat.fighters.find((f) => f.isPlayer)?.action ?? null;
}

function damage(target: Fighter, amount: number, rng: () => number): string {
  const part = randomPart(rng);
  addWound(target.body, part, amount * 2.2);
  if (target.isPlayer) damagePlayer(amount, 'lions');
  else if (target.agent) target.agent.health = Math.max(0, target.agent.health - amount);
  target.morale -= amount * 1.3;
  return BODY_PART_LABEL[part];
}

function resolve(f: Fighter, rng: () => number): void {
  const move = f.action!;
  const target = nearestFoe(f);
  f.action = null;
  f.cooldown = C[move].cooldown;
  if (!target) return;
  const d = distance(f, target);
  const ratio = clamp(Math.pow(f.strength / Math.max(0.05, target.strength), 0.8), 0.3, 2.5);
  const where = posOf(target);

  if (move === 'threat') {
    target.morale -= C.threat.morale * ratio;
    f.morale = Math.min(1, f.morale + 0.05);
    events.emit('sfx', { sound: 'growl', x: posOf(f).x, y: posOf(f).y + 0.8, z: posOf(f).z, volume: 0.7 });
    return;
  }
  const spec = C[move];
  if (d > spec.range + 0.4) return; // falla: el rival se ha apartado
  let amount = spec.damage * ratio * (0.8 + 0.4 * rng()) * (0.6 + 0.4 * f.stamina);
  let counter = false;
  if (move === 'swipe' && target.action === 'bite' && target.actionTime < C.bite.windup) {
    // Zarpazo en plena preparación del mordisco: lo interrumpe.
    amount *= C.counterMultiplier;
    target.action = null;
    target.cooldown = 0.9;
    target.morale -= 0.1;
    counter = true;
  }
  const part = damage(target, amount, rng);
  events.emit('sfx', { sound: move === 'bite' ? 'bite' : 'pounce', x: where.x, y: where.y + 0.6, z: where.z, volume: 0.8 });
  const article = part === 'cuello' || part === 'lomo' ? 'el' : 'la';
  combat.lastHit = `${counter ? '¡Contraataque! ' : ''}${f.isPlayer ? 'Hieres a' : f.name + ' hiere a'} ${target.isPlayer ? 'ti' : target.name} en ${article} ${part}`;
  combat.lastHitTime = combat.elapsed;
}

function decide(f: Fighter, rng: () => number): void {
  const target = nearestFoe(f);
  if (!target) return;
  const d = distance(f, target);
  if (d > C.swipe.range + 0.5) return;
  // Contraataque al ver la preparación de un mordisco.
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
  f.stamina -= C[f.action].stamina;
}

export function updateCombat(world: WorldData, dt: number, rng: () => number): void {
  if (!combat.active) return;
  combat.elapsed += dt;
  const me = combat.fighters.find((f) => f.isPlayer)!;

  for (const f of combat.fighters) {
    if (f.out) continue;
    f.cooldown = Math.max(0, f.cooldown - dt);
    f.stamina = Math.min(1, f.stamina + C.staminaRegen * dt);
    f.morale = Math.min(1, f.morale + 0.015 * dt);
    if (f.action) {
      f.actionTime += dt;
      if (f.actionTime >= C[f.action].windup) resolve(f, rng);
    }

    // Retirada: heridas graves o moral por los suelos.
    const health = healthOf(f);
    if (!f.isPlayer && (health < C.fleeHealth || f.morale <= 0)) {
      f.out = true;
      const agent = f.agent!;
      if (health <= 0) {
        agent.alive = false;
        agent.state = 'dead';
        agent.clip = 'die';
        events.emit('subtitle', { text: `${f.name} ha muerto`, seconds: 3 });
      } else {
        agent.state = 'flee';
        agent.timer = 12;
        events.emit('subtitle', { text: `${f.name} huye derrotado`, seconds: 3 });
      }
      continue;
    }

    // Movimiento de los luchadores IA: rodean al rival a distancia de golpe.
    if (!f.isPlayer && f.agent) {
      const target = nearestFoe(f);
      const agent = f.agent;
      if (!target) continue;
      const tp = posOf(target);
      const d = distance(f, target);
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
  }

  // ¿Fin del combate?
  const foes = combat.fighters.filter((f) => f.side === 'enemy' && !f.out);
  const farFromAll = foes.every((f) => distance(me, f) > C.escapeDistance);
  if (!player.alive) end('lose');
  else if (foes.length === 0) end('win');
  else if (farFromAll) end('fled');
}

function end(result: 'win' | 'lose' | 'fled'): void {
  combat.active = false;
  combat.result = result;
  const enemies = combat.fighters.filter((f) => f.side === 'enemy');
  for (const f of combat.fighters) {
    if (f.agent && f.agent.alive && f.agent.state === 'fight') {
      f.agent.state = f.side === 'player' ? 'follow' : 'idle';
      f.agent.timer = 5;
    }
  }
  if (result === 'win') events.emit('subtitle', { text: 'Has ganado la pelea', seconds: 3 });
  if (result === 'fled') events.emit('subtitle', { text: 'Te retiras de la pelea', seconds: 3 });
  for (const fn of endListeners) fn(result, combat.reason, combat.territoryId, enemies);
}

export function resetCombat(): void {
  combat.active = false;
  combat.fighters = [];
  combat.result = null;
}
