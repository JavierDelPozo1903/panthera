import lionData from '../data/lion.json';
import { clock } from '../core/clock';
import { events } from '../core/events';
import { eatFrom, nearestCarcass } from '../entities/carcass/carcassState';
import { mother, pride, type PrideLion } from '../entities/npc/npcState';
import { lionScale } from '../entities/lion/lionRig';
import type { WorldData } from '../world/WorldData';
import { clipForSpeed, distXZ, steerTowards } from './steering';

const L = lionData.locomotion;

/** Hora del día a la que el macho suele rugir para marcar territorio (anochecer y madrugada). */
const ROAR_HOURS = [19.2, 23.5, 4.5];
let lastRoarSlot = -1;

/**
 * Tías y padre fuera de las cacerías. Las leonas descansan junto a la madre y la siguen;
 * el macho residente descansa algo apartado, ruge al anochecer y patrulla el territorio.
 * Durante una cacería, `huntBrain` toma el control de las leonas.
 */
export function updatePride(world: WorldData, dt: number, rng: () => number): void {
  for (const lion of pride) {
    if (!lion.alive || lion.state === 'hunt') continue;
    lion.timer -= dt;
    if (lion.role === 'father') updateFather(lion, world, dt, rng);
    else updateAunt(lion, world, dt, rng);
  }
}

function eatIfFeast(lion: PrideLion, world: WorldData, dt: number): boolean {
  // Banquete: si hay una presa cerca de la manada, los adultos acuden a comer primero.
  const c = nearestCarcass(lion.position.x, lion.position.z, lion.role === 'father' ? 400 : 120);
  if (!c || c.meatKg < c.maxKg * 0.25) return false;
  lion.state = 'eat';
  const d = distXZ(lion.position, c.position);
  // Cada adulto ocupa su lado de la presa.
  const angle = lion.role === 'father' ? 1.6 : lion.side > 0 ? 0.3 : 3.0;
  const tx = c.position.x + Math.cos(angle) * 1.3;
  const tz = c.position.z + Math.sin(angle) * 1.3;
  if (d > 1.8) {
    steerTowards(lion, world, tx, tz, d > 40 ? L.trotSpeedMs : L.walkSpeedMs, dt, { stopDistance: 0.3 });
    lion.clip = clipForSpeed(lion.speed, 1, 'idle');
  } else {
    lion.speed = 0;
    lion.heading = Math.atan2(c.position.x - lion.position.x, c.position.z - lion.position.z);
    lion.clip = 'eat';
    eatFrom(c, (lion.role === 'father' ? 0.1 : 0.07) * dt);
  }
  return true;
}

function updateAunt(lion: PrideLion, world: WorldData, dt: number, rng: () => number): void {
  if (eatIfFeast(lion, world, dt)) return;
  // Se mantiene a pocos metros de la madre (la manada se mueve junta).
  const ax = mother.position.x + Math.cos(lion.side * 2.4 + 0.5) * 7;
  const az = mother.position.z + Math.sin(lion.side * 2.4 + 0.5) * 7;
  const d = distXZ(lion.position, { x: ax, z: az });
  const motherAway = mother.state === 'away' || mother.state === 'huntLeave';
  const tx = motherAway ? mother.home.x + lion.side * 6 : ax;
  const tz = motherAway ? mother.home.z + 4 : az;
  const dd = motherAway ? distXZ(lion.position, { x: tx, z: tz }) : d;
  let speed = 0;
  if (dd > 25) speed = L.trotSpeedMs * 0.8;
  else if (dd > 5) speed = L.walkSpeedMs;
  steerTowards(lion, world, tx, tz, speed, dt, { stopDistance: 1.5 });
  if (lion.speed > 0.15) lion.state = 'follow';
  else if (lion.state !== 'rest' && lion.timer <= 0) {
    lion.state = rng() < 0.75 ? 'rest' : 'idle';
    lion.timer = 30 + rng() * 60;
  }
  lion.clip = clipForSpeed(lion.speed, lionScale({ sex: 'female', ageYears: lion.ageYears, maneDarkness: 0 }), lion.state === 'rest' ? 'rest' : 'idle');
}

function updateFather(lion: PrideLion, world: WorldData, dt: number, rng: () => number): void {
  // Pelea (la mueve `combat`), expulsión del joven macho, huida tras perder y abandono.
  if (lion.state === 'fight') return;
  if (lion.state === 'evict') {
    const d = steerTowards(lion, world, lion.target.x, lion.target.z, L.trotSpeedMs * 1.1, dt, { stopDistance: 2.5 });
    lion.clip = d < 4 ? 'snarl' : clipForSpeed(lion.speed, 1, 'idle');
    if (lion.timer <= 0) {
      lion.timer = 6 + rng() * 4;
      events.emit('sfx', { sound: 'growl', x: lion.position.x, y: lion.position.y + 0.8, z: lion.position.z });
    }
    return;
  }
  if (lion.state === 'flee' || lion.state === 'leave') {
    // Se aleja de la madriguera; si se va del todo, deja la manada.
    const a = Math.atan2(lion.position.z - mother.home.z, lion.position.x - mother.home.x);
    steerTowards(lion, world, lion.position.x + Math.cos(a) * 30, lion.position.z + Math.sin(a) * 30, L.trotSpeedMs, dt);
    lion.clip = clipForSpeed(lion.speed, 1, 'idle');
    if (lion.timer <= 0) {
      if (lion.state === 'leave') {
        lion.alive = false;
        lion.position.y = -1000;
      } else {
        lion.state = 'rest';
        lion.timer = 120;
      }
    }
    return;
  }
  if (eatIfFeast(lion, world, dt)) return;

  // Rugidos territoriales a horas fijas: se oyen a kilómetros.
  const slot = ROAR_HOURS.findIndex((h) => Math.abs(clock.timeOfDay - h) < 0.15);
  if (slot >= 0 && slot !== lastRoarSlot && lion.state !== 'roar') {
    lastRoarSlot = slot;
    lion.state = 'roar';
    lion.timer = 3.4;
    events.emit('npc:roar', { x: lion.position.x, z: lion.position.z, name: lion.name });
    events.emit('subtitle', { text: `[${lion.name}, el macho de la manada, ruge en la distancia]`, seconds: 3.5 });
  }

  switch (lion.state) {
    case 'roar':
      lion.speed = 0;
      lion.clip = 'roar';
      if (lion.timer <= 0) {
        // Tras rugir, patrulla un tramo del territorio.
        const a = rng() * Math.PI * 2;
        lion.target.set(mother.home.x + Math.cos(a) * 140, 0, mother.home.z + Math.sin(a) * 140);
        lion.state = 'patrol';
        lion.timer = 90;
      }
      return;
    case 'patrol': {
      const d = steerTowards(lion, world, lion.target.x, lion.target.z, L.walkSpeedMs, dt, { stopDistance: 2 });
      if (d < 3 || lion.timer <= 0) {
        lion.state = 'rest';
        lion.timer = 120 + rng() * 120;
      }
      break;
    }
    default: {
      // Descansa a unos 30 m de la madriguera.
      const tx = mother.home.x + 28;
      const tz = mother.home.z - 10;
      const d = distXZ(lion.position, { x: tx, z: tz });
      steerTowards(lion, world, tx, tz, d > 8 ? L.walkSpeedMs : 0, dt, { stopDistance: 3 });
      lion.state = lion.speed > 0.15 ? 'follow' : 'rest';
    }
  }
  lion.clip = clipForSpeed(lion.speed, 1, lion.state === 'rest' ? 'rest' : 'idle');
}
