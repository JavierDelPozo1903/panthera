import * as THREE from 'three';
import { clock } from '../core/clock';
import { events } from '../core/events';
import { createAgent, hyenas, mother, siblings, type HyenaAgent } from '../entities/npc/npcState';
import { player } from '../entities/player/playerState';
import { hitPlayer } from '../systems/playerDefense';
import { HYENA_SCALE } from '../entities/hyena/hyenaRig';
import { journal } from '../systems/journal';
import { detectionRadius, visibility } from '../systems/stealth';
import type { WorldData } from '../world/WorldData';
import { damageSibling } from './siblingBrain';
import { clipForSpeed, distXZ, steerTowards } from './steering';

/** Velocidades de la hiena manchada (m/s): trote incansable y carrera de hasta 60 km/h. */
const LOPE = 2.2;
const CHASE = 7.4;
const FLEE = 9;
const BITE_DAMAGE_PLAYER = 0.075;
const BITE_DAMAGE_SIBLING = 0.12;
/** Una hiena no se arriesga a atacar a un cachorro que está pegado a su madre. */
const MOTHER_GUARD_RADIUS = 14;
const CLAN_PATIENCE = 170;

const clan = {
  waypoint: new THREE.Vector3(),
  age: 0,
  searchTimer: 0,
  announced: false,
};

let seedCounter = 1;

export const clanActive = (): boolean => hyenas.length > 0;

/** Aparece un clan de hienas a cierta distancia, rastreando hacia un punto (la madriguera). */
export function spawnClan(world: WorldData, towardX: number, towardZ: number, count: number, rng: () => number): void {
  const a = rng() * Math.PI * 2;
  let sx = towardX;
  let sz = towardZ;
  for (let r = 170; r > 80; r -= 20) {
    sx = towardX + Math.cos(a) * r;
    sz = towardZ + Math.sin(a) * r;
    if (world.inBounds(sx, sz, 40) && world.waterLevelAt(sx, sz) === null) break;
  }
  hyenas.length = 0;
  for (let i = 0; i < count; i++) {
    const base = createAgent<HyenaAgent['state']>(`hyena-${seedCounter}`, `Hiena ${i + 1}`, 'female', 5, 'roam');
    const h: HyenaAgent = { ...base, targetId: null, lostTime: 0, biteCooldown: 0, seed: seedCounter++ };
    const x = sx + (rng() - 0.5) * 12;
    const z = sz + (rng() - 0.5) * 12;
    h.position.set(x, world.heightAt(x, z), z);
    h.heading = Math.atan2(towardX - x, towardZ - z);
    hyenas.push(h);
  }
  clan.waypoint.set(towardX, 0, towardZ);
  clan.age = 0;
  clan.searchTimer = 0;
  clan.announced = false;
  journal.stats.hyenaEncounters++;
  events.emit('sfx', { sound: 'hyenaWhoop', x: sx, y: world.heightAt(sx, sz) + 1, z: sz, volume: 0.9 });
  events.emit('subtitle', { text: '[Aullidos de hiena a lo lejos]', seconds: 4 });
}

interface Target {
  id: string;
  position: THREE.Vector3;
  visibility: number;
}

function candidateTargets(): Target[] {
  const list: Target[] = [];
  if (player.alive) list.push({ id: 'player', position: player.position, visibility: player.visibility });
  for (const s of siblings) {
    if (!s.alive) continue;
    const low = s.state === 'hide' || s.state === 'rest' || s.state === 'nurse';
    list.push({ id: s.id, position: s.position, visibility: visibility({ cover: 0.8, lowPosture: low, speed: s.speed, small: true }) });
  }
  return list;
}

function guarded(pos: THREE.Vector3): boolean {
  const motherHere = mother.active && mother.alive && mother.state !== 'away' && mother.state !== 'huntLeave';
  return motherHere && distXZ(pos, mother.position) < MOTHER_GUARD_RADIUS;
}

function findTarget(id: string | null): Target | null {
  if (!id) return null;
  return candidateTargets().find((t) => t.id === id) ?? null;
}

/**
 * Clan de hienas: rastrean en grupo, detectan por vista según la visibilidad de la presa
 * (hierba, postura, movimiento; ven mejor de noche), persiguen, muerden y huyen ante una
 * leona adulta. Si pierden la pista, investigan el último punto y acaban marchándose.
 */
