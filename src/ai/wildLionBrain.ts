import lionData from '../data/lion.json';
import { events } from '../core/events';
import { useGame } from '../core/store';
import { nearestCarcass, eatFrom } from '../entities/carcass/carcassState';
import { allies, wildLions, type WildLion } from '../entities/npc/wildLions';
import { player } from '../entities/player/playerState';
import { combat, startCombat } from '../systems/combat';
import { residentsOf, territories, type Territory } from '../world/territories';
import type { WorldData } from '../world/WorldData';
import { clipForSpeed, distXZ, steerTowards } from './steering';
import { lionScale } from '../entities/lion/lionRig';

const L = lionData.locomotion;
const T = lionData.territory;

/** Estado de vigilancia de cada territorio frente al jugador. */
const watch = new Map<number, { intrusion: number; warned: boolean; avoidUntil: number }>();
let elapsed = 0;

function watchOf(id: number) {
  let w = watch.get(id);
  if (!w) {
    w = { intrusion: 0, warned: false, avoidUntil: 0 };
    watch.set(id, w);
  }
  return w;
}

export function resetWildBrain(): void {
  watch.clear();
  elapsed = 0;
}

/**
 * Respuesta a los rugidos del jugador: las manadas cuentan cuántos leones rugen. Si les
 * superan en número, se retiran; si no, acuden a enfrentarse.
 */
events.on('player:roar', ({ x, z }) => {
  const count = 1 + allies().length;
  // Los aliados rugen a coro.
  for (const a of allies()) events.emit('npc:roar', { x: a.position.x, z: a.position.z, name: a.name });
  for (const t of territories) {
    if (t.owner !== 'rival') continue;
    const d = Math.hypot(t.center.x - x, t.center.z - z);
    if (d > T.roarHearingM) continue;
    const residents = residentsOf(t.id);
    if (residents.length === 0) continue;
    const w = watchOf(t.id);
    if (count > residents.length) {
      w.avoidUntil = elapsed + 60;
      events.emit('subtitle', { text: `[La ${t.name.toLowerCase()} calla: sois más]`, seconds: 3 });
    } else {
      const r = residents[0];
      events.emit('npc:roar', { x: r.position.x, z: r.position.z, name: r.name });
      events.emit('subtitle', { text: `[${r.name}, el residente de la ${t.name.toLowerCase()}, responde con un rugido]`, seconds: 3.5 });
      for (const res of residents) {
        if (res.state === 'fight') continue;
        res.state = 'confront';
        res.target.set(x, 0, z);
        res.timer = 60;
      }
    }
  }
});

/** ¿Es el jugador un intruso para los residentes de este territorio? */
function playerIntrudes(t: Territory): boolean {
  if (!player.alive || t.owner !== 'rival') return false;
  const { sex } = useGame.getState();
  if (sex !== 'male' || player.ageYears < 2) return false;
  return distXZ(player.position, t.center) < t.radius;
}

export function updateWildLions(world: WorldData, dt: number, rng: () => number): void {
  elapsed += dt;
  for (const t of territories) {
    if (t.owner !== 'rival') continue;
    const w = watchOf(t.id);
    const residents = residentsOf(t.id);
    if (residents.length === 0) continue;
    if (playerIntrudes(t) && elapsed > w.avoidUntil && !combat.active) {
      w.intrusion += dt;
      const closest = Math.min(...residents.map((r) => distXZ(r.position, player.position)));
      if (!w.warned && closest < 60) {
        w.warned = true;
        const r = residents[0];
        events.emit('npc:roar', { x: r.position.x, z: r.position.z, name: r.name });
        events.emit('subtitle', { text: `${r.name} defiende su territorio: márchate o pelea`, seconds: 3.5 });
      }
      for (const r of residents) {
        if (r.state !== 'fight' && r.state !== 'flee') {
          r.state = 'confront';
          r.target.set(player.position.x, 0, player.position.z);
        }
      }
      // Tras la advertencia, si el intruso no se va, atacan.
      if (w.warned && closest < 10 && w.intrusion > T.intrusionGraceSeconds) {
        startCombat(residents, 'territory', t.id);
      }
    } else {
      w.intrusion = Math.max(0, w.intrusion - dt * 2);
      if (w.intrusion === 0) w.warned = false;
    }
  }

  for (const lion of wildLions) {
    if (!lion.alive || lion.state === 'fight') continue;
    lion.timer -= dt;
    switch (lion.role) {
      case 'resident':
        updateResident(lion, world, dt, rng);
        break;
      case 'female':
        updateFemale(lion, world, dt, rng);
        break;
      case 'nomad':
        updateNomad(lion, world, dt, rng);
        break;
      case 'ally':
        updateAlly(lion, world, dt);
        break;
      case 'cub':
        updateCub(lion, world, dt);
        break;
    }
  }
}

