import * as THREE from 'three';
import { clock } from '../core/clock';
import { events } from '../core/events';
import { moveTowardsAngle } from '../core/math';
import { createAgent, type Agent } from '../entities/npc/npcState';
import type { LionClipName } from '../entities/lion/lionAnimations';
import { player } from '../entities/player/playerState';
import { abortCombat, addEnemies, combat, onCombatEnd, setCombatProfile, startCombat, type Fighter } from '../systems/combat';
import { addDen, claimDen } from '../systems/dens';
import { recordMilestone } from '../systems/journal';
import { hitPlayer, type HitOptions } from '../systems/playerDefense';
import { gainEssence, grantRelic, progression } from '../systems/progression';
import type { RelicId } from '../systems/relics';
import type { WorldData } from '../world/WorldData';
import { distXZ } from './steering';

/**
 * Motor de jefes por datos. Cada jefe tiene un claro (con muro de niebla durante la pelea),
 * dos fases, una lista de ataques telegrafiados con pesos y distancias, invocaciones a
 * ciertos umbrales de vida y una recompensa (esencia, reliquia, guarida).
 */
export type ModelKind = 'hyena' | 'lion' | 'leopard' | 'croc' | 'buffalo';
export type AttackKind = 'combo' | 'lunge' | 'charge' | 'aoe' | 'vanish' | 'submerge';

export interface AttackDef {
  kind: AttackKind;
  weight: number;
  /** Fase mínima en la que lo usa. */
  phase?: 1 | 2;
  minDist?: number;
  maxDist?: number;
  windup: number;
  damage: number;
  hits?: number;
  interval?: number;
  range?: number;
  speed?: number;
  duration?: number;
  radius?: number;
  unblockable?: boolean;
  stagger?: number;
  guardCost?: number;
  /** Oscurece la pantalla mientras carga. */
  eclipse?: boolean;
  telegraph: string;
  windupClip?: LionClipName;
}

export interface SummonDef {
  /** Umbral de vida del jefe (o 1 = al empezar). */
  at: number;
  count: number;
  model: ModelKind;
  name: string;
  strength: number;
  damageTaken?: number;
  spectral?: boolean;
}

export interface BossDef {
  id: string;
  name: string;
  title: string;
  model: ModelKind;
  scale: number;
  /** Leones y leopardos: hembra y oscuridad de la melena. */
  female?: boolean;
  mane?: number;
  /** Color del pelaje/piel y del brillo sobrenatural. */
  tint: string;
  glow: string;
  eyes: string;
  minAge: number;
  strength: number;
  damageTaken: number;
  postureTaken: number;
  speed: [number, number];
  phase2At: number;
  phase2Title: string;
  phase2Text: string;
  attacks: AttackDef[];
  summons: SummonDef[];
  nightOnly?: boolean;
  relic?: RelicId;
  essence: number;
  /** Guarida que se reclama al vencerlo. */
  den?: { id: string; name: string };
  intro: string;
  victory: string;
  arenaRadius: number;
}

interface ActiveAttack {
  def: AttackDef;
  t: number;
  hits: number;
  dirX: number;
  dirZ: number;
}

export interface BossInstance {
  def: BossDef;
  agent: Agent;
  arena: THREE.Vector3;
  state: 'dormant' | 'fight' | 'defeated';
  phase: 1 | 2;
  attack: ActiveAttack | null;
  nextAttack: number;
  summons: number;
  minions: { agent: Agent; model: ModelKind; spectral: boolean }[];
  eclipse: number;
  vanish: number;
  warnedYoung: boolean;
  warnedDay: boolean;
  seen: Set<AttackDef>;
  initialized: boolean;
}

export const bosses: BossInstance[] = [];
let minionSeed = 0;

