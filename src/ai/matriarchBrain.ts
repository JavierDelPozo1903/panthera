import * as THREE from 'three';
import { events } from '../core/events';
import { moveTowardsAngle } from '../core/math';
import { createAgent, type Agent } from '../entities/npc/npcState';
import { player } from '../entities/player/playerState';
import { abortCombat, addEnemies, combat, onCombatEnd, setCombatProfile, startCombat, type Fighter } from '../systems/combat';
import { addDen, claimDen } from '../systems/dens';
import { recordMilestone } from '../systems/journal';
import { hitPlayer } from '../systems/playerDefense';
import { gainEssence, progression } from '../systems/progression';
import type { WorldData } from '../world/WorldData';
import { distXZ } from './steering';

/**
 * La Matriarca: reina de un clan de hienas que no muere del todo. Vive en el Cementerio de
 * Huesos, un kopje de la sabana. Primer jefe del juego.
 *
 *  Fase I  — dentellada triple, embestida espectral y llamada del clan (hienas espectrales).
 *  Fase II — (por debajo de la mitad de la vida) aullido del eclipse, que solo se evita
 *            esquivando en el momento justo, y paso de sombra: desaparece y reaparece a tu
 *            espalda.
 */

export const BOSS_ID = 'matriarch';
const ARENA_RADIUS = 30;
const TRIGGER_RADIUS = 34;
const MIN_AGE = 2;

type AttackKind = 'triple' | 'lunge' | 'howl' | 'shadow';

interface Attack {
  kind: AttackKind;
  t: number;
  hits: number;
  dirX: number;
  dirZ: number;
}

export const matriarch = {
  agent: createAgent<string>('boss-matriarch', 'La Matriarca', 'female', 14, 'idle'),
  arena: new THREE.Vector3(),
  state: 'dormant' as 'dormant' | 'fight' | 'defeated',
  phase: 1 as 1 | 2,
  attack: null as Attack | null,
  nextAttack: 1.5,
  summons: 0,
  minions: [] as Agent[],
  /** [0, 1]: oscurecimiento de la pantalla durante el aullido. */
  eclipse: 0,
  /** Segundos que quedan invisible (paso de sombra). */
  vanish: 0,
  warnedYoung: false,
  seen: new Set<AttackKind>(),
  initialized: false,
};

const TELEGRAPH: Record<AttackKind, string> = {
  triple: 'La Matriarca abre las fauces: tres dentelladas seguidas',
  lunge: 'Se agazapa entre los huesos… ¡va a embestir!',
  howl: 'Aúlla a la luna rota: esquiva en el último instante',
  shadow: 'Se disuelve en sombra… mira a tu espalda',
};

const WINDUP: Record<AttackKind, number> = { triple: 0.65, lunge: 0.9, howl: 1.35, shadow: 0.7 };

let minionSeed = 0;

/** Coloca el cementerio en un kopje alejado de la madriguera natal. */
export function initMatriarch(world: WorldData, denX: number, denZ: number): void {
  const kopjes = [...world.features.kopjes].sort(
    (a, b) => Math.abs(Math.hypot(a.x - denX, a.z - denZ) - 650) - Math.abs(Math.hypot(b.x - denX, b.z - denZ) - 650),
  );
  const k = kopjes.find((c) => Math.hypot(c.x - denX, c.z - denZ) > 300) ?? { x: denX + 600, z: denZ + 200 };
  // El claro de la pelea: en llano, a unos 80 m del kopje en dirección a la madriguera
  // (las rocas no deben tapar la pelea).
  const dx = denX - k.x;
  const dz = denZ - k.z;
  const dl = Math.hypot(dx, dz) || 1;
  let ax = k.x + (dx / dl) * 80;
  let az = k.z + (dz / dl) * 80;
  // Busca el punto más llano de los alrededores.
  let best = Infinity;
  for (let i = 0; i < 24; i++) {
    const r = 80 + (i % 3) * 25;
    const ang = Math.atan2(dz, dx) + ((i / 3) | 0) * 0.35 - 1.2;
    const x = k.x + Math.cos(ang) * r;
    const z = k.z + Math.sin(ang) * r;
    if (world.waterLevelAt(x, z) !== null) continue;
    let slope = 0;
    for (const [ox, oz] of [[20, 0], [-20, 0], [0, 20], [0, -20]]) slope += Math.abs(world.heightAt(x + ox, z + oz) - world.heightAt(x, z));
    if (slope < best) {
      best = slope;
      ax = x;
      az = z;
    }
  }
  matriarch.arena.set(ax, world.heightAt(ax, az), az);
  addDen({ id: 'cemetery', name: 'Guarida del Cementerio', x: ax - 6, z: az - 6, claimed: false });
  resetMatriarch(world, progression.bossesDefeated.includes(BOSS_ID));
  matriarch.initialized = true;
}