export function updateHyenas(world: WorldData, dt: number, rng: () => number): void {
  if (hyenas.length === 0) return;
  clan.age += dt;
  clan.searchTimer -= dt;
  const night = clock.isNight;
  const targets = candidateTargets();

  for (let i = hyenas.length - 1; i >= 0; i--) {
    const h = hyenas[i];
    h.timer -= dt;
    h.biteCooldown -= dt;
    let speed = 0;
    let tx = h.position.x;
    let tz = h.position.z;
    let still: HyenaAgent['clip'] = 'idle';

    // Detección (si no está ya persiguiendo o huyendo).
    if (h.state === 'roam' || h.state === 'investigate') {
      for (const t of targets) {
        const d = distXZ(h.position, t.position);
        if (d < detectionRadius(t.visibility, night) && !guarded(t.position)) {
          h.state = 'chase';
          h.targetId = t.id;
          h.lostTime = 0;
          if (!clan.announced) {
            clan.announced = true;
            events.emit('sfx', { sound: 'hyenaGiggle', x: h.position.x, y: h.position.y + 0.8, z: h.position.z });
            events.emit('subtitle', { text: '[Risas de hiena: te han visto]', seconds: 3 });
          }
          break;
        }
      }
    }

    switch (h.state) {
      case 'roam': {
        // Movimiento en grupo hacia el punto de rastreo, cada una con su desplazamiento.
        const ox = Math.cos(h.seed * 2.1) * 6;
        const oz = Math.sin(h.seed * 2.1) * 6;
        tx = clan.waypoint.x + ox;
        tz = clan.waypoint.z + oz;
        speed = LOPE;
        if (distXZ(h.position, { x: tx, z: tz }) < 3 && clan.searchTimer <= 0) {
          const a = rng() * Math.PI * 2;
          clan.waypoint.x += Math.cos(a) * 35;
          clan.waypoint.z += Math.sin(a) * 35;
          clan.searchTimer = 8;
        }
        if (clan.age > CLAN_PATIENCE) h.state = 'leave';
        break;
      }
      case 'investigate':
        tx = h.target.x;
        tz = h.target.z;
        speed = LOPE * 1.3;
        if (distXZ(h.position, h.target) < 2) {
          still = 'stalkIdle';
          speed = 0;
          if (h.timer <= 0) h.state = 'roam';
        }
        break;
      case 'chase': {
        const t = findTarget(h.targetId);
        if (!t || guarded(t.position)) {
          h.state = t ? 'flee' : 'roam';
          h.timer = 5;
          break;
        }
        tx = t.position.x;
        tz = t.position.z;
        speed = CHASE;
        const d = distXZ(h.position, t.position);
        // Como mucho dos muerden a la vez; el resto rodea a la presa esperando su turno.
        const biters = hyenas.filter((o) => o !== h && o.state === 'attack' && o.targetId === h.targetId).length;
        if (biters >= 2 && d < 4.5) {
          speed = 0;
          still = 'stalkIdle';
          h.heading = Math.atan2(t.position.x - h.position.x, t.position.z - h.position.z);
        }
        // Si la presa se esconde y queda quieta, la pierden de vista.
        if (d > 6 && d > detectionRadius(t.visibility, night) * 1.4) h.lostTime += dt;
        else h.lostTime = 0;
        if (h.lostTime > 2.5) {
          h.state = 'investigate';
          h.target.set(t.position.x + (rng() - 0.5) * 10, 0, t.position.z + (rng() - 0.5) * 10);
          h.timer = 5;
          h.targetId = null;
        } else if (d < 1.3 && biters < 2) {
          h.state = 'attack';
          h.biteCooldown = Math.max(h.biteCooldown, 0.5);
        }
        break;
      }
      case 'attack': {
        const t = findTarget(h.targetId);
        if (!t) {
          h.state = 'roam';
          break;
        }
        const d = distXZ(h.position, t.position);
        h.heading = Math.atan2(t.position.x - h.position.x, t.position.z - h.position.z);
        still = 'roar';
        if (d > 1.8) h.state = 'chase';
        else if (h.biteCooldown <= 0) {
          h.biteCooldown = 1.5;
          events.emit('sfx', { sound: 'bite', x: t.position.x, y: t.position.y + 0.3, z: t.position.z });
          if (t.id === 'player') hitPlayer(BITE_DAMAGE_PLAYER, 'hyenas');
          else {
            const s = siblings.find((x) => x.id === t.id);
            if (s) {
              damageSibling(s, BITE_DAMAGE_SIBLING);
              if (!s.alive) {
                h.state = 'roam';
                h.targetId = null;
              }
            }
          }
        }
        break;
      }
      case 'flee':
        tx = h.position.x + (h.position.x - mother.position.x);
        tz = h.position.z + (h.position.z - mother.position.z);
        speed = FLEE;
        if (h.timer <= 0) h.state = 'leave';
        break;
      case 'leave': {
        // Se aleja del jugador y desaparece al perderse de vista.
        tx = h.position.x + (h.position.x - player.position.x);
        tz = h.position.z + (h.position.z - player.position.z);
        speed = LOPE * 1.4;
        if (distXZ(h.position, player.position) > 230) {
          hyenas.splice(i, 1);
          continue;
        }
        break;
      }
    }

    steerTowards(h, world, tx, tz, speed, dt, {
      stopDistance: h.state === 'chase' ? 0.9 : 0.8,
      accel: h.state === 'chase' || h.state === 'flee' ? 5 : 3,
      turnRate: 4,
    });
    h.clip = clipForSpeed(h.speed, HYENA_SCALE, still);
  }
}

/** Nivel de peligro [0, 1] para la música y el HUD. */
export function hyenaDanger(): number {
  let danger = 0;
  for (const h of hyenas) {
    if (h.state === 'chase' || h.state === 'attack') {
      if (h.targetId === 'player') return 1;
      danger = Math.max(danger, 0.8);
    } else if (h.state !== 'leave' && distXZ(h.position, player.position) < 80) danger = Math.max(danger, 0.45);
  }
  return danger;
}

export function clearHyenas(): void {
  hyenas.length = 0;
}