export function createBoss(def: BossDef): BossInstance {
  return {
    def,
    agent: createAgent<string>(`boss-${def.id}`, def.name, 'female', 12, 'idle'),
    arena: new THREE.Vector3(),
    state: 'dormant',
    phase: 1,
    attack: null,
    nextAttack: 1.5,
    summons: 0,
    minions: [],
    eclipse: 0,
    vanish: 0,
    warnedYoung: false,
    warnedDay: false,
    seen: new Set(),
    initialized: false,
  };
}

/** Coloca el jefe en su claro y lo registra. */
export function placeBoss(b: BossInstance, world: WorldData, x: number, z: number): void {
  b.arena.set(x, world.heightAt(x, z), z);
  if (b.def.den) addDen({ id: b.def.den.id, name: b.def.den.name, x: x - 8, z: z - 8, claimed: false });
  if (!bosses.includes(b)) bosses.push(b);
  resetBoss(b, world, progression.bossesDefeated.includes(b.def.id));
  b.initialized = true;
}

export function resetBoss(b: BossInstance, world: WorldData | null, defeated = false): void {
  const a = b.agent;
  a.health = 1;
  a.alive = !defeated;
  a.state = 'idle';
  a.clip = defeated ? 'die' : 'rest';
  a.speed = 0;
  a.position.copy(b.arena);
  if (world) a.position.y = world.heightAt(a.position.x, a.position.z);
  b.state = defeated ? 'defeated' : 'dormant';
  b.phase = 1;
  b.attack = null;
  b.nextAttack = 1.5;
  b.summons = 0;
  b.minions = [];
  b.eclipse = 0;
  b.vanish = 0;
  if (defeated && b.def.den) claimDen(b.def.den.id);
}

export const activeBoss = (): BossInstance | null => bosses.find((b) => b.state === 'fight') ?? null;
const fighterOf = (b: BossInstance): Fighter | undefined => combat.fighters.find((f) => f.agent === b.agent);

function beginFight(b: BossInstance): void {
  const a = b.agent;
  const d = b.def;
  b.state = 'fight';
  setCombatProfile(a, {
    name: d.name,
    strength: d.strength,
    skill: 0.9,
    aggression: 0.9,
    damageTaken: d.damageTaken,
    postureTaken: d.postureTaken,
    external: true,
    isBoss: true,
    cause: 'boss',
    fleeHealth: 0,
  });
  startCombat([a], 'boss', null);
  events.emit('banner', { text: d.name, tone: 'info', seconds: 3.5 });
  events.emit('subtitle', { text: d.intro, seconds: 5 });
  events.emit('sfx', { sound: d.model === 'hyena' ? 'hyenaWhoop' : 'roar', x: a.position.x, y: a.position.y + 1.5, z: a.position.z, volume: 1 });
  // Invocaciones que acompañan desde el principio.
  while (b.summons < d.summons.length && d.summons[b.summons].at >= 1) summon(b, d.summons[b.summons++], null);
}

function summon(b: BossInstance, s: SummonDef, world: WorldData | null): void {
  const a = b.agent;
  const created: Agent[] = [];
  for (let i = 0; i < s.count; i++) {
    const ang = (i / s.count) * Math.PI * 2 + Math.random();
    const x = a.position.x + Math.cos(ang) * 7;
    const z = a.position.z + Math.sin(ang) * 7;
    const m = createAgent<string>(`minion-${++minionSeed}`, s.name, 'female', 6, 'fight');
    m.position.set(x, world ? world.heightAt(x, z) : a.position.y, z);
    m.heading = Math.atan2(player.position.x - x, player.position.z - z);
    m.clip = 'trot';
    setCombatProfile(m, { name: s.name, strength: s.strength, skill: 0.6, aggression: 0.8, damageTaken: s.damageTaken ?? 1.4, cause: 'boss', fleeHealth: 0 });
    created.push(m);
    b.minions.push({ agent: m, model: s.model, spectral: !!s.spectral });
  }
  addEnemies(created);
  events.emit('subtitle', { text: `[${b.def.name} llama a los suyos: ${s.count} × ${s.name.toLowerCase()}]`, seconds: 3.5 });
}