export function resetMatriarch(world: WorldData | null, defeated = false): void {
  const a = matriarch.agent;
  a.health = 1;
  a.alive = !defeated;
  a.state = 'idle';
  a.clip = defeated ? 'die' : 'rest';
  a.speed = 0;
  a.position.copy(matriarch.arena);
  if (world) a.position.y = world.heightAt(a.position.x, a.position.z);
  matriarch.state = defeated ? 'defeated' : 'dormant';
  matriarch.phase = 1;
  matriarch.attack = null;
  matriarch.nextAttack = 1.5;
  matriarch.summons = 0;
  matriarch.minions = [];
  matriarch.eclipse = 0;
  matriarch.vanish = 0;
  if (defeated) claimDen('cemetery');
}

function bossFighter(): Fighter | undefined {
  return combat.fighters.find((f) => f.agent === matriarch.agent);
}

function beginFight(): void {
  const a = matriarch.agent;
  matriarch.state = 'fight';
  setCombatProfile(a, {
    name: 'La Matriarca',
    strength: 1.45,
    skill: 0.9,
    aggression: 0.9,
    damageTaken: 0.5,
    postureTaken: 0.65,
    external: true,
    isBoss: true,
    cause: 'boss',
    fleeHealth: 0,
  });
  startCombat([a], 'boss', null);
  events.emit('banner', { text: 'La Matriarca', tone: 'info', seconds: 3.5 });
  events.emit('subtitle', { text: 'Reina del clan de la Luna Rota. Los huesos de este claro son de quienes la desafiaron.', seconds: 5 });
  events.emit('sfx', { sound: 'hyenaWhoop', x: a.position.x, y: a.position.y + 1.5, z: a.position.z, volume: 1 });
}

function summon(world: WorldData, count: number): void {
  const a = matriarch.agent;
  const created: Agent[] = [];
  for (let i = 0; i < count; i++) {
    const ang = (i / count) * Math.PI * 2 + Math.random();
    const x = a.position.x + Math.cos(ang) * 7;
    const z = a.position.z + Math.sin(ang) * 7;
    const m = createAgent<string>(`spectral-${++minionSeed}`, 'Hiena espectral', 'female', 6, 'fight');
    m.position.set(x, world.heightAt(x, z), z);
    m.heading = Math.atan2(player.position.x - x, player.position.z - z);
    m.clip = 'trot';
    setCombatProfile(m, { name: 'Hiena espectral', strength: 0.5, skill: 0.5, aggression: 0.8, damageTaken: 1.6, cause: 'boss', fleeHealth: 0 });
    created.push(m);
  }
  matriarch.minions.push(...created);
  addEnemies(created);
  events.emit('sfx', { sound: 'hyenaGiggle', x: a.position.x, y: a.position.y + 1, z: a.position.z, volume: 1 });
  events.emit('subtitle', { text: '[La Matriarca llama a su clan: risas que vienen de ninguna parte]', seconds: 3.5 });
}

function startAttack(kind: AttackKind, dirX: number, dirZ: number): void {
  matriarch.attack = { kind, t: 0, hits: 0, dirX, dirZ };
  if (!matriarch.seen.has(kind)) {
    matriarch.seen.add(kind);
    events.emit('boss:telegraph', { text: TELEGRAPH[kind] });
  }
  const a = matriarch.agent;
  a.clip = kind === 'lunge' ? 'stalkIdle' : kind === 'howl' ? 'roar' : 'snarl';
  a.clipNonce = (a.clipNonce ?? 0) + 1;
}

function chooseAttack(d: number, dx: number, dz: number): void {
  const r = Math.random();
  const p2 = matriarch.phase === 2;
  if (p2 && r < 0.22) startAttack('howl', dx, dz);
  else if (p2 && r < 0.42) startAttack('shadow', dx, dz);
  else if (d < 4.6) startAttack('triple', dx, dz);
  else if (d < 18) startAttack('lunge', dx, dz);
  else return;
  matriarch.nextAttack = (p2 ? 1.1 : 1.7) + Math.random() * 1.2;
}

/** Alcance frontal: el jugador está delante de la Matriarca y a menos de `range`. */
function inFront(range: number, cone = 0.9): boolean {
  const a = matriarch.agent;
  const dx = player.position.x - a.position.x;
  const dz = player.position.z - a.position.z;
  const d = Math.hypot(dx, dz);
  if (d > range) return false;
  const ang = Math.atan2(dx, dz) - a.heading;
  return Math.abs(Math.atan2(Math.sin(ang), Math.cos(ang))) < cone;
}