function territoryOf(lion: WildLion): Territory | undefined {
  return lion.territoryId === null ? undefined : territories.find((t) => t.id === lion.territoryId);
}

function finishMove(lion: WildLion, still: WildLion['clip'] = 'idle'): void {
  const scale = lionScale({ sex: lion.sex, ageYears: lion.ageYears, maneDarkness: 0 });
  lion.clip = clipForSpeed(lion.speed, scale, still);
}

/** Derrotado: abandona el territorio y se convierte en nómada. */
function updateFleeing(lion: WildLion, world: WorldData, dt: number): boolean {
  if (lion.state !== 'flee' && lion.state !== 'leave') return false;
  const away = Math.atan2(lion.position.x - player.position.x, lion.position.z - player.position.z);
  steerTowards(lion, world, lion.position.x + Math.sin(away) * 30, lion.position.z + Math.cos(away) * 30, lion.state === 'flee' ? 9 : L.trotSpeedMs, dt, {
    stopDistance: 0,
  });
  if (lion.timer <= 0) {
    if (lion.role === 'resident') {
      lion.role = 'nomad';
      lion.territoryId = null;
    }
    lion.state = 'wander';
    lion.timer = 30;
  }
  finishMove(lion);
  return true;
}

function updateResident(lion: WildLion, world: WorldData, dt: number, rng: () => number): void {
  if (lion.state === 'court') return; // lo gestiona la reproducción
  if (updateFleeing(lion, world, dt)) return;
  const t = territoryOf(lion);
  if (!t) return;
  if (lion.state === 'confront') {
    const d = distXZ(lion.position, lion.target);
    // Se planta a unos metros del intruso en postura de amenaza.
    steerTowards(lion, world, lion.target.x, lion.target.z, d > 30 ? L.trotSpeedMs : L.walkSpeedMs, dt, { stopDistance: 9 });
    if (d < 11) {
      lion.heading = Math.atan2(lion.target.x - lion.position.x, lion.target.z - lion.position.z);
      lion.clip = 'snarl';
    } else finishMove(lion);
    if (!playerIntrudes(t) && (lion.timer <= 0 || distXZ(lion.position, t.center) > t.radius * 1.1)) {
      lion.state = 'patrol';
      lion.timer = 0;
    }
    return;
  }
  // Patrulla y descanso alrededor del centro del territorio.
  if (lion.state === 'patrol') {
    const d = steerTowards(lion, world, lion.target.x, lion.target.z, L.walkSpeedMs, dt, { stopDistance: 2 });
    if (d < 3 || lion.timer <= 0) {
      lion.state = 'rest';
      lion.timer = 60 + rng() * 120;
    }
    finishMove(lion);
    return;
  }
  lion.speed = 0;
  lion.clip = 'rest';
  if (lion.timer <= 0) {
    const a = rng() * Math.PI * 2;
    const r = t.radius * (0.2 + rng() * 0.6);
    lion.target.set(t.center.x + Math.cos(a) * r, 0, t.center.z + Math.sin(a) * r);
    lion.state = 'patrol';
    lion.timer = 120;
  }
  lion.position.y = world.heightAt(lion.position.x, lion.position.z);
}

function updateFemale(lion: WildLion, world: WorldData, dt: number, rng: () => number): void {
  if (lion.state === 'court') return; // lo gestiona la reproducción
  const t = territoryOf(lion);
  // Banquete en una presa cercana.
  const c = nearestCarcass(lion.position.x, lion.position.z, 60);
  if (c && c.meatKg > c.maxKg * 0.2) {
    const d = steerTowards(lion, world, c.position.x + 1, c.position.z, L.walkSpeedMs * 1.3, dt, { stopDistance: 1.2 });
    if (d < 1.6) {
      lion.clip = 'eat';
      eatFrom(c, 0.06 * dt);
    } else finishMove(lion);
    return;
  }
  const cx = t ? t.center.x : lion.home.x;
  const cz = t ? t.center.z : lion.home.z;
  if (lion.state === 'wander') {
    const d = steerTowards(lion, world, lion.target.x, lion.target.z, L.walkSpeedMs, dt, { stopDistance: 2 });
    if (d < 3 || lion.timer <= 0) {
      lion.state = 'rest';
      lion.timer = 80 + rng() * 120;
    }
    finishMove(lion);
    return;
  }
  lion.speed = 0;
  lion.clip = 'rest';
  lion.position.y = world.heightAt(lion.position.x, lion.position.z);
  if (lion.timer <= 0) {
    const a = rng() * Math.PI * 2;
    lion.target.set(cx + Math.cos(a) * (10 + rng() * 40), 0, cz + Math.sin(a) * (10 + rng() * 40));
    lion.state = 'wander';
    lion.timer = 60;
  }
}

