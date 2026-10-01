import * as THREE from 'three';
import lionData from '../data/lion.json';
import { events } from '../core/events';
import { eatFrom, nearestCarcass, spawnCarcass } from '../entities/carcass/carcassState';
import { hyenas, mother, siblings, type HyenaAgent, type MotherState } from '../entities/npc/npcState';
import { player } from '../entities/player/playerState';
import type { WorldData } from '../world/WorldData';
import { clipForSpeed, distXZ, steerTowards } from './steering';

const L = lionData.locomotion;
const MOTHER_SCALE = lionData.bodySize.femaleScale;

/** Distancia a partir de la cual la madre va a buscar al cachorro. */
const FETCH_DISTANCE = 30;
/** Radio en torno a un cachorro en el que una hiena se considera amenaza. */
const THREAT_RADIUS = 45;
/** Distancia a la que la madre, en un traslado, se para a esperar a los rezagados. */
const RELOCATE_WAIT = 22;
const AWAY_SECONDS = 120;
const ROAR_SECONDS = 2.6;

const huntPoint = new THREE.Vector3();
const tmp = new THREE.Vector3();
let awayTotal = AWAY_SECONDS;
let roarTimer = 0;
/** Vuelta de emergencia: el cachorro la ha llamado mientras le atacaban. */
let urgentReturn = false;
/** Estado al que vuelve tras una defensa. */
let resumeState: MotherState = 'idle';

const CALM: ReadonlySet<MotherState> = new Set(['rest', 'idle', 'wander', 'follow', 'fetch']);

function enter(state: MotherState, timer = 0): void {
  mother.state = state;
  mother.timer = timer;
}

/** La madre sale a cazar: deja a los cachorros escondidos en la madriguera. */
export function startHunt(world: WorldData, rng: () => number): void {
  const a = rng() * Math.PI * 2;
  for (let r = 380; r > 150; r -= 40) {
    huntPoint.set(mother.home.x + Math.cos(a) * r, 0, mother.home.z + Math.sin(a) * r);
    if (world.inBounds(huntPoint.x, huntPoint.z, 60) && world.waterLevelAt(huntPoint.x, huntPoint.z) === null) break;
  }
  enter('huntLeave');
  events.emit('subtitle', { text: `${mother.name} se aleja en silencio: sale a cazar`, seconds: 4 });
}

/** Traslado de la camada a una nueva madriguera. */
export function startRelocation(target: THREE.Vector3): void {
  mother.nextHome.copy(target);
  enter('relocate');
  events.emit('subtitle', { text: `${mother.name} traslada la camada a una nueva madriguera`, seconds: 4 });
}

export const motherIsAway = (): boolean => mother.state === 'away' || mother.state === 'huntLeave';

/** El cachorro llama con maullidos: la madre acude (o vuelve de caza antes de tiempo). */
export function motherHearsCall(): void {
  if (!mother.active || !mother.alive) return;
  if (mother.state === 'away' || mother.state === 'huntLeave') {
    // Un cachorro en apuros: abandona la caza y vuelve a la carrera.
    urgentReturn = hyenas.some((h) => h.state === 'chase' || h.state === 'attack');
    if (mother.state === 'huntLeave') {
      awayTotal = AWAY_SECONDS;
      enter('away', 1);
    } else mother.timer = Math.min(mother.timer, 1);
    return;
  }
  if (CALM.has(mother.state) && distXZ(mother.position, player.position) > 6) enter('fetch');
}

function nearestThreat(): HyenaAgent | null {
  let best: HyenaAgent | null = null;
  let bestD = Infinity;
  for (const h of hyenas) {
    if (!h.alive || h.state === 'flee' || h.state === 'leave') continue;
    const dMother = distXZ(h.position, mother.position);
    let dCub = player.alive ? distXZ(h.position, player.position) : Infinity;
    for (const s of siblings) if (s.alive) dCub = Math.min(dCub, distXZ(h.position, s.position));
    if ((dCub < THREAT_RADIUS || dMother < 30) && dMother < bestD) {
      bestD = dMother;
      best = h;
    }
  }
  return best;
}