function bump(a: Agent, clip: LionClipName): void {
  a.clip = clip;
  a.clipNonce = (a.clipNonce ?? 0) + 1;
}

function startAttack(b: BossInstance, def: AttackDef, dirX: number, dirZ: number): void {
  b.attack = { def, t: 0, hits: 0, dirX, dirZ };
  if (!b.seen.has(def)) {
    b.seen.add(def);
    events.emit('boss:telegraph', { text: def.telegraph });
  }
  bump(b.agent, def.windupClip ?? (def.kind === 'lunge' || def.kind === 'charge' ? 'stalkIdle' : def.kind === 'aoe' ? 'roar' : 'snarl'));
}

function chooseAttack(b: BossInstance, d: number, dx: number, dz: number): void {
  const options = b.def.attacks.filter(
    (a) => (a.phase ?? 1) <= b.phase && d >= (a.minDist ?? 0) && d <= (a.maxDist ?? 99),
  );
  if (options.length === 0) return;
  let r = Math.random() * options.reduce((s, a) => s + a.weight, 0);
  let chosen = options[0];
  for (const o of options) {
    r -= o.weight;
    if (r <= 0) {
      chosen = o;
      break;
    }
  }
  startAttack(b, chosen, dx, dz);
  b.nextAttack = (b.phase === 2 ? 1.0 : 1.6) + Math.random() * 1.2;
}

function inFront(b: BossInstance, range: number, cone = 0.9): boolean {
  const a = b.agent;
  const dx = player.position.x - a.position.x;
  const dz = player.position.z - a.position.z;
  const d = Math.hypot(dx, dz);
  if (d > range) return false;
  const ang = Math.atan2(dx, dz) - a.heading;
  return Math.abs(Math.atan2(Math.sin(ang), Math.cos(ang))) < cone;
}

function hit(b: BossInstance, def: AttackDef): void {
  const opts: HitOptions = { guardCost: def.guardCost, unblockable: def.unblockable, stagger: def.stagger };
  const res = hitPlayer(def.damage, 'boss', opts);
  const f = fighterOf(b);
  if (res === 'parried' && f) {
    f.stagger = Math.max(f.stagger, 0.9);
    f.posture = Math.min(1, f.posture + 0.3);
    f.postureIdle = 0;
    b.attack = null;
  }
}

function faceP(b: BossInstance, rate: number, dt: number): void {
  const a = b.agent;
  a.heading = moveTowardsAngle(a.heading, Math.atan2(player.position.x - a.position.x, player.position.z - a.position.z), rate * dt);
}