function updateNomad(lion: WildLion, world: WorldData, dt: number, rng: () => number): void {
  if (updateFleeing(lion, world, dt)) return;
  // Los nómadas vagan en grupo evitando el corazón de los territorios.
  const leader = wildLions.find((o) => o.alive && o.role === 'nomad' && o.groupId === lion.groupId) ?? lion;
  if (leader === lion) {
    if (lion.state !== 'wander' || distXZ(lion.position, lion.target) < 5 || lion.timer <= 0) {
      for (let i = 0; i < 10; i++) {
        const a = rng() * Math.PI * 2;
        const r = 150 + rng() * 300;
        lion.target.set(lion.position.x + Math.cos(a) * r, 0, lion.position.z + Math.sin(a) * r);
        const inside = territories.some((t) => t.owner !== 'natal' && distXZ(lion.target, t.center) < t.radius * 0.6);
        if (world.inBounds(lion.target.x, lion.target.z, 80) && !inside) break;
      }
      lion.state = 'wander';
      lion.timer = 200 + rng() * 200;
    }
    // Descansa buena parte del tiempo.
    const resting = Math.sin(elapsed * 0.01 + lion.groupId) > 0.4;
    steerTowards(lion, world, lion.target.x, lion.target.z, resting ? 0 : L.walkSpeedMs, dt, { stopDistance: 3 });
    finishMove(lion, 'rest');
  } else {
    const d = steerTowards(lion, world, leader.position.x + 3, leader.position.z + 2, L.walkSpeedMs * 1.2, dt, { stopDistance: 2 });
    finishMove(lion, d < 3 ? 'rest' : 'idle');
  }
}

function updateAlly(lion: WildLion, world: WorldData, dt: number): void {
  // Compañero de coalición: sigue al jugador a unos metros y descansa con él.
  const index = allies().indexOf(lion);
  const angle = player.heading + Math.PI + (index % 2 === 0 ? 0.6 : -0.6);
  const tx = player.position.x + Math.sin(angle) * (5 + index * 2);
  const tz = player.position.z + Math.cos(angle) * (5 + index * 2);
  const d = distXZ(lion.position, { x: tx, z: tz });
  const c = player.action === 'eat' ? nearestCarcass(player.position.x, player.position.z, 6) : null;
  if (c) {
    const dc = steerTowards(lion, world, c.position.x - 1, c.position.z + 1, L.walkSpeedMs, dt, { stopDistance: 1 });
    if (dc < 1.6) {
      lion.clip = 'eat';
      eatFrom(c, 0.07 * dt);
      return;
    }
  } else {
    const speed = d > 40 ? Math.max(L.trotSpeedMs, player.speed) : d > 3 ? Math.max(L.walkSpeedMs * 1.3, player.speed * 0.95) : 0;
    steerTowards(lion, world, tx, tz, speed, dt, { stopDistance: 1, accel: 4 });
  }
  finishMove(lion, player.resting ? 'rest' : player.crouching ? 'stalkIdle' : 'idle');
  if (player.crouching && lion.speed > 0.1) lion.clip = 'stalkWalk';
}

function updateCub(lion: WildLion, world: WorldData, dt: number): void {
  const mother = lion.motherId === 'player' ? null : wildLions.find((m) => m.id === lion.motherId && m.alive);
  const mp = mother ? mother.position : player.position;
  const motherResting = mother ? mother.clip === 'rest' : player.resting;
  const index = Number(lion.id.replace(/\D/g, '')) % 4;
  const a = index * 1.6;
  const tx = mp.x + Math.cos(a) * 2;
  const tz = mp.z + Math.sin(a) * 2;
  const d = distXZ(lion.position, { x: tx, z: tz });
  const ability = 0.45 + 0.55 * Math.min(1, lion.ageYears / 2);
  steerTowards(lion, world, tx, tz, d > 15 ? L.trotSpeedMs * ability : d > 1.5 ? L.walkSpeedMs * ability * 1.3 : 0, dt, { stopDistance: 0.8 });
  finishMove(lion, motherResting ? (lion.ageYears < 0.5 ? 'nurse' : 'rest') : 'idle');
}