/**
 * Máquina de estados de la madre durante la crianza. Los leones descansan 16–20 h al día:
 * la mayor parte del tiempo está tumbada vigilando; sale a cazar, trae la presa, traslada
 * la camada y la defiende de las hienas.
 */
export function updateMother(world: WorldData, dt: number, rng: () => number): void {
  const m = mother;
  m.timer -= dt;
  const cubDist = player.alive ? distXZ(m.position, player.position) : 0;
  let speed = 0;
  let tx = m.position.x;
  let tz = m.position.z;
  let clipOverride: typeof m.clip | null = null;

  // Defensa: prioridad absoluta salvo si está lejos cazando.
  if (m.state !== 'away' && m.state !== 'defend') {
    const threat = nearestThreat();
    if (threat) {
      resumeState = m.carrying ? 'huntReturn' : CALM.has(m.state) ? 'idle' : m.state;
      enter('defend');
      events.emit('sfx', { sound: 'growl', x: m.position.x, y: m.position.y + 1, z: m.position.z });
    }
  }

  // Si el cachorro se aleja demasiado, va a buscarlo.
  // A los juveniles se les deja explorar mucho más lejos.
  const fetchDistance = player.ageYears < 0.5 ? FETCH_DISTANCE : 140;
  if (CALM.has(m.state) && m.state !== 'fetch' && cubDist > fetchDistance) {
    enter('fetch');
    events.emit('subtitle', { text: `[${m.name} te llama con gruñidos suaves]`, seconds: 3 });
  }
  // Amamantar: se tumba mientras el cachorro mama.
  if (CALM.has(m.state) && player.action === 'nurse') enter('nurse', 4);

  // Durante una cacería en grupo la controla huntBrain.
  if (m.state === 'groupHunt') return;

  switch (m.state) {
    case 'rest':
      clipOverride = 'rest';
      if (player.alive && player.speed > 0.5 && cubDist > 12) enter('follow');
      else if (m.timer <= 0) {
        const a = rng() * Math.PI * 2;
        const r = 6 + rng() * 22;
        m.target.set(m.home.x + Math.cos(a) * r, 0, m.home.z + Math.sin(a) * r);
        enter('wander', 40);
      }
      break;
    case 'idle':
      if (player.alive && player.speed > 0.5 && cubDist > 12) enter('follow');
      else if (m.timer <= 0) enter('rest', 40 + rng() * 60);
      break;
    case 'wander':
      tx = m.target.x;
      tz = m.target.z;
      speed = L.walkSpeedMs;
      if (distXZ(m.position, m.target) < 1.5 || m.timer <= 0) enter('idle', 5 + rng() * 8);
      break;
    case 'follow':
      tx = player.position.x;
      tz = player.position.z;
      speed = cubDist > 16 ? L.trotSpeedMs * 0.7 : L.walkSpeedMs;
      if (cubDist < 6) enter('idle', 4 + rng() * 4);
      break;
    case 'fetch':
      tx = player.position.x;
      tz = player.position.z;
      speed = cubDist > 60 ? L.trotSpeedMs : L.walkSpeedMs * 1.5;
      if (cubDist < 4) enter('idle', 6 + rng() * 6);
      break;
    case 'nurse':
      clipOverride = 'rest';
      if (player.action === 'nurse') m.timer = 4;
      else if (m.timer <= 0) enter('rest', 30);
      break;
    case 'huntLeave':
      tx = huntPoint.x;
      tz = huntPoint.z;
      speed = L.trotSpeedMs * 0.8;
      if (distXZ(m.position, m.home) > 200 || distXZ(m.position, huntPoint) < 3) {
        awayTotal = AWAY_SECONDS;
        enter('away', AWAY_SECONDS);
      }
      break;
    case 'away':
      m.position.set(huntPoint.x, world.heightAt(huntPoint.x, huntPoint.z), huntPoint.z);
      if (m.timer <= 0) {
        // Vuelve con presa si ha tenido tiempo de cazar; si la llamaron pronto, sin ella.
        m.carrying = awayTotal - m.timer > AWAY_SECONDS * 0.5;
        const distance = urgentReturn ? 80 : 170;
        const origin = urgentReturn ? player.position : m.home;
        tmp.subVectors(huntPoint, origin).setY(0).normalize().multiplyScalar(distance).add(origin);
        m.position.set(tmp.x, world.heightAt(tmp.x, tmp.z), tmp.z);
        m.heading = Math.atan2(m.home.x - tmp.x, m.home.z - tmp.z);
        enter('huntReturn');
      }
      break;
    case 'huntReturn':
      // Si vuelve porque el cachorro la llama en apuros, viene a la carrera hacia él.
      tx = urgentReturn ? player.position.x : m.home.x;
      tz = urgentReturn ? player.position.z : m.home.z;
      speed = urgentReturn ? 11 : L.trotSpeedMs * 0.85;
      if (urgentReturn && cubDist < 6) urgentReturn = false;
      if (distXZ(m.position, m.home) < 4) {
        if (m.carrying) {
          m.carrying = false;
          const cx = m.position.x + Math.sin(m.heading) * 1.6;
          const cz = m.position.z + Math.cos(m.heading) * 1.6;
          spawnCarcass(cx, world.heightAt(cx, cz), cz, m.heading + Math.PI / 2);
          events.emit('subtitle', { text: `${m.name} ha vuelto con un impala`, seconds: 4 });
          enter('eat', 80);
        } else {
          enter('idle', 5);
        }
      }
      break;
    case 'eat': {
      const c = nearestCarcass(m.position.x, m.position.z, 6);
      if (!c || m.timer <= 0) {
        enter('rest', 60);
        break;
      }
      tx = c.position.x;
      tz = c.position.z;
      if (distXZ(m.position, c.position) > 1.6) speed = L.walkSpeedMs;
      else {
        clipOverride = 'eat';
        eatFrom(c, 0.07 * dt);
      }
      break;
    }
    case 'relocate': {
      tx = m.nextHome.x;
      tz = m.nextHome.z;
      if (cubDist > RELOCATE_WAIT) {
        // Espera al rezagado mirándolo.
        m.heading = Math.atan2(player.position.x - m.position.x, player.position.z - m.position.z);
        speed = 0;
        clipOverride = 'idle';
      } else {
        speed = L.walkSpeedMs * 1.1;
      }
      if (distXZ(m.position, m.nextHome) < 2.5) {
        m.home.copy(m.nextHome);
        enter('rest', 45);
      }
      break;
    }
    case 'defend': {
      const threat = nearestThreat();
      roarTimer -= dt;
      if (roarTimer > 0) {
        clipOverride = 'roar';
        break;
      }
      if (!threat) {
        enter(resumeState, 5);
        break;
      }
      tx = threat.position.x;
      tz = threat.position.z;
      speed = 11;
      if (distXZ(m.position, threat.position) < 4) {
        // Carga y rugido: las hienas huyen ante una leona adulta.
        for (const h of hyenas) {
          if (distXZ(h.position, m.position) < 22 && h.state !== 'leave') {
            h.state = 'flee';
            h.timer = 7;
            h.targetId = null;
          }
        }
        roarTimer = ROAR_SECONDS;
        events.emit('npc:roar', { x: m.position.x, z: m.position.z, name: m.name });
        events.emit('subtitle', { text: `[Rugido de ${m.name}]`, seconds: 3 });
      }
      break;
    }
  }

  if (m.state !== 'away') {
    steerTowards(m, world, tx, tz, speed, dt, { stopDistance: speed > 0 ? 1.2 : 0.1, accel: m.state === 'defend' ? 5 : 3 });
  }
  m.clip = clipOverride ?? clipForSpeed(m.speed, MOTHER_SCALE, m.state === 'rest' || m.state === 'nurse' ? 'rest' : 'idle');
}