function updateAttack(b: BossInstance, world: WorldData, dt: number): void {
  const atk = b.attack!;
  const def = atk.def;
  const a = b.agent;
  atk.t += dt;
  const w = def.windup;
  switch (def.kind) {
    case 'combo': {
      const n = def.hits ?? 3;
      const step = def.interval ?? 0.42;
      if (atk.t < w) faceP(b, 6, dt);
      if (atk.hits < n && atk.t >= w + atk.hits * step) {
        bump(a, atk.hits % 2 === 1 && b.def.model !== 'hyena' ? 'swipe' : 'bite');
        if (inFront(b, (def.range ?? 3.4) * Math.max(1, b.def.scale * 0.6))) hit(b, def);
        atk.hits++;
      }
      if (atk.t > w && atk.t < w + n * step) {
        a.position.x += Math.sin(a.heading) * 2.4 * dt;
        a.position.z += Math.cos(a.heading) * 2.4 * dt;
      }
      if (atk.t > w + n * step + 0.4) b.attack = null;
      break;
    }
    case 'lunge':
    case 'charge': {
      const dur = def.duration ?? (def.kind === 'charge' ? 1.3 : 0.7);
      if (atk.t < w) {
        const dx = player.position.x - a.position.x;
        const dz = player.position.z - a.position.z;
        const d = Math.max(0.1, Math.hypot(dx, dz));
        atk.dirX = dx / d;
        atk.dirZ = dz / d;
        a.heading = Math.atan2(atk.dirX, atk.dirZ);
      } else if (atk.t < w + dur) {
        a.clip = 'run';
        const sp = def.speed ?? 15;
        a.position.x += atk.dirX * sp * dt;
        a.position.z += atk.dirZ * sp * dt;
        if (atk.hits === 0 && distXZ(a.position, player.position) < 1.6 + b.def.scale * 0.5) {
          atk.hits = 1;
          hit(b, def);
        }
      } else {
        // Una embestida fallida lo deja aturdido un momento.
        if (def.kind === 'charge' && atk.hits === 0) {
          const f = fighterOf(b);
          if (f) f.stagger = Math.max(f.stagger, 1.6);
          events.emit('combat:feat', { text: `${b.def.name} se estrella`, kind: 'break' });
        }
        b.attack = null;
      }
      break;
    }
    case 'aoe': {
      if (def.eclipse) b.eclipse = Math.min(1, atk.t / w);
      if (atk.hits === 0 && atk.t >= w) {
        atk.hits = 1;
        if (distXZ(a.position, player.position) < (def.radius ?? 10)) hit(b, def);
        events.emit('sfx', { sound: b.def.model === 'hyena' ? 'hyenaWhoop' : 'roar', x: a.position.x, y: a.position.y + 1.5, z: a.position.z, volume: 1 });
      }
      if (atk.t > w + 0.9) b.attack = null;
      break;
    }
    case 'vanish':
    case 'submerge': {
      if (atk.t < w) {
        b.vanish = 0.6;
      } else if (atk.hits === 0) {
        atk.hits = 1;
        // Reaparece a tu espalda (sombra) o delante, saliendo del agua o del follaje.
        const ang = def.kind === 'vanish' ? player.heading + Math.PI : player.heading;
        const dist = def.kind === 'vanish' ? 2.6 : 3.2;
        a.position.set(player.position.x + Math.sin(ang) * dist, 0, player.position.z + Math.cos(ang) * dist);
        a.position.y = world.heightAt(a.position.x, a.position.z);
        a.heading = Math.atan2(player.position.x - a.position.x, player.position.z - a.position.z);
        b.vanish = 0;
      } else if (atk.hits === 1 && atk.t >= w + 0.45) {
        atk.hits = 2;
        bump(a, 'bite');
        if (inFront(b, 3.6 + b.def.scale * 0.4, 1.2)) hit(b, def);
      } else if (atk.t > w + 0.9) b.attack = null;
      break;
    }
  }
}