function hit(amount: number, opts: Parameters<typeof hitPlayer>[2] = {}): void {
  const res = hitPlayer(amount, 'boss', opts);
  const f = bossFighter();
  if (res === 'parried' && f) {
    f.stagger = Math.max(f.stagger, 0.9);
    f.posture = Math.min(1, f.posture + 0.3);
    f.postureIdle = 0;
    matriarch.attack = null;
  }
}

function updateAttack(world: WorldData, dt: number): void {
  const atk = matriarch.attack!;
  const a = matriarch.agent;
  atk.t += dt;
  const w = WINDUP[atk.kind];
  switch (atk.kind) {
    case 'triple': {
      // Tres mordiscos, avanzando un poco con cada uno.
      const times = [w, w + 0.42, w + 0.84];
      if (atk.t < w) a.heading = moveTowardsAngle(a.heading, Math.atan2(player.position.x - a.position.x, player.position.z - a.position.z), 6 * dt);
      if (atk.hits < 3 && atk.t >= times[atk.hits]) {
        a.clip = 'bite';
        a.clipNonce = (a.clipNonce ?? 0) + 1;
        if (inFront(3.6)) hit(0.075, { guardCost: 0.22 });
        atk.hits++;
      }
      if (atk.t > w && atk.t < w + 1.0) {
        a.position.x += Math.sin(a.heading) * 2.4 * dt;
        a.position.z += Math.cos(a.heading) * 2.4 * dt;
      }
      if (atk.t > w + 1.3) matriarch.attack = null;
      break;
    }
    case 'lunge': {
      if (atk.t < w) {
        const dx = player.position.x - a.position.x;
        const dz = player.position.z - a.position.z;
        const d = Math.max(0.1, Math.hypot(dx, dz));
        atk.dirX = dx / d;
        atk.dirZ = dz / d;
        a.heading = Math.atan2(atk.dirX, atk.dirZ);
      } else if (atk.t < w + 0.7) {
        a.clip = 'run';
        a.position.x += atk.dirX * 15 * dt;
        a.position.z += atk.dirZ * 15 * dt;
        if (atk.hits === 0 && distXZ(a.position, player.position) < 2.3) {
          atk.hits = 1;
          hit(0.16, { guardCost: 0.5, stagger: 0.6 });
        }
      } else matriarch.attack = null;
      break;
    }
    case 'howl': {
      matriarch.eclipse = Math.min(1, atk.t / w);
      if (atk.hits === 0 && atk.t >= w) {
        atk.hits = 1;
        if (distXZ(a.position, player.position) < 11) hit(0.15, { unblockable: true, stagger: 0.8 });
        events.emit('sfx', { sound: 'hyenaWhoop', x: a.position.x, y: a.position.y + 1.5, z: a.position.z, volume: 1 });
      }
      if (atk.t > w + 0.9) matriarch.attack = null;
      break;
    }
    case 'shadow': {
      if (atk.t < w) {
        matriarch.vanish = 0.6;
      } else if (atk.hits === 0) {
        // Reaparece detrás del jugador.
        atk.hits = 1;
        const back = player.heading + Math.PI;
        a.position.set(player.position.x + Math.sin(back) * 2.6, 0, player.position.z + Math.cos(back) * 2.6);
        a.position.y = world.heightAt(a.position.x, a.position.z);
        a.heading = Math.atan2(player.position.x - a.position.x, player.position.z - a.position.z);
        matriarch.vanish = 0;
      } else if (atk.hits === 1 && atk.t >= w + 0.45) {
        atk.hits = 2;
        a.clip = 'bite';
        a.clipNonce = (a.clipNonce ?? 0) + 1;
        if (inFront(3.4, 1.2)) hit(0.11, { guardCost: 0.3 });
      } else if (atk.t > w + 0.9) matriarch.attack = null;
      break;
    }
  }
}