function updateOne(b: BossInstance, world: WorldData, dt: number): void {
  const a = b.agent;
  const def = b.def;
  b.vanish = Math.max(0, b.vanish - dt);
  if (!b.attack || !b.attack.def.eclipse) b.eclipse = Math.max(0, b.eclipse - dt * 1.5);
  if (b.state === 'defeated') return;
  const d = distXZ(a.position, player.position);

  if (b.state === 'dormant') {
    const absent = def.nightOnly && !clock.isNight;
    a.clip = absent ? 'rest' : d < 45 ? 'snarl' : 'rest';
    if (!absent && d < 45) faceP(b, 2, dt);
    if (d < 70) recordMilestone(`found:${def.id}`, `Encuentras el claro de ${def.name}`);
    if (!player.alive || d > def.arenaRadius + 4 || combat.active) return;
    if (absent) {
      if (!b.warnedDay) {
        b.warnedDay = true;
        events.emit('subtitle', { text: `Aquí solo hay huellas. ${def.name} solo caza de noche.`, seconds: 4 });
      }
      return;
    }
    if (player.ageYears < def.minAge) {
      if (!b.warnedYoung) {
        b.warnedYoung = true;
        events.emit('subtitle', { text: `Una presencia antigua te observa. Aún no estás preparado (${def.minAge} años).`, seconds: 5 });
      }
      return;
    }
    beginFight(b);
    return;
  }

  if (!combat.active) return;
  // Muro de niebla: no se puede salir del claro.
  const pd = distXZ(player.position, b.arena);
  if (pd > def.arenaRadius) {
    const k = def.arenaRadius / pd;
    player.position.x = b.arena.x + (player.position.x - b.arena.x) * k;
    player.position.z = b.arena.z + (player.position.z - b.arena.z) * k;
  }
  const f = fighterOf(b);
  if (!f || f.out) return;

  if (b.phase === 1 && a.health < def.phase2At) {
    b.phase = 2;
    b.attack = null;
    events.emit('banner', { text: def.phase2Title, tone: 'info', seconds: 2.5 });
    events.emit('subtitle', { text: def.phase2Text, seconds: 4 });
    const opener = def.attacks.find((x) => x.phase === 2 && x.kind === 'aoe') ?? def.attacks.find((x) => x.phase === 2);
    if (opener) startAttack(b, opener, 0, 0);
  }
  if (b.summons < def.summons.length && a.health < def.summons[b.summons].at) summon(b, def.summons[b.summons++], world);

  if (f.stagger > 0) {
    b.attack = null;
    a.clip = 'snarl';
    a.speed = 0;
  } else if (b.attack) {
    updateAttack(b, world, dt);
  } else {
    const dx = player.position.x - a.position.x;
    const dz = player.position.z - a.position.z;
    const dir = Math.atan2(dx, dz);
    const near = 4 + def.scale * 1.2;
    a.heading = moveTowardsAngle(a.heading, d > near ? dir : dir + 1.2, 4 * dt);
    const speed = d > near ? def.speed[b.phase - 1] : 1.6;
    a.position.x += Math.sin(a.heading) * speed * dt;
    a.position.z += Math.cos(a.heading) * speed * dt;
    a.speed = speed;
    a.clip = speed > 3 ? 'trot' : 'walk';
    b.nextAttack -= dt;
    if (b.nextAttack <= 0) chooseAttack(b, d, dx / Math.max(0.1, d), dz / Math.max(0.1, d));
  }
  const bd = distXZ(a.position, b.arena);
  if (bd > def.arenaRadius - 2) {
    const k = (def.arenaRadius - 2) / bd;
    a.position.x = b.arena.x + (a.position.x - b.arena.x) * k;
    a.position.z = b.arena.z + (a.position.z - b.arena.z) * k;
  }
  a.position.y = world.heightAt(a.position.x, a.position.z);
}

export function updateBosses(world: WorldData, dt: number): void {
  for (const b of bosses) if (b.initialized) updateOne(b, world, dt);
}

/** Tras morir: el jefe en pelea vuelve a su claro con la vida entera. */
export function resetBossesAfterDeath(world: WorldData | null): void {
  for (const b of bosses) {
    if (b.state !== 'fight') continue;
    abortCombat();
    resetBoss(b, world, false);
  }
}

export function clearBosses(): void {
  bosses.length = 0;
}

onCombatEnd((result, reason) => {
  if (reason !== 'boss' || result !== 'win') return;
  const b = activeBoss();
  if (!b) return;
  const def = b.def;
  b.state = 'defeated';
  b.attack = null;
  b.eclipse = 0;
  b.agent.alive = false;
  b.agent.clip = 'die';
  for (const m of b.minions) m.agent.alive = false;
  if (!progression.bossesDefeated.includes(def.id)) progression.bossesDefeated.push(def.id);
  events.emit('banner', { text: 'Leyenda abatida', tone: 'victory', seconds: 5 });
  gainEssence(def.essence, def.name);
  if (def.relic) grantRelic(def.relic);
  if (def.den) claimDen(def.den.id);
  recordMilestone(`boss:${def.id}`, def.victory);
  events.emit('subtitle', { text: def.victory, seconds: 6 });
  for (const fn of victoryListeners) fn(def.id);
});

type VictoryListener = (bossId: string) => void;
const victoryListeners = new Set<VictoryListener>();
export function onBossDefeated(fn: VictoryListener): () => void {
  victoryListeners.add(fn);
  return () => victoryListeners.delete(fn);
}