export function updateMatriarch(world: WorldData, dt: number): void {
  if (!matriarch.initialized) return;
  const a = matriarch.agent;
  matriarch.vanish = Math.max(0, matriarch.vanish - dt);
  if (!matriarch.attack || matriarch.attack.kind !== 'howl') matriarch.eclipse = Math.max(0, matriarch.eclipse - dt * 1.5);
  if (matriarch.state === 'defeated') return;
  const d = distXZ(a.position, player.position);

  if (matriarch.state === 'dormant') {
    a.clip = d < 45 ? 'snarl' : 'rest';
    if (d < 45) a.heading = moveTowardsAngle(a.heading, Math.atan2(player.position.x - a.position.x, player.position.z - a.position.z), 2 * dt);
    if (!player.alive || d > TRIGGER_RADIUS || combat.active) return;
    if (player.ageYears < MIN_AGE) {
      if (!matriarch.warnedYoung) {
        matriarch.warnedYoung = true;
        events.emit('subtitle', { text: 'Una presencia antigua te observa desde los huesos. Aún no estás preparado.', seconds: 5 });
      }
      return;
    }
    beginFight();
    return;
  }

  // --- Pelea ---
  if (!combat.active) return;
  // Muro de niebla: no se puede salir del claro.
  const pd = distXZ(player.position, matriarch.arena);
  if (pd > ARENA_RADIUS) {
    const k = ARENA_RADIUS / pd;
    player.position.x = matriarch.arena.x + (player.position.x - matriarch.arena.x) * k;
    player.position.z = matriarch.arena.z + (player.position.z - matriarch.arena.z) * k;
  }
  const f = bossFighter();
  if (!f || f.out) return;

  if (matriarch.phase === 1 && a.health < 0.5) {
    matriarch.phase = 2;
    matriarch.attack = null;
    events.emit('banner', { text: 'La luna se rompe', tone: 'info', seconds: 2.5 });
    events.emit('subtitle', { text: 'La Matriarca se alza entre sombras: ya no está sola en su cuerpo', seconds: 4 });
    startAttack('howl', 0, 0);
  }
  const thresholds = [0.75, 0.35];
  if (matriarch.summons < thresholds.length && a.health < thresholds[matriarch.summons]) {
    summon(world, matriarch.summons === 0 ? 2 : 3);
    matriarch.summons++;
  }

  if (f.stagger > 0) {
    matriarch.attack = null;
    a.clip = 'snarl';
    a.speed = 0;
    return;
  }
  if (matriarch.attack) {
    updateAttack(world, dt);
  } else {
    // Rodea al jugador a media distancia, con andar de depredadora.
    const dx = player.position.x - a.position.x;
    const dz = player.position.z - a.position.z;
    const dir = Math.atan2(dx, dz);
    const want = d > 6 ? dir : dir + 1.2;
    a.heading = moveTowardsAngle(a.heading, want, 4 * dt);
    const speed = d > 6 ? (matriarch.phase === 2 ? 6 : 4.5) : 1.6;
    a.position.x += Math.sin(a.heading) * speed * dt;
    a.position.z += Math.cos(a.heading) * speed * dt;
    a.speed = speed;
    a.clip = speed > 3 ? 'trot' : 'walk';
    matriarch.nextAttack -= dt;
    if (matriarch.nextAttack <= 0) chooseAttack(d, dx / Math.max(0.1, d), dz / Math.max(0.1, d));
  }
  // Se mantiene dentro del claro.
  const bd = distXZ(a.position, matriarch.arena);
  if (bd > ARENA_RADIUS - 2) {
    const k = (ARENA_RADIUS - 2) / bd;
    a.position.x = matriarch.arena.x + (a.position.x - matriarch.arena.x) * k;
    a.position.z = matriarch.arena.z + (a.position.z - matriarch.arena.z) * k;
  }
  a.position.y = world.heightAt(a.position.x, a.position.z);
}

/** Tras morir o descansar: la Matriarca vuelve a su claro con la vida entera. */
export function resetBossAfterDeath(world: WorldData | null): void {
  if (matriarch.state !== 'fight') return;
  abortCombat();
  resetMatriarch(world, false);
}

onCombatEnd((result, reason) => {
  if (reason !== 'boss' || matriarch.state !== 'fight') return;
  if (result !== 'win') return;
  matriarch.state = 'defeated';
  matriarch.attack = null;
  matriarch.eclipse = 0;
  matriarch.agent.alive = false;
  matriarch.agent.clip = 'die';
  for (const m of matriarch.minions) m.alive = false;
  if (!progression.bossesDefeated.includes(BOSS_ID)) progression.bossesDefeated.push(BOSS_ID);
  if (!progression.relics.includes('Diente de la Matriarca')) progression.relics.push('Diente de la Matriarca');
  events.emit('banner', { text: 'Leyenda abatida', tone: 'victory', seconds: 5 });
  gainEssence(2500, 'La Matriarca');
  claimDen('cemetery');
  recordMilestone('boss:matriarch', 'Venciste a La Matriarca, reina del clan de la Luna Rota. Su diente es ahora tuyo');
  events.emit('subtitle', { text: 'Obtienes una reliquia: Diente de la Matriarca. El camino al Kalahari queda abierto', seconds: 6 });
});
